// SQLite 数据层（Electron 内置 node:sqlite，零原生依赖）
const { DatabaseSync } = require('node:sqlite')

let db = null
let dbFile = null

// 新增角色配色（循环取色）
const PASTEL = ['#7dd3fc', '#fda4af', '#fcd34d', '#93c5fd', '#6ee7b7', '#c4b5fd', '#fdba74', '#67e8f9']

// 内置角色种子（通用占位名，仅首次建库时写入；用户可重命名为实际角色）
const SEED_CHARACTERS = Array.from({ length: 24 }, (_, i) => [`角色${i + 1}`, PASTEL[i % PASTEL.length]])

function initDb(file) {
  dbFile = file
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate()
  seed()
  ensureOriginalSkins()
  const charCount = db.prepare('SELECT COUNT(*) AS n FROM characters').get().n
  const modCount = db.prepare('SELECT COUNT(*) AS n FROM mods').get().n
  return { file, characters: Number(charCount), mods: Number(modCount) }
}

function dbPath() {
  return dbFile
}

function tx(fn) {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#c4b5fd',
      sort  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS skins (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      UNIQUE(character_id, name)
    );

    -- mods / presets 表 Phase 2 先建好结构，Phase 3/4 接入真实导入与联接
    CREATE TABLE IF NOT EXISTS mods (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      folder_path  TEXT NOT NULL,
      character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      skin_id      INTEGER REFERENCES skins(id) ON DELETE SET NULL,
      preview_path TEXT,
      source       TEXT,
      size_bytes   INTEGER,
      content_hash TEXT,
      hotkey       TEXT,
      notes        TEXT,
      enabled      INTEGER NOT NULL DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'normal',
      imported_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS presets (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS preset_mods (
      preset_id INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      mod_id    INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
      position  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (preset_id, mod_id)
    );
  `)

  // 早期版本库的字段补齐
  const cols = db.prepare("PRAGMA table_info(mods)").all().map((c) => c.name)
  if (!cols.includes('enabled')) {
    db.exec('ALTER TABLE mods ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0')
  }
  const ccols = db.prepare("PRAGMA table_info(characters)").all().map((c) => c.name)
  if (!ccols.includes('starred')) {
    db.exec('ALTER TABLE characters ADD COLUMN starred INTEGER NOT NULL DEFAULT 0')
  }
}

function seed() {
  const charCount = Number(db.prepare('SELECT COUNT(*) AS n FROM characters').get().n)
  if (charCount === 0) {
    const ins = db.prepare('INSERT INTO characters (name, color, sort) VALUES (?, ?, ?)')
    tx(() => {
      SEED_CHARACTERS.forEach(([name, color], i) => ins.run(name, color, i))
    })
  }

  const presetCount = Number(db.prepare('SELECT COUNT(*) AS n FROM presets').get().n)
  if (presetCount === 0) {
    db.prepare('INSERT INTO presets (name, locked) VALUES (?, 1)').run('默认预设')
  }
}

// ---- 设置 ----
const SETTING_KEYS = [
  'repoPath', 'modsPath', 'sevenZipPath',
  // AI 快捷键识别（OpenAI 兼容接口）与本地敏感词库（用户自建，每行一个词）
  'aiBaseUrl', 'aiApiKey', 'aiModel', 'aiExtraPrompt', 'sensitiveWords',
  // 自定义提示词：空值 = 跟随 electron/prompts.cjs 内置默认
  'aiPromptMedia', 'aiPromptIni',
]

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    repoPath: map.repoPath || '',
    modsPath: map.modsPath || '',
    sevenZipPath: map.sevenZipPath || '',
    aiBaseUrl: map.aiBaseUrl || '',
    aiApiKey: map.aiApiKey || '',
    aiModel: map.aiModel || '',
    aiExtraPrompt: map.aiExtraPrompt || '',
    sensitiveWords: map.sensitiveWords || '',
    aiPromptMedia: map.aiPromptMedia || '',
    aiPromptIni: map.aiPromptIni || '',
  }
}

function setSettings(settings) {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  tx(() => {
    for (const k of SETTING_KEYS) {
      if (typeof settings[k] === 'string') up.run(k, settings[k])
    }
  })
  return getSettings()
}

// ---- 角色 / 皮肤 ----
// 原皮：每个角色的默认皮肤分类，随角色创建；未归入皮肤的 mod 一律归入原皮
const DEFAULT_SKIN = '原皮'

// 启动迁移：补建缺失的原皮皮肤，并把角色下未归皮肤 / 皮肤引用悬空的 mod 归入原皮
function ensureOriginalSkins() {
  tx(() => {
    const chars = db.prepare('SELECT id FROM characters').all()
    const findSkin = db.prepare('SELECT id FROM skins WHERE character_id = ? AND name = ?')
    const insSkin = db.prepare('INSERT INTO skins (character_id, name) VALUES (?, ?)')
    const fixOrphan = db.prepare(`UPDATE mods SET skin_id = ?
      WHERE character_id = ? AND skin_id IS NOT NULL AND skin_id NOT IN (SELECT id FROM skins)`)
    const assign = db.prepare('UPDATE mods SET skin_id = ? WHERE character_id = ? AND skin_id IS NULL')
    for (const c of chars) {
      let skin = findSkin.get(c.id, DEFAULT_SKIN)
      if (!skin) skin = { id: Number(insSkin.run(c.id, DEFAULT_SKIN).lastInsertRowid) }
      fixOrphan.run(skin.id, c.id)
      assign.run(skin.id, c.id)
    }
  })
}

// 排序：星标置顶 → 组内按 mod 数量降序 → 原有 sort / id 稳定序
function listCharacters() {
  return db
    .prepare(
      `SELECT id, name, color, sort, starred
       FROM characters
       ORDER BY starred DESC,
                (SELECT COUNT(*) FROM mods WHERE character_id = characters.id) DESC,
                sort, id`
    )
    .all()
    .map((r) => ({ ...r, starred: !!r.starred }))
}

function setCharacterStarred(id, starred) {
  db.prepare('UPDATE characters SET starred = ? WHERE id = ?').run(starred ? 1 : 0, id)
  return db.prepare('SELECT id, name, color, sort, starred FROM characters WHERE id = ?').get(id)
}

function addCharacter(name) {
  if (!name) throw new Error('角色名不能为空')
  const usedColors = new Set(
    db.prepare('SELECT color FROM characters').all().map((r) => r.color)
  )
  const color = PASTEL.find((c) => !usedColors.has(c)) || PASTEL[Number(db.prepare('SELECT COUNT(*) AS n FROM characters').get().n) % PASTEL.length]
  const info = db
    .prepare('INSERT INTO characters (name, color, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM characters))')
    .run(name, color)
  // 新角色默认带原皮皮肤分类
  db.prepare('INSERT INTO skins (character_id, name) VALUES (?, ?)').run(info.lastInsertRowid, DEFAULT_SKIN)
  return db.prepare('SELECT id, name, color, sort, starred FROM characters WHERE id = ?').get(info.lastInsertRowid)
}

function listSkins() {
  // 原皮固定排在该角色皮肤列表首位
  return db
    .prepare(`SELECT id, character_id AS characterId, name FROM skins
              ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END, id`)
    .all(DEFAULT_SKIN)
}

function addSkin(characterId, name) {
  if (!characterId || !name) throw new Error('参数不完整')
  const dup = db.prepare('SELECT id FROM skins WHERE character_id = ? AND name = ?').get(characterId, name)
  if (dup) throw new Error(`该角色下已存在同名皮肤「${name}」`)
  const info = db.prepare('INSERT INTO skins (character_id, name) VALUES (?, ?)').run(characterId, name)
  return db.prepare('SELECT id, character_id AS characterId, name FROM skins WHERE id = ?').get(info.lastInsertRowid)
}

// ---- 分类重命名 / 删除（磁盘目录移动由 categorize 编排，这里只管数据）----
function renameCharacter(id, name) {
  if (!name) throw new Error('角色名不能为空')
  const conflict = db.prepare('SELECT id FROM characters WHERE name = ? AND id != ?').get(name, id)
  if (conflict) throw new Error(`已存在同名角色「${name}」`)
  db.prepare('UPDATE characters SET name = ? WHERE id = ?').run(name, id)
  return db.prepare('SELECT id, name, color, sort FROM characters WHERE id = ?').get(id)
}

// 级联删除其下皮肤；mods 的 character_id / skin_id 由外键 ON DELETE SET NULL 置空
function deleteCharacter(id) {
  const info = db.prepare('DELETE FROM characters WHERE id = ?').run(id)
  return Number(info.changes) > 0
}

function renameSkin(id, name) {
  if (!name) throw new Error('皮肤名不能为空')
  const skin = db.prepare('SELECT character_id AS characterId FROM skins WHERE id = ?').get(id)
  if (!skin) throw new Error('皮肤不存在')
  const conflict = db
    .prepare('SELECT id FROM skins WHERE character_id = ? AND name = ? AND id != ?')
    .get(skin.characterId, name, id)
  if (conflict) throw new Error(`该角色下已存在同名皮肤「${name}」`)
  db.prepare('UPDATE skins SET name = ? WHERE id = ?').run(name, id)
  return db.prepare('SELECT id, character_id AS characterId, name FROM skins WHERE id = ?').get(id)
}

function deleteSkin(id) {
  const skin = db.prepare('SELECT name FROM skins WHERE id = ?').get(id)
  if (skin && skin.name === DEFAULT_SKIN) throw new Error('原皮是角色的默认皮肤分类，不可删除')
  const info = db.prepare('DELETE FROM skins WHERE id = ?').run(id)
  return Number(info.changes) > 0
}

// ---- mods（Phase 3 真实导入入库）----
const MOD_SELECT = `
  SELECT m.id, m.name, m.folder_path AS folderPath, m.character_id AS characterId,
         m.skin_id AS skinId, m.preview_path AS previewPath, m.source, m.size_bytes AS sizeBytes,
         m.content_hash AS contentHash, m.hotkey, m.notes, m.enabled, m.imported_at AS importedAt,
         c.name AS characterName, c.color AS characterColor, s.name AS skinName
  FROM mods m
  LEFT JOIN characters c ON c.id = m.character_id
  LEFT JOIN skins s ON s.id = m.skin_id
`

function listMods() {
  const rows = db.prepare(MOD_SELECT + ' ORDER BY m.id DESC').all()
  return rows.map((r) => ({ ...r, enabled: !!r.enabled }))
}

function getMod(id) {
  const r = db.prepare(MOD_SELECT + ' WHERE m.id = ?').get(id)
  return r ? { ...r, enabled: !!r.enabled } : null
}

function insertMod(m) {
  const info = db
    .prepare(`INSERT INTO mods (name, folder_path, character_id, skin_id, preview_path, source, size_bytes, content_hash, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(m.name, m.folderPath, m.characterId ?? null, m.skinId ?? null, m.previewPath ?? null,
         m.source ?? null, m.sizeBytes ?? null, m.contentHash ?? null, m.notes ?? null)
  return getMod(info.lastInsertRowid)
}

// 渲染层驼峰字段 → 表列名
const MOD_EDITABLE = {
  name: 'name',
  folderPath: 'folder_path',
  characterId: 'character_id',
  skinId: 'skin_id',
  hotkey: 'hotkey',
  notes: 'notes',
  previewPath: 'preview_path',
}

function updateMod(id, fields) {
  const sets = []
  const vals = []
  for (const [k, v] of Object.entries(fields)) {
    const col = MOD_EDITABLE[k]
    if (!col) continue
    sets.push(`${col} = ?`)
    vals.push(k === 'characterId' || k === 'skinId' ? (v || null) : v)
  }
  if (!sets.length) return getMod(id)
  vals.push(id)
  db.prepare(`UPDATE mods SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getMod(id)
}

function setModEnabled(id, enabled) {
  db.prepare('UPDATE mods SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  return getMod(id)
}

function deleteMod(id) {
  db.prepare('DELETE FROM mods WHERE id = ?').run(id)
}

function modCount() {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM mods').get().n)
}

// ---- 预设 ----
function listPresets() {
  const presets = db.prepare('SELECT id, name, locked FROM presets ORDER BY id').all()
  const links = db
    .prepare('SELECT preset_id AS presetId, mod_id AS modId FROM preset_mods ORDER BY position, mod_id')
    .all()
  const byId = new Map(presets.map((p) => [p.id, { id: p.id, name: p.name, locked: !!p.locked, modIds: [] }]))
  for (const l of links) {
    const p = byId.get(l.presetId)
    if (p) p.modIds.push(l.modId)
  }
  return [...byId.values()]
}

function addPreset(name, modIds = []) {
  const info = db.prepare('INSERT INTO presets (name, locked) VALUES (?, 0)').run(name)
  setPresetMembers(info.lastInsertRowid, modIds)
  return listPresets().find((p) => p.id === Number(info.lastInsertRowid))
}

function renamePreset(id, name) {
  db.prepare('UPDATE presets SET name = ? WHERE id = ?').run(name, id)
}

function deletePreset(id) {
  const p = db.prepare('SELECT locked FROM presets WHERE id = ?').get(id)
  if (!p || p.locked) throw new Error('默认预设不可删除')
  db.prepare('DELETE FROM presets WHERE id = ?').run(id)
}

function setPresetMembers(id, modIds) {
  const del = db.prepare('DELETE FROM preset_mods WHERE preset_id = ?')
  const ins = db.prepare('INSERT OR IGNORE INTO preset_mods (preset_id, mod_id, position) VALUES (?, ?, ?)')
  tx(() => {
    del.run(id)
    modIds.forEach((mid, i) => ins.run(id, mid, i))
  })
}

// 应用预设：启用集严格等于预设成员（Phase 4 在此基础上叠加真实联接操作）
function applyPreset(id) {
  const before = db.prepare('SELECT id, enabled FROM mods').all()
  const beforeSet = new Set(before.filter((m) => m.enabled).map((m) => m.id))
  db.prepare(`UPDATE mods SET enabled = CASE
                WHEN id IN (SELECT mod_id FROM preset_mods WHERE preset_id = ?) THEN 1 ELSE 0 END`).run(id)
  const after = new Set(
    db.prepare('SELECT mod_id AS id FROM preset_mods WHERE preset_id = ?').all(id).map((r) => r.id)
  )
  const toEnable = [...after].filter((x) => !beforeSet.has(x))
  const toDisable = [...beforeSet].filter((x) => !after.has(x))
  return { toEnable, toDisable }
}

module.exports = {
  initDb, dbPath, DEFAULT_SKIN, ensureOriginalSkins, getSettings, setSettings, listCharacters, addCharacter, setCharacterStarred, listSkins, addSkin,
  renameCharacter, deleteCharacter, renameSkin, deleteSkin,
  listMods, getMod, insertMod, updateMod, setModEnabled, deleteMod, modCount,
  listPresets, addPreset, renamePreset, deletePreset, setPresetMembers, applyPreset,
}
