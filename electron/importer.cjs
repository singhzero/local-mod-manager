// 导入管线：7-Zip 探测、压缩包结构识别、解压、归档入库
const { execFile } = require('node:child_process')
const fsp = require('node:fs/promises')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)/i
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i

// ---- 7-Zip 探测：设置指定 > 应用内捆绑 > 常见安装位置 > PATH ----
// 打包后 7z.exe 位于 <资源目录>/vendor/7zip/（electron-builder extraResources）
function bundledSevenZip() {
  const res = process.resourcesPath
  if (!res) return null
  return path.join(res, 'vendor', '7zip', '7z.exe')
}

const SEVENZIP_CANDIDATES = [
  () => bundledSevenZip(),
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  path.join(process.env.LOCALAPPDATA || '', '7-Zip', '7z.exe'),
  path.join(process.env.PROGRAMFILES || '', '7-Zip', '7z.exe'),
]

function detectSevenZip(configuredPath) {
  const tries = []
  if (configuredPath && configuredPath.trim()) tries.push(configuredPath.trim())
  for (const item of SEVENZIP_CANDIDATES) {
    tries.push(typeof item === 'function' ? item() : item)
  }
  for (const p of tries) {
    if (!p) continue
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch { /* ignore */ }
  }
  return null
}

function sevenZipRun(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || err.message).trim().split(/\r?\n/).slice(-3).join(' | ')
        reject(new Error(`7z 执行失败: ${tail}`))
      } else {
        resolve(stdout)
      }
    })
  })
}

// ---- 结构识别 ----
async function listArchive(exe, archivePath) {
  // -sccUTF-8：让 7z 以 UTF-8 输出路径。默认按控制台代码页输出时，
  // 代码页外的字符（如韩文）会被替换成 _，识别出的目录名与实际解压结果不一致，导致导入报"缺少目录"
  let out
  try {
    out = await sevenZipRun(exe, ['l', '-slt', '-ba', '-sccUTF-8', archivePath])
  } catch (err) {
    // 兼容不支持 -scc 开关的旧版 7z：退回默认输出重试
    out = await sevenZipRun(exe, ['l', '-slt', '-ba', archivePath])
  }
  const entries = []
  let cur = null
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(Path|Folder|Size) = (.*)$/)
    if (!m) continue
    if (m[1] === 'Path') {
      cur = { path: m[2], isDir: false, size: 0 }
      entries.push(cur)
    } else if (cur) {
      if (m[1] === 'Folder') cur.isDir = m[2] !== '-'
      else if (m[1] === 'Size') cur.size = Number(m[2]) || 0
    }
  }
  return entries.filter((e) => !JUNK.test(e.path))
}

function detectStructure(entries, archiveName) {
  const base = archiveName.replace(/\.(zip|7z|rar)$/i, '')
  const topDirs = new Set()
  let looseFiles = 0
  for (const e of entries) {
    const segs = e.path.split(/[\\/]/)
    if (segs.length === 1) {
      if (e.isDir) topDirs.add(segs[0])
      else looseFiles += 1
    } else {
      topDirs.add(segs[0])
    }
  }
  const dirs = [...topDirs]
  if (dirs.length === 0) return { kind: 'single', wrap: true, folders: [base] }
  if (dirs.length === 1 && looseFiles === 0) return { kind: 'single', wrap: false, folders: dirs }
  if (dirs.length >= 2) return { kind: 'multi', folders: dirs }
  return { kind: 'single', wrap: true, folders: [base] } // 1 目录 + 散文件 → 整体导入
}

// ---- 解压 ----
async function extractArchive(exe, archivePath, destDir) {
  await fsp.mkdir(destDir, { recursive: true })
  await sevenZipRun(exe, ['x', '-y', `-o${destDir}`, archivePath])
  return destDir
}

// ---- 工具 ----
async function moveDir(src, dest) {
  try {
    await fsp.rename(src, dest)
  } catch {
    // 跨盘符 rename 失败 → 复制后删除
    await fsp.cp(src, dest, { recursive: true })
    await fsp.rm(src, { recursive: true, force: true })
  }
}

async function dirSize(dir, acc = { files: 0, bytes: 0 }) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      await dirSize(full, acc)
    } else if (e.isFile()) {
      acc.files += 1
      const st = await fsp.stat(full).catch(() => null)
      if (st) acc.bytes += st.size
    }
    if (acc.files > 5000) break
  }
  return acc
}

// 提取预览图候选：BFS 浅层优先，跳过 textures 目录（游戏贴图不作封面）
async function findFirstImage(dir, depth = 0) {
  if (depth > 3) return null
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  let dirs = []
  for (const e of entries) {
    if (e.isFile() && IMAGE_EXT.test(e.name)) return path.join(dir, e.name)
    if (e.isDirectory() && !/^textures$/i.test(e.name)) dirs.push(e.name)
  }
  for (const name of dirs) {
    const found = await findFirstImage(path.join(dir, name), depth + 1)
    if (found) return found
  }
  return null
}

function hashDir(dir) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha1')
    let count = 0
    function walk(d) {
      let list
      try {
        list = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of list) {
        const full = path.join(d, e.name)
        if (e.isDirectory()) walk(full)
        else {
          const st = fs.statSync(full)
          h.update(path.relative(dir, full).toLowerCase())
          h.update(String(st.size))
          if (++count > 800) return
        }
      }
    }
    walk(dir)
    resolve(h.digest('hex').slice(0, 12))
  })
}

async function ensureUniqueDir(parent, name) {
  let candidate = path.join(parent, name)
  let i = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(parent, `${name} (${i})`)
    i += 1
  }
  return candidate
}

// 把 src 移动到 repoPath 下的 parentRel 目录（自动重名加后缀），返回新的相对路径
async function moveDirUnique(repoPath, src, parentRel) {
  const parent = path.join(repoPath, parentRel)
  await fsp.mkdir(parent, { recursive: true })
  const dest = await ensureUniqueDir(parent, path.basename(src))
  await moveDir(src, dest)
  return path.relative(repoPath, dest)
}

// ---- 导入执行 ----
// items: [{ folder, name, characterId, skinId }]  folder=包内顶层文件夹名；wrap 时 folder 为 null（整体 = 解压根）
async function importExecute({ exe, archivePath, repoPath, previewsDir, items }) {
  const stamp = Date.now()
  const temp = path.join(os.tmpdir(), `zmm-import-${stamp}`)
  try {
    await extractArchive(exe, archivePath, temp)
    const created = []
    for (const item of items) {
      const src = item.folder ? path.join(temp, item.folder) : temp
      if (!fs.existsSync(src)) throw new Error(`解压结果中缺少目录：${item.folder || '(根)'}`)

      const parentDir = item.skinId
        ? path.join(repoPath, item.characterName, item.skinName)
        : path.join(repoPath, item.characterName)
      await fsp.mkdir(parentDir, { recursive: true })
      const dest = await ensureUniqueDir(parentDir, item.name)
      await moveDir(src, dest)

      const stats = await dirSize(dest)
      const record = db_insert({
        name: item.name,
        folderPath: path.relative(repoPath, dest),
        characterId: item.characterId,
        skinId: item.skinId || null,
        source: path.basename(archivePath),
        sizeBytes: stats.bytes,
        contentHash: await hashDir(dest),
      })
      created.push(record)

      // 导入时携带的快捷键（导入向导 AI 识别 / 手动填写）
      if (item.hotkey) {
        try {
          db_update(record.id, { hotkey: String(item.hotkey) })
          record.hotkey = String(item.hotkey)
        } catch { /* 快捷键写入失败不阻断导入 */ }
      }

      // 预览图：从 mod 目录提取第一张图片（跳过 textures）
      const firstImage = await findFirstImage(dest)
      if (firstImage) {
        try {
          const ext = path.extname(firstImage).toLowerCase()
          const previewName = `${record.id}${ext}`
          await fsp.copyFile(firstImage, path.join(previewsDir, previewName))
          db_update(record.id, { previewPath: path.join(previewsDir, previewName) })
          record.previewPath = path.join(previewsDir, previewName)
        } catch { /* 预览图失败不阻断导入 */ }
      }
    }
    return created
  } finally {
    fsp.rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}

// 由 main.cjs 注入，避免 importer 直接依赖 db 模块造成初始化顺序问题
let db_insert = () => { throw new Error('db not wired') }
let db_update = () => {}
function wireDb({ insertMod, updateMod }) {
  db_insert = insertMod
  db_update = updateMod
}

module.exports = { detectSevenZip, listArchive, detectStructure, extractArchive, importExecute, wireDb, moveDirUnique }
