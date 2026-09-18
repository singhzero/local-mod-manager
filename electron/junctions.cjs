// 目录联接（junction）操作与启用视图一致性同步
// 纯文件系统层：不依赖 db，便于测试
const fs = require('node:fs')
const path = require('node:path')

function isJunction(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

// 联接存在性必须用 lstat：existsSync 会跟随联接，断链时误报“不存在”
function linkExists(p) {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}

function readTarget(p) {
  try {
    return fs.readlinkSync(p)
  } catch {
    return null
  }
}

function normalizeTarget(t) {
  if (!t) return ''
  return path.resolve(String(t).replace(/^\\\\\?\\/, '')).toLowerCase()
}

// 建联接：幂等。已存在同名时——指向同一目标 = 成功；断链 = 自动清理重建；其他情况 = 冲突
function createJunction(linkPath, targetDir) {
  const target = path.resolve(targetDir)
  if (!fs.existsSync(target)) return { ok: false, reason: 'target-missing' }
  if (linkExists(linkPath)) {
    if (isJunction(linkPath)) {
      const cur = readTarget(linkPath)
      if (normalizeTarget(cur) === normalizeTarget(target)) return { ok: true, action: 'exists' }
      // 旧联接目标已不存在（断链）→ 清理后重建
      const curAbs = cur ? path.resolve(String(cur).replace(/^\\\\\?\\/, '')) : null
      if (curAbs && fs.existsSync(curAbs)) {
        return { ok: false, reason: 'occupied-link', current: cur }
      }
      const rm = removeJunction(linkPath)
      if (!rm.ok) return { ok: false, reason: 'occupied-link' }
    } else {
      return { ok: false, reason: 'occupied-dir' }
    }
  }
  fs.symlinkSync(target, linkPath, 'junction')
  return { ok: true, action: 'created' }
}

// 删联接：只删联接本体，绝不递归删目标
function removeJunction(linkPath) {
  if (!linkExists(linkPath)) return { ok: true, action: 'absent' }
  if (!isJunction(linkPath)) return { ok: false, reason: 'not-link' }
  try {
    fs.rmdirSync(linkPath) // junction 专用：仅移除联接
  } catch {
    try {
      fs.rmSync(linkPath, { force: true })
    } catch (err) {
      return { ok: false, reason: 'remove-failed', message: err.message }
    }
  }
  return { ok: true, action: 'removed' }
}

// ---- 启动一致性同步：让 Mods 目录的联接集合 = 数据库启用集合 ----
// mods: [{ id, folderPath, enabled, status, repoPath下的相对路径 }]
// 返回需要写库的 flags 与清理记录；不直接操作数据库
function syncEnabledView({ modsPath, repoPath, mods }) {
  const result = {
    orphansRemoved: [],  // 断链 / 指向仓库内已删除 mod 的联接 → 清理
    external: [],        // 指向仓库之外的有效联接（用户自己的东西）→ 不动
    manualDirs: [],      // 真实文件夹（手动放置）→ 不动
    healed: [],          // 库里启用但联接缺失 → 补建
    conflicts: [],       // 补建失败（联接名被占用等）
    flags: [],           // [{ id, enabled }] 需要写库的变更
  }
  if (!modsPath || !fs.existsSync(modsPath)) return { ...result, skipped: true }
  if (!repoPath) return { ...result, skipped: true }

  const repoResolved = path.resolve(repoPath).toLowerCase()
  const modByLinkName = new Map()
  for (const m of mods) modByLinkName.set(path.basename(m.folderPath), m)

  const present = new Set()
  for (const entry of fs.readdirSync(modsPath, { withFileTypes: true })) {
    const linkPath = path.join(modsPath, entry.name)
    present.add(entry.name)

    if (!entry.isSymbolicLink()) {
      result.manualDirs.push(entry.name)
      continue
    }
    const target = readTarget(linkPath)
    const norm = normalizeTarget(target)
    const existsTarget = target && fs.existsSync(path.resolve(String(target).replace(/^\\\\\?\\/, '')))
    if (!existsTarget) {
      removeJunction(linkPath)
      result.orphansRemoved.push(entry.name)
      const m = modByLinkName.get(entry.name)
      if (m && m.enabled) result.flags.push({ id: m.id, enabled: false })
      continue
    }
    if (!norm.startsWith(repoResolved + path.sep)) {
      result.external.push(entry.name)
      continue
    }
    // 指向仓库内：视为启用视图的一部分，确保库里标志为开
    const m = modByLinkName.get(entry.name)
    if (m && !m.enabled) result.flags.push({ id: m.id, enabled: true })
  }

  // 补建：库里启用但联接缺失
  for (const m of mods) {
    if (!m.enabled) continue
    const linkName = path.basename(m.folderPath)
    if (present.has(linkName)) continue
    if (m.status === 'lost') {
      result.flags.push({ id: m.id, enabled: false })
      continue
    }
    const targetDir = path.join(repoPath, m.folderPath)
    const r = createJunction(path.join(modsPath, linkName), targetDir)
    if (r.ok) result.healed.push(linkName)
    else result.conflicts.push({ name: linkName, reason: r.reason })
  }

  return result
}

const JUNCTION_REASON = {  'occupied-link': '同名联接已存在且指向其他 mod（可在加载目录中查看），请重命名其中一个 mod',
  'occupied-dir': '加载目录中已存在同名真实文件夹（可能是手动放置的），请处理后重试',
  'target-missing': 'mod 文件夹不存在',
  'not-link': '同名位置是真实文件夹，无法自动移除',
}

module.exports = { createJunction, removeJunction, isJunction, readTarget, syncEnabledView, JUNCTION_REASON }
