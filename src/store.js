// ===== 全局状态：Electron 模式走 IPC + SQLite（真实数据），浏览器预览退回 mock =====
import { reactive, computed } from 'vue'
import { seedCharacters, seedSkins, seedMods, seedPresets } from './data/mock'

const bridge = typeof window !== 'undefined' && window.zmm ? window.zmm : null

let uid = 1000
const nextId = (prefix) => prefix + ++uid

export const store = reactive({
  // 'electron' = 桌面版（数据真实持久化）；'browser' = 浏览器预览（全 mock）
  mode: bridge ? 'electron' : 'browser',
  ready: false,
  busy: false, // 导入等耗时操作进行中
  // ---- 数据 ----
  characters: [...seedCharacters],
  skins: [...seedSkins],
  mods: [...seedMods],
  presets: [...seedPresets],
  settings: {
    repoPath: '',   // mod 存放目录
    modsPath: '',   // mod 加载目录（加载器 Mods 根）
    sevenZipPath: '',
    aiBaseUrl: '',      // OpenAI 兼容 API 地址
    aiApiKey: '',
    aiModel: '',        // 需支持图片输入（视觉模型）才能识别截图
    aiExtraPrompt: '',  // 附加提示词（可选）
    sensitiveWords: '', // 用户自建敏感词库，每行一个词；命中行拦截在本地、不发给模型
    aiPromptMedia: '',  // 文本/截图识别提示词；空 = 跟随内置默认
    aiPromptIni: '',    // ini 标注提示词；空 = 跟随内置默认
  },

  // ---- UI 状态 ----
  ui: {
    search: '',
    nav: { type: 'all', id: null },            // all | uncategorized | char | skin
    multiSelect: false,
    selectedIds: [],                            // 多选集合（mod id）
    selectedModId: null,                        // 右侧详情
    editingPresetId: null,                      // 预设编辑模式
    modal: null,                                // import | settings | savePreset | applyPreset
    editModId: null,                            // 编辑 mod 信息弹窗（名称/预览图/快捷键/备注）
    hotkeyAI: null,                             // AI 识别快捷键对话框上下文 { existingText, save }；非空即显示
    applyPresetId: null,
    droppedFiles: [],                           // 拖入的文件 { name, path? }
    dragDepth: 0,
    bannerDismissed: false,
    toasts: [],
  },
})

// ---- 派生 ----
export const charById = computed(() => Object.fromEntries(store.characters.map((c) => [c.id, c])))
export const skinById = computed(() => Object.fromEntries(store.skins.map((s) => [s.id, s])))
export const modById = computed(() => Object.fromEntries(store.mods.map((m) => [m.id, m])))

export const visibleMods = computed(() => {
  const { nav, search } = store.ui
  let list = store.mods
  if (nav.type === 'uncategorized') list = list.filter((m) => !m.characterId)
  if (nav.type === 'char') list = list.filter((m) => m.characterId === nav.id)
  if (nav.type === 'skin') list = list.filter((m) => m.skinId === nav.id)
  if (store.ui.editingPresetId) {
    const preset = store.presets.find((p) => p.id === store.ui.editingPresetId)
    if (preset) list = list.filter((m) => preset.modIds.includes(m.id))
  }
  const kw = search.trim().toLowerCase()
  if (kw) list = list.filter((m) => m.name.toLowerCase().includes(kw))
  return list
})

export function selectedMods() {
  return store.mods.filter((m) => store.ui.selectedIds.includes(m.id))
}

// ---- 工具 ----
export function toast(message, kind = 'info') {
  const id = nextId('t')
  store.ui.toasts.push({ id, message, kind })
  setTimeout(() => {
    const i = store.ui.toasts.findIndex((t) => t.id === id)
    if (i >= 0) store.ui.toasts.splice(i, 1)
  }, 3200)
}

export function previewUrl(mod) {
  if (!mod?.previewPath || !bridge) return null
  // previewVersion（文件 mtime）变化时强制 <img> 重新加载，避免覆盖同名文件后显示旧缓存图
  const v = mod.previewVersion ? `?v=${mod.previewVersion}` : ''
  return 'zmm-preview://p/' + encodeURIComponent(mod.previewPath) + v
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function normalizeMod(row) {
  return {
    ...row,
    size: fmtSize(row.sizeBytes),
    hash: row.contentHash || '—',
    importedAt: String(row.importedAt || '').slice(0, 10),
  }
}

function replaceMods(rows) {
  store.mods.splice(0, store.mods.length, ...rows.map(normalizeMod))
}

async function refreshMods() {
  if (!bridge) return
  replaceMods(await bridge.listMods())
}

export function charCount(id) {
  return store.mods.filter((m) => m.characterId === id).length
}
export function skinCount(id) {
  return store.mods.filter((m) => m.skinId === id).length
}

// 角色列表展示顺序：星标置顶 → 组内按 mod 数量降序 → 名称稳定序
export const sortedCharacters = computed(() =>
  [...store.characters].sort(
    (a, b) =>
      (b.starred ? 1 : 0) - (a.starred ? 1 : 0) ||
      charCount(b.id) - charCount(a.id) ||
      String(a.name).localeCompare(String(b.name), 'zh-CN')
  )
)

export async function toggleCharacterStar(c) {
  if (bridge) {
    const updated = await bridge.setCharacterStar(c.id, !c.starred)
    c.starred = !!updated.starred
  } else {
    c.starred = !c.starred
  }
}

export function setNav(nav) {
  store.ui.nav = nav
  store.ui.editingPresetId = null
}

export function toggleSelect(id) {
  const i = store.ui.selectedIds.indexOf(id)
  if (i >= 0) store.ui.selectedIds.splice(i, 1)
  else store.ui.selectedIds.push(id)
}

// ---- 启动引导 ----
export async function bootstrap() {
  if (!bridge) {
    store.ready = true
    return
  }
  try {
    // 启动一致性校验先行：孤儿联接清理 / 断链自愈，之后再加载列表
    const sync = await bridge.startupSync()
    if (sync && !sync.skipped) {
      const parts = []
      if (sync.orphansRemoved?.length) parts.push(`清理孤儿联接 ${sync.orphansRemoved.length} 个`)
      if (sync.healed?.length) parts.push(`补建联接 ${sync.healed.length} 个`)
      if (sync.conflicts?.length) parts.push(`${sync.conflicts.length} 个联接冲突待处理`)
      if (sync.external?.length) parts.push(`外部联接 ${sync.external.length} 个未动`)
      if (parts.length) toast('启动校验：' + parts.join('，'), 'info')
    }

    const [settings, characters, skins, mods, presets] = await Promise.all([
      bridge.getSettings(),
      bridge.listCharacters(),
      bridge.listSkins(),
      bridge.listMods(),
      bridge.listPresets(),
    ])
    store.settings.repoPath = settings.repoPath || ''
    store.settings.modsPath = settings.modsPath || ''
    store.settings.sevenZipPath = settings.sevenZipPath || ''
    store.settings.aiBaseUrl = settings.aiBaseUrl || ''
    store.settings.aiApiKey = settings.aiApiKey || ''
    store.settings.aiModel = settings.aiModel || ''
    store.settings.aiExtraPrompt = settings.aiExtraPrompt || ''
    store.settings.sensitiveWords = settings.sensitiveWords || ''
    store.settings.aiPromptMedia = settings.aiPromptMedia || ''
    store.settings.aiPromptIni = settings.aiPromptIni || ''
    store.characters.splice(0, store.characters.length, ...characters)
    store.skins.splice(0, store.skins.length, ...skins)
    replaceMods(mods)
    store.presets.splice(0, store.presets.length, ...presets)
  } catch (err) {
    console.error('[zmm] bootstrap failed:', err)
    toast('本地数据库加载失败：' + err.message, 'warn')
  }
  store.ready = true
}

// ---- 启用 / 停用（真实目录联接：启用建 junction，停用移除）----
export async function toggleModEnabled(mod) {
  if (mod.status === 'lost') {
    toast('该 mod 文件夹已丢失，无法启用', 'warn')
    return
  }
  const next = !mod.enabled
  if (bridge) {
    try {
      const updated = await bridge.setModEnabled(mod.id, next)
      Object.assign(mod, normalizeMod(updated))
    } catch (err) {
      toast('操作失败：' + err.message, 'warn')
      return
    }
  } else {
    mod.enabled = next
  }
  toast(`已${next ? '启用' : '停用'}：${mod.name}（${next ? '已创建目录联接' : '已移除目录联接'}）`, next ? 'ok' : 'info')
  if (next) warnIfSlotBusy(mod)
}

export async function batchSetEnabled(on) {
  const list = selectedMods().filter((m) => m.status !== 'lost')
  let ok = 0
  const errors = []
  for (const m of list) {
    if (bridge) {
      try {
        const updated = await bridge.setModEnabled(m.id, on)
        Object.assign(m, normalizeMod(updated))
        ok += 1
      } catch (err) {
        errors.push(`${m.name}：${err.message}`)
      }
    } else {
      m.enabled = on
      ok += 1
    }
  }
  if (errors.length) toast(`${ok} 个成功，${errors.length} 个失败：${errors[0]}`, 'warn')
  else {
    toast(`批量${on ? '启用' : '停用'} ${ok} 个 mod（联接已${on ? '创建' : '移除'}）`, 'ok')
    if (on) {
      const groups = conflictGroups(store.mods.filter((m) => m.enabled))
      if (groups.length) toast(`提示：启用集中有 ${groups.length} 组同角色/皮肤的重叠 mod，可能相互覆盖（详见应用预设确认框或详情页）`, 'warn')
    }
  }
}

// ---- 编辑 / 删除 ----
export async function updateMod(mod, fields) {
  if (!bridge) {
    Object.assign(mod, fields)
    return mod
  }
  try {
    const updated = await bridge.updateMod(mod.id, fields)
    Object.assign(mod, normalizeMod(updated))
    return mod
  } catch (err) {
    toast('保存失败：' + err.message, 'warn')
    return null
  }
}

export async function removeMod(mod) {
  if (bridge) {
    try {
      await bridge.deleteMod(mod.id)
      await refreshModsPresetsSafe()
    } catch (err) {
      toast('删除失败：' + err.message, 'warn')
      return
    }
  } else {
    const i = store.mods.indexOf(mod)
    if (i >= 0) store.mods.splice(i, 1)
  }
  if (store.ui.selectedModId === mod.id) store.ui.selectedModId = null
  store.ui.selectedIds = store.ui.selectedIds.filter((id) => id !== mod.id)
  toast(`已删除 mod：${mod.name}（移入系统回收站）`, 'warn')
}

async function refreshModsPresetsSafe() {
  try {
    replaceMods(await bridge.listMods())
    store.presets.splice(0, store.presets.length, ...(await bridge.listPresets()))
  } catch { /* ignore */ }
}

export async function openModFolder(mod) {
  if (!bridge) {
    toast('（模拟）Phase 5 打包后在桌面版中打开所在目录', 'info')
    return
  }
  try {
    await bridge.openModFolder(mod.id)
  } catch (err) {
    toast(err.message, 'warn')
  }
}

export async function pastePreviewFromClipboard(mod) {
  if (!bridge) {
    toast('（模拟）桌面版中：Ctrl+V 读取剪贴板图片并保存为预览图', 'info')
    return
  }
  try {
    const r = await bridge.setPreviewFromClipboard(mod.id)
    if (!r.ok) {
      toast('剪贴板中没有图片', 'warn')
      return
    }
    Object.assign(mod, normalizeMod(r.mod))
    toast('已从剪贴板保存预览图', 'ok')
  } catch (err) {
    toast('保存失败：' + err.message, 'warn')
  }
}

export async function setPreviewFromFile(mod) {
  if (!bridge) {
    toast('（模拟）桌面版中：选择图片文件设为预览图', 'info')
    return
  }
  try {
    const r = await bridge.setPreviewFromFile(mod.id)
    if (!r.ok) return // 取消选择
    Object.assign(mod, normalizeMod(r.mod))
    toast('已设置预览图', 'ok')
  } catch (err) {
    toast('设置失败：' + err.message, 'warn')
  }
}

export async function clearPreview(mod) {
  if (!bridge) {
    mod.previewPath = null
    toast('（模拟）已移除预览图', 'info')
    return
  }
  try {
    Object.assign(mod, normalizeMod(await bridge.clearPreview(mod.id)))
    toast('已移除预览图', 'info')
  } catch (err) {
    toast('移除失败：' + err.message, 'warn')
  }
}

export function openEditMod(mod) {
  store.ui.editModId = mod.id
}

// ---- 角色 / 皮肤 ----
export async function addCharacter(name) {
  if (bridge) {
    const c = await bridge.addCharacter(name)
    store.characters.push(c)
    // 主进程建角色时已默认创建「原皮」皮肤，刷新让下拉立刻可用
    store.skins.splice(0, store.skins.length, ...(await bridge.listSkins()))
    toast(`已新增角色：${name}`, 'ok')
    return c
  }
  const palette = ['#7dd3fc', '#fda4af', '#fcd34d', '#93c5fd', '#6ee7b7', '#c4b5fd', '#fdba74', '#67e8f9']
  const c = { id: nextId('c'), name, color: palette[store.characters.length % palette.length] }
  store.characters.push(c)
  store.skins.push({ id: nextId('s'), characterId: c.id, name: '原皮' })
  toast(`（模拟）已新增角色：${name}`, 'ok')
  return c
}

export async function addSkin(characterId, name) {
  if (bridge) {
    const s = await bridge.addSkin(characterId, name)
    store.skins.push(s)
    toast(`已新增皮肤：${name}`, 'ok')
    return s
  }
  const s = { id: nextId('s'), characterId, name }
  store.skins.push(s)
  toast(`（模拟）已新增皮肤：${name}`, 'ok')
  return s
}

// ---- 分类重命名 / 删除（磁盘目录 + 数据库 + 联接三者同步）----
async function refreshTaxonomiesAndMods() {
  const [characters, skins, mods] = await Promise.all([
    bridge.listCharacters(),
    bridge.listSkins(),
    bridge.listMods(),
  ])
  store.characters.splice(0, store.characters.length, ...characters)
  store.skins.splice(0, store.skins.length, ...skins)
  replaceMods(mods)
}

function reportMoveResult(label, r) {
  if (r.errors?.length) {
    toast(`${label}完成，但 ${r.errors.length} 个 mod 处理失败（${r.errors[0].name}：${r.errors[0].message}）`, 'warn')
  } else {
    toast(`${label}完成，${r.moved} 个 mod 目录已同步移动`, 'ok')
  }
}

export async function renameCharacter(c, name) {
  const n = name.trim()
  if (!n || n === c.name) return false
  if (!bridge) {
    c.name = n
    toast(`（模拟）已重命名角色：${n}`, 'ok')
    return true
  }
  try {
    const r = await bridge.renameCharacter(c.id, n)
    c.name = n
    await refreshTaxonomiesAndMods()
    reportMoveResult(`已重命名角色「${n}」`, r)
    return true
  } catch (err) {
    toast(err.message, 'warn')
    return false
  }
}

export async function deleteCharacter(c) {
  const modCount = store.mods.filter((m) => m.characterId === c.id).length
  if (!bridge) {
    const i = store.characters.indexOf(c)
    if (i >= 0) store.characters.splice(i, 1)
    store.skins = store.skins.filter((s) => s.characterId !== c.id)
    toast(`（模拟）已删除角色：${c.name}`, 'warn')
    return true
  }
  try {
    const r = await bridge.deleteCharacter(c.id)
    await refreshTaxonomiesAndMods()
    toast(`已删除角色「${c.name}」，${r.moved}/${modCount} 个 mod 移入「未分类」`, 'warn')
    return true
  } catch (err) {
    toast(err.message, 'warn')
    return false
  }
}

export async function renameSkin(s, name) {
  const n = name.trim()
  if (!n || n === s.name) return false
  if (!bridge) {
    s.name = n
    toast(`（模拟）已重命名皮肤：${n}`, 'ok')
    return true
  }
  try {
    const r = await bridge.renameSkin(s.id, n)
    s.name = n
    await refreshTaxonomiesAndMods()
    reportMoveResult(`已重命名皮肤「${n}」`, r)
    return true
  } catch (err) {
    toast(err.message, 'warn')
    return false
  }
}

export async function deleteSkin(s) {
  const modCount = store.mods.filter((m) => m.skinId === s.id).length
  if (!bridge) {
    const i = store.skins.indexOf(s)
    if (i >= 0) store.skins.splice(i, 1)
    toast(`（模拟）已删除皮肤：${s.name}`, 'warn')
    return true
  }
  try {
    const r = await bridge.deleteSkin(s.id)
    await refreshTaxonomiesAndMods()
    toast(`已删除皮肤「${s.name}」，${r.moved}/${modCount} 个 mod 已上移到角色根目录`, 'warn')
    return true
  } catch (err) {
    toast(err.message, 'warn')
    return false
  }
}

// ---- 设置 ----
export async function saveSettings(next) {
  if (bridge) {
    const saved = await bridge.setSettings(next)
    for (const k of Object.keys(store.settings)) store.settings[k] = saved[k] || ''
  } else {
    for (const k of Object.keys(store.settings)) store.settings[k] = next[k] || ''
  }
}

export function pickDirectory() {
  return bridge ? bridge.pickDirectory() : Promise.resolve(null)
}

// 校验目录：{ ok, reason: empty | not-found | not-dir | no-write | ok }
export async function validateDir(dirPath) {
  if (bridge) return bridge.validateDirectory(dirPath)
  return dirPath && dirPath.trim() ? { ok: true, reason: 'ok' } : { ok: false, reason: 'empty' }
}

// ---- 导入管线（Phase 3）----
export async function pickArchiveFiles() {
  if (!bridge) return []
  return bridge.pickArchiveFiles()
}

export function droppedFilePath(file) {
  if (!bridge) return null
  return bridge.getPathForFile(file)
}

export async function detectArchive(archivePath) {
  return bridge.detectArchive(archivePath) // { kind, folders, wrap? }
}

export async function executeImport({ archivePath, items }) {
  const created = await bridge.executeImport({ archivePath, items })
  await refreshMods()
  return created
}

// ---- 预设 ----
// ---- 冲突检测（仅提示，不阻止）----
// 冲突键 = 角色 + 皮肤：同组多个 mod 同时启用时可能替换相同游戏资源，
// 但不同资源的 mod 可以并存，因此只做提示。
export function conflictGroups(mods) {
  const map = new Map()
  for (const m of mods) {
    if (!m || m.status === 'lost' || !m.characterId) continue
    const key = `${m.characterId}::${m.skinId || ''}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(m)
  }
  return [...map.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      character: charById.value[g[0].characterId],
      skin: g[0].skinId ? store.skins.find((s) => s.id === g[0].skinId) : null,
      mods: g,
    }))
}

// 应用预设后的启用集（= 预设成员）内的冲突分组
export function presetConflicts(preset) {
  const members = preset.modIds.map((id) => modById.value[id]).filter(Boolean)
  return conflictGroups(members)
}

function warnIfSlotBusy(mod) {
  const peers = store.mods.filter(
    (m) =>
      m.id !== mod.id && m.enabled && m.status !== 'lost' &&
      m.characterId && m.characterId === mod.characterId && (m.skinId || null) === (mod.skinId || null)
  )
  if (!peers.length) return
  const char = charById.value[mod.characterId]
  const skin = mod.skinId ? store.skins.find((s) => s.id === mod.skinId) : null
  const slot = char ? `${char.name}${skin ? ' / ' + skin.name : ''}` : '同一槽位'
  toast(`提示：${slot} 下已有 ${peers.length} 个启用中的 mod（${peers.map((m) => m.name).join('、')}），若替换同一资源可能相互覆盖`, 'warn')
}

export function presetDiff(preset) {
  const target = new Set(preset.modIds.filter((id) => modById.value[id] && modById.value[id].status !== 'lost'))
  const current = new Set(store.mods.filter((m) => m.enabled).map((m) => m.id))
  const toEnable = [...target].filter((id) => !current.has(id))
  const toDisable = [...current].filter((id) => !target.has(id))
  return { toEnable, toDisable }
}

export async function applyPreset(preset) {
  const { toEnable, toDisable } = presetDiff(preset)
  if (bridge) {
    try {
      const r = await bridge.applyPreset(preset.id)
      // 按预设成员同步本地启用标志
      for (const m of store.mods) m.enabled = preset.modIds.includes(m.id) && m.status !== 'lost'
      if (r.errors?.length) {
        toast(`预设「${preset.name}」部分应用：${r.errors.length} 个失败（${r.errors[0].name}：${r.errors[0].message}）`, 'warn')
      } else {
        toast(`已应用预设「${preset.name}」：启用 ${r.enabled} 个，停用 ${r.disabled} 个（目录联接已更新）`, 'ok')
      }
    } catch (err) {
      toast('应用失败：' + err.message, 'warn')
    }
    return
  }
  toEnable.forEach((id) => (modById.value[id].enabled = true))
  toDisable.forEach((id) => (modById.value[id].enabled = false))
  toast(`（模拟）已应用预设「${preset.name}」：启用 ${toEnable.length} 个，停用 ${toDisable.length} 个`, 'ok')
}

export async function savePreset(name) {
  const modIds = [...store.ui.selectedIds]
  if (bridge) {
    const p = await bridge.addPreset(name, modIds)
    store.presets.push(p)
    toast(`已保存预设「${name}」，含 ${modIds.length} 个 mod`, 'ok')
    return p
  }
  const p = { id: nextId('p'), name, modIds, locked: false }
  store.presets.push(p)
  toast(`（模拟）已保存预设「${name}」，含 ${modIds.length} 个 mod`, 'ok')
  return p
}

export async function renamePreset(preset, name) {
  if (bridge) await bridge.renamePreset(preset.id, name)
  preset.name = name
  toast('预设已重命名', 'ok')
}

export async function deletePreset(preset) {
  if (preset.locked) {
    toast('默认预设不可删除', 'warn')
    return
  }
  if (bridge) await bridge.deletePreset(preset.id)
  const i = store.presets.indexOf(preset)
  if (i >= 0) store.presets.splice(i, 1)
  if (store.ui.editingPresetId === preset.id) store.ui.editingPresetId = null
  toast(`已删除预设「${preset.name}」`, 'warn')
}

export async function addSelectionToPreset(preset) {
  const ids = selectedMods().map((m) => m.id)
  let added = 0
  for (const id of ids) {
    if (!preset.modIds.includes(id)) {
      preset.modIds.push(id)
      added += 1
    }
  }
  if (bridge) {
    store.presets.splice(0, store.presets.length, ...(await bridge.setPresetMembers(preset.id, preset.modIds)))
  }
  toast(`已将 ${added} 个 mod 加入预设「${preset.name}」`, 'ok')
}

export async function removeSelectionFromPreset(preset) {
  const ids = selectedMods().map((m) => m.id)
  let removed = 0
  for (const id of ids) {
    const i = preset.modIds.indexOf(id)
    if (i >= 0) {
      preset.modIds.splice(i, 1)
      removed += 1
    }
  }
  if (bridge) {
    store.presets.splice(0, store.presets.length, ...(await bridge.setPresetMembers(preset.id, preset.modIds)))
  }
  toast(`已从预设「${preset.name}」移除 ${removed} 个 mod`, 'warn')
}

// ---- 浏览器 mock 导入（仅预览模式）----
export function importModsMock(items) {
  const created = []
  items.forEach((it) => {
    const m = {
      id: nextId('m'),
      name: it.name,
      characterId: it.characterId,
      skinId: it.skinId || null,
      enabled: false,
      status: 'normal',
      hotkey: it.hotkey || null,
      source: it.source,
      size: it.size || '—',
      hash: Math.random().toString(16).slice(2, 10),
      importedAt: new Date().toISOString().slice(0, 10),
    }
    store.mods.push(m)
    created.push(m)
  })
  return created
}

// ---- AI 快捷键识别（OpenAI 兼容接口；浏览器预览模式返回模拟数据）----
export function sensitiveWordList() {
  return String(store.settings.sensitiveWords || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

export function aiConfigured() {
  const s = store.settings
  return !!(s.aiBaseUrl && s.aiApiKey && s.aiModel)
}

// Electron IPC 抛错会带 "Error invoking remote method 'xx': Error:" 前缀，剥掉只留中文消息
function cleanIpcError(err) {
  return new Error(String(err?.message || err).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''))
}

export async function aiRecognize(payload) {
  if (!bridge) {
    await new Promise((r) => setTimeout(r, 900))
    return {
      entries: [
        { key: 'F1', desc: '切换妆容（模拟）' },
        { key: 'F2', desc: '收起武器（模拟）' },
        { key: 'Ctrl+9', desc: '切换姿势（模拟）' },
      ],
    }
  }
  try {
    return await bridge.aiRecognize(payload)
  } catch (err) {
    throw cleanIpcError(err)
  }
}

export async function aiTestConnection(override) {
  if (!bridge) {
    await new Promise((r) => setTimeout(r, 600))
    return { ok: true, reply: '（模拟）连接正常' }
  }
  try {
    return await bridge.aiTest(override)
  } catch (err) {
    throw cleanIpcError(err)
  }
}

export async function aiReadClipboardImage() {
  if (!bridge) return { ok: false, reason: 'no-bridge' }
  return bridge.aiReadClipboardImage()
}

export async function aiPickImage() {
  if (!bridge) return { ok: false, reason: 'no-bridge' }
  return bridge.aiPickImage()
}

// ---- ini 快捷键（本地解析 + AI 兜底标注；浏览器预览返回模拟数据）----
export async function scanModInis(modId) {
  if (!bridge) {
    await new Promise((r) => setTimeout(r, 400))
    return {
      iniCount: 2,
      dictHit: 3,
      uiCount: 5,
      bindings: [
        { section: 'KeyMaoZi', file: 'Body.ini', keyCombo: 'Ctrl+↑', desc: '帽子', descSource: 'dict', ui: false, variable: '$MaoZi', comment: '' },
        { section: 'KeyXieZi', file: 'Body.ini', keyCombo: 'Alt+↓', desc: '鞋子', descSource: 'dict', ui: false, variable: '$XieZi', comment: '' },
        { section: 'KeySwapBody', file: 'Body.ini', keyCombo: 'U/I', desc: '', descSource: null, ui: false, variable: '$Body', comment: '' },
        { section: 'KeyShowMenu1', file: 'Menu.ini', keyCombo: 'H', desc: '', descSource: null, ui: true, variable: '$menu', comment: '' },
        { section: 'KeyHold', file: 'Menu.ini', keyCombo: '鼠标左键', desc: '', descSource: null, ui: true, variable: '$hold', comment: '' },
      ],
    }
  }
  try {
    return await bridge.scanModInis(modId)
  } catch (err) {
    throw cleanIpcError(err)
  }
}

export async function labelIni(items) {
  if (!bridge) {
    await new Promise((r) => setTimeout(r, 700))
    return { labeled: items.map((it) => ({ section: it.section, key: it.key, desc: '模拟标注' })) }
  }
  try {
    return await bridge.labelIni(items)
  } catch (err) {
    throw cleanIpcError(err)
  }
}
