// 分类重组织编排：角色 / 皮肤重命名与删除
// 磁盘目录移动 + folder_path 更新 + 启用联接重建 三者保持一致
const path = require('node:path')
const fs = require('node:fs')
const { DEFAULT_SKIN } = require('./db.cjs')

const UNCATEGORY_DIR = '_未分类'

module.exports = function createCategorize({ db, junctions, importer }) {
  const JUNCTION_REASON = junctions.JUNCTION_REASON

  function settings() {
    return db.getSettings()
  }

  // 单个 mod 的迁移：移动目录 → 更新 folder_path（及归属字段）→ 刷新联接
  // mod: db 行（含 folderPath / enabled）；newParentRel: 新父目录（相对仓库根）
  // extraFields: 需要一并更新的归属字段（characterId / skinId）
  async function relocateMod(mod, newParentRel, extraFields = {}) {
    const s = settings()
    if (!s.repoPath) throw new Error('未配置 mod 存放目录')
    const oldRel = mod.folderPath
    const srcAbs = path.join(s.repoPath, oldRel)
    let newRel = oldRel

    if (fs.existsSync(srcAbs)) {
      newRel = await importer.moveDirUnique(s.repoPath, srcAbs, newParentRel)
    } else if (oldRel !== path.join(newParentRel, path.basename(oldRel))) {
      throw new Error('mod 文件夹已丢失，无法移动')
    }
    const updated = db.updateMod(mod.id, { folderPath: newRel, ...extraFields })

    // 联接刷新：旧名联接移除，启用中则按新路径重建
    if (s.modsPath) {
      const oldBase = path.basename(oldRel)
      const newBase = path.basename(newRel)
      const oldLink = path.join(s.modsPath, oldBase)
      const newLink = path.join(s.modsPath, newBase)
      if (updated.enabled) {
        junctions.removeJunction(oldLink)
        const r = junctions.createJunction(newLink, path.join(s.repoPath, newRel))
        if (!r.ok) {
          return { mod: updated, error: JUNCTION_REASON[r.reason] || '目录联接重建失败' }
        }
      } else if (junctions.isJunction(oldLink)) {
        junctions.removeJunction(oldLink)
      }
    }
    return { mod: updated, error: null }
  }

  async function renameCharacter(id, newName) {
    const character = db.renameCharacter(id, newName) // 先过唯一性校验
    const mods = db.listMods().filter((m) => m.characterId === id)
    const result = { moved: 0, errors: [], character }
    for (const m of mods) {
      if (m.status === 'lost') continue // 丢失的 mod 无法移动，仅随角色改名保留原路径
      const skin = m.skinId ? db.listSkins().find((x) => x.id === m.skinId) : null
      const parent = skin ? path.join(newName, skin.name) : newName
      const r = await relocateMod(m, parent)
      if (r.error) result.errors.push({ name: m.name, message: r.error })
      else result.moved += 1
    }
    return result
  }

  async function deleteCharacter(id) {
    const character = db.listCharacters().find((c) => c.id === id)
    if (!character) throw new Error('角色不存在')
    const mods = db.listMods().filter((m) => m.characterId === id)
    const result = { moved: 0, errors: [], character }
    for (const m of mods) {
      if (m.status === 'lost') continue
      const r = await relocateMod(m, UNCATEGORY_DIR, { characterId: null, skinId: null })
      if (r.error) result.errors.push({ name: m.name, message: r.error })
      else result.moved += 1
    }
    db.deleteCharacter(id) // 级联删除其下皮肤；剩余归属字段已显式置空
    return result
  }

  async function renameSkin(id, newName) {
    const skin = db.renameSkin(id, newName) // 先过同角色唯一性校验
    const character = db.listCharacters().find((c) => c.id === skin.characterId)
    const mods = db.listMods().filter((m) => m.skinId === id)
    const result = { moved: 0, errors: [], skin }
    for (const m of mods) {
      if (m.status === 'lost') continue
      const r = await relocateMod(m, path.join(character.name, newName))
      if (r.error) result.errors.push({ name: m.name, message: r.error })
      else result.moved += 1
    }
    return result
  }

  async function deleteSkin(id) {
    const skin = db.listSkins().find((s) => s.id === id)
    if (!skin) throw new Error('皮肤不存在')
    if (skin.name === DEFAULT_SKIN) throw new Error('原皮是角色的默认皮肤分类，不可删除')
    const character = db.listCharacters().find((c) => c.id === skin.characterId)
    const mods = db.listMods().filter((m) => m.skinId === id)
    const result = { moved: 0, errors: [], skin }
    for (const m of mods) {
      if (m.status === 'lost') continue
      const r = await relocateMod(m, character.name, { skinId: null })
      if (r.error) result.errors.push({ name: m.name, message: r.error })
      else result.moved += 1
    }
    db.deleteSkin(id)
    return result
  }

  return { relocateMod, renameCharacter, deleteCharacter, renameSkin, deleteSkin }
}
