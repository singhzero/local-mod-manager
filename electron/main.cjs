// 本地模组管理器 — Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const fsp = require('node:fs/promises')
const { execFile } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const db = require('./db.cjs')
const importer = require('./importer.cjs')
const junctions = require('./junctions.cjs')
const ai = require('./ai.cjs')
const iniHotkeys = require('./iniHotkeys.cjs')
const createCategorize = require('./categorize.cjs')

let mainWindow = null
let previewsDir = null
const categorize = createCategorize({ db, junctions, importer })

// 自定义协议要在 ready 前注册
protocol.registerSchemesAsPrivileged([
  { scheme: 'zmm-preview', privileges: { bypassCSP: true, stream: true } },
])

const gotLock = app.requestSingleInstanceLock()
// 统一开发 / 打包版的数据目录（默认跟 productName 走，会导致两边数据分离）
app.setPath('userData', path.join(app.getPath('appData'), 'local-mod-manager'))
app.setAppUserModelId('com.localmod.manager')

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // 主进程兜底：未捕获异常弹窗提示而不是静默崩溃
  process.on('uncaughtException', (err) => {
    console.error('[zmm] uncaughtException:', err)
    try {
      dialog.showErrorBox('本地模组管理器遇到意外错误', String(err.stack || err.message || err))
    } catch { /* ignore */ }
  })

  app.whenReady().then(async () => {
    const dbResult = db.initDb(path.join(app.getPath('userData'), 'catalog.db'))
    previewsDir = path.join(app.getPath('userData'), 'previews')
    await fsp.mkdir(previewsDir, { recursive: true })
    importer.wireDb({ insertMod: db.insertMod, updateMod: db.updateMod })
    registerIpc()
    registerPreviewProtocol()
    createWindow()
    console.log('[zmm] db ready:', JSON.stringify(dbResult))
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#fbfbfd',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'), // 打包版由 exe 资源提供，此路径用于开发模式
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  // 开发模式加载 Vite dev server；打包后加载 dist
  const devUrl = process.env.ZMM_DEV_URL || 'http://localhost:5173'
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 预览图协议：zmm-preview://p/<encodeURIComponent(绝对路径)>[?v=版本]
// 文件内容可能被覆盖（重新粘贴预览图），必须禁缓存，否则同一 URL 永远命中旧图
async function registerPreviewProtocol() {
  protocol.handle('zmm-preview', async (request) => {
    const prefix = 'zmm-preview://p/'
    const raw = decodeURIComponent(request.url.slice(prefix.length).split('?')[0])
    const allowed = [previewsDir, db.getSettings().repoPath]
      .filter(Boolean)
      .map((p) => path.resolve(p))
    const target = path.resolve(raw)
    const ok = allowed.some((root) => target.toLowerCase().startsWith(root.toLowerCase() + path.sep))
    if (!ok || !fs.existsSync(target)) {
      return new Response('not found', { status: 404 })
    }
    const upstream = await net.fetch(pathToFileURL(target).toString())
    const buf = await upstream.arrayBuffer()
    return new Response(buf, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    })
  })
}

function requireRepo() {
  const repo = db.getSettings().repoPath
  if (!repo) throw new Error('请先在设置中配置 mod 存放目录')
  return repo
}

// 读系统剪贴板位图 → nativeImage。
// Electron 44 已移除 clipboard.readImage，改经 PowerShell 读 Windows 剪贴板（本应用仅面向 Windows）。
function clipboardImage() {
  const out = path.join(os.tmpdir(), `zmm-clip-${Date.now()}.png`)
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$img = [System.Windows.Forms.Clipboard]::GetImage()',
    `if ($img) { $img.Save('${out.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png) }`,
  ].join('; ')
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, timeout: 10000 }, (err) => {
      try {
        if (err || !fs.existsSync(out)) return resolve(null)
        const img = nativeImage.createFromPath(out)
        resolve(img.isEmpty() ? null : img)
      } catch {
        resolve(null)
      } finally {
        fs.rmSync(out, { force: true })
      }
    })
  })
}

function resolveSevenZip() {
  return importer.detectSevenZip(db.getSettings().sevenZipPath)
}

function withLiveStatus(mod) {
  const repo = db.getSettings().repoPath
  if (!repo) return { ...mod, status: mod.status || 'normal' }
  const exists = fs.existsSync(path.join(repo, mod.folderPath))
  return { ...mod, status: exists ? 'normal' : 'lost' }
}

// ---- 启用调度：联接操作 + 数据库标志，保持两者一致 ----
const JUNCTION_REASON = junctions.JUNCTION_REASON

function enableModSystem(mod, on) {
  const s = db.getSettings()
  if (!s.modsPath) throw new Error('请先在设置中配置 mod 加载目录（加载器 Mods 根目录）')
  const target = path.join(s.repoPath, mod.folderPath)
  if (!fs.existsSync(target)) throw new Error('mod 文件夹已丢失，无法启用')
  const linkPath = path.join(s.modsPath, path.basename(mod.folderPath))

  if (on) {
    const r = junctions.createJunction(linkPath, target)
    if (!r.ok) throw new Error(JUNCTION_REASON[r.reason] || '创建目录联接失败')
  } else {
    const r = junctions.removeJunction(linkPath)
    if (!r.ok) throw new Error(JUNCTION_REASON[r.reason] || '移除目录联接失败')
  }
  return db.setModEnabled(mod.id, on)
}

// 启动一致性校验： Mods 目录联接集合 ⇄ 数据库启用集合
function runStartupSync() {
  const s = db.getSettings()
  if (!s.modsPath) return { skipped: true, reason: '未配置加载目录' }
  const view = junctions.syncEnabledView({
    modsPath: s.modsPath,
    repoPath: s.repoPath,
    mods: db.listMods(),
  })
  for (const f of view.flags) db.setModEnabled(f.id, f.enabled)
  const { skipped, flags, ...rest } = view
  return rest
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dbPath: db.dbPath(),
    userData: app.getPath('userData'),
  }))

  // ---- 设置 ----
  ipcMain.handle('settings:get', () => db.getSettings())
  ipcMain.handle('settings:set', (_e, settings) => {
    const clean = {
      repoPath: String(settings?.repoPath ?? '').trim(),
      modsPath: String(settings?.modsPath ?? '').trim(),
      sevenZipPath: String(settings?.sevenZipPath ?? '').trim(),
      aiBaseUrl: String(settings?.aiBaseUrl ?? '').trim(),
      aiApiKey: String(settings?.aiApiKey ?? '').trim(),
      aiModel: String(settings?.aiModel ?? '').trim(),
      aiExtraPrompt: String(settings?.aiExtraPrompt ?? '').trim(),
      sensitiveWords: String(settings?.sensitiveWords ?? '').replace(/\r\n?/g, '\n'),
      aiPromptMedia: String(settings?.aiPromptMedia ?? '').replace(/\r\n?/g, '\n').trim(),
      aiPromptIni: String(settings?.aiPromptIni ?? '').replace(/\r\n?/g, '\n').trim(),
    }
    if (clean.sevenZipPath && !fs.existsSync(clean.sevenZipPath)) {
      throw new Error('7-Zip 路径不存在')
    }
    db.setSettings(clean)
    return db.getSettings()
  })

  ipcMain.handle('dir:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths.length) return null
    return r.filePaths[0]
  })

  ipcMain.handle('dir:validate', async (_e, dirPath) => {
    const p = String(dirPath || '').trim()
    if (!p) return { ok: false, reason: 'empty' }
    try {
      const st = await fsp.stat(p)
      if (!st.isDirectory()) return { ok: false, reason: 'not-dir' }
      await fsp.access(p, fs.constants.W_OK)
      return { ok: true, reason: 'ok' }
    } catch (err) {
      if (err.code === 'ENOENT') return { ok: false, reason: 'not-found' }
      return { ok: false, reason: 'no-write' }
    }
  })

  // ---- 7-Zip / 压缩包 ----
  ipcMain.handle('sevenzip:detect', () => ({ path: resolveSevenZip() }))

  ipcMain.handle('files:pickArchives', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择 mod 压缩包',
      filters: [{ name: 'Mod 压缩包', extensions: ['zip', '7z', 'rar'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (r.canceled) return []
    return r.filePaths
  })

  ipcMain.handle('files:pickSevenZip', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择 7z.exe',
      filters: [{ name: '7-Zip 控制台程序', extensions: ['exe'] }],
      properties: ['openFile'],
    })
    if (r.canceled || !r.filePaths.length) return null
    return r.filePaths[0]
  })

  ipcMain.handle('archive:detect', async (_e, archivePath) => {
    const exe = resolveSevenZip()
    if (!exe) throw new Error('未找到 7-Zip，请在设置中指定 7z.exe 路径')
    const entries = await importer.listArchive(exe, archivePath)
    return importer.detectStructure(entries, path.basename(archivePath))
  })

  ipcMain.handle('import:execute', async (_e, { archivePath, items }) => {
    const exe = resolveSevenZip()
    if (!exe) throw new Error('未找到 7-Zip，请在设置中指定 7z.exe 路径')
    const repo = requireRepo()
    return importer.importExecute({
      exe,
      archivePath,
      repoPath: repo,
      previewsDir,
      items: items.map((it) => ({
        ...it,
        characterName: charName(it.characterId),
        skinName: it.skinId ? skinName(it.skinId) : '',
      })),
    })
  })

  // ---- 角色皮肤 ----
  ipcMain.handle('characters:list', () => db.listCharacters())
  ipcMain.handle('characters:add', (_e, name) => db.addCharacter(String(name || '').trim()))
  ipcMain.handle('characters:setStar', (_e, { id, starred }) => db.setCharacterStarred(id, starred))
  ipcMain.handle('characters:rename', async (_e, { id, name }) => {
    const s = db.getSettings()
    if (!s.repoPath) throw new Error('请先在设置中配置 mod 存放目录')
    return categorize.renameCharacter(id, String(name || '').trim())
  })
  ipcMain.handle('characters:delete', async (_e, id) => {
    const s = db.getSettings()
    if (!s.repoPath) throw new Error('请先在设置中配置 mod 存放目录')
    return categorize.deleteCharacter(id)
  })
  ipcMain.handle('skins:list', () => db.listSkins())
  ipcMain.handle('skins:add', (_e, { characterId, name }) =>
    db.addSkin(Number(characterId), String(name || '').trim())
  )
  ipcMain.handle('skins:rename', async (_e, { id, name }) => {
    const s = db.getSettings()
    if (!s.repoPath) throw new Error('请先在设置中配置 mod 存放目录')
    return categorize.renameSkin(id, String(name || '').trim())
  })
  ipcMain.handle('skins:delete', async (_e, id) => {
    const s = db.getSettings()
    if (!s.repoPath) throw new Error('请先在设置中配置 mod 存放目录')
    return categorize.deleteSkin(id)
  })

  // ---- mods ----
  ipcMain.handle('mods:list', () => db.listMods().map(withLiveStatus))

  ipcMain.handle('mods:update', (_e, { id, fields }) => withLiveStatus(db.updateMod(id, fields)))

  ipcMain.handle('mods:setEnabled', (_e, { id, enabled }) => {
    const mod = db.getMod(id)
    if (!mod) throw new Error('mod 不存在')
    const updated = enableModSystem(withLiveStatus(mod), enabled)
    return withLiveStatus(updated)
  })

  ipcMain.handle('mods:delete', async (_e, id) => {
    const mod = db.getMod(id)
    if (mod) {
      const s = db.getSettings()
      if (s.modsPath) {
        // 先撤联接（幂等，失败不阻断删除，稍后启动校验会清理）
        junctions.removeJunction(path.join(s.modsPath, path.basename(mod.folderPath)))
      }
      const folder = s.repoPath ? path.join(s.repoPath, mod.folderPath) : null
      for (const p of [folder, mod.previewPath]) {
        if (p && fs.existsSync(p)) await shell.trashItem(p).catch(() => {})
      }
    }
    db.deleteMod(id)
    return { ok: true }
  })

  ipcMain.handle('mods:openFolder', async (_e, id) => {
    const mod = db.getMod(id)
    const repo = db.getSettings().repoPath
    if (!mod || !repo) throw new Error('未找到 mod 目录')
    const folder = path.join(repo, mod.folderPath)
    if (!fs.existsSync(folder)) throw new Error('mod 文件夹已丢失')
    await shell.openPath(folder)
    return { ok: true }
  })

  ipcMain.handle('mods:setPreviewFromClipboard', async (_e, id) => {
    const img = await clipboardImage()
    if (!img) return { ok: false, reason: 'empty' }
    const file = path.join(previewsDir, `${id}.png`)
    fs.writeFileSync(file, img.toPNG())
    // previewVersion = 文件 mtime：渲染层把它拼进 URL 强制 <img> 重新加载（配合协议禁缓存）
    const mod = withLiveStatus(db.updateMod(id, { previewPath: file }))
    mod.previewVersion = fs.statSync(file).mtimeMs
    return { ok: true, mod }
  })

  ipcMain.handle('mods:setPreviewFromFile', async (_e, id) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择预览图',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile'],
    })
    if (r.canceled || !r.filePaths.length) return { ok: false, reason: 'cancel' }
    const src = r.filePaths[0]
    const ext = path.extname(src).toLowerCase() || '.png'
    const file = path.join(previewsDir, `${id}${ext}`)
    fs.copyFileSync(src, file)
    // 换图后清理旧扩展名的预览文件（如 3.png → 3.jpg）
    for (const old of fs.readdirSync(previewsDir)) {
      const p = path.join(previewsDir, old)
      if (old.startsWith(`${id}.`) && p !== file) fs.rmSync(p, { force: true })
    }
    const mod = withLiveStatus(db.updateMod(id, { previewPath: file }))
    mod.previewVersion = fs.statSync(file).mtimeMs
    return { ok: true, mod }
  })

  ipcMain.handle('mods:clearPreview', (_e, id) => {
    const cur = db.getMod(id)
    if (cur?.previewPath && fs.existsSync(cur.previewPath)) fs.rmSync(cur.previewPath, { force: true })
    return withLiveStatus(db.updateMod(id, { previewPath: null }))
  })

  // ---- 预设 ----
  ipcMain.handle('presets:list', () => db.listPresets())
  ipcMain.handle('presets:add', (_e, { name, modIds }) => db.addPreset(String(name || '').trim(), modIds || []))
  ipcMain.handle('presets:rename', (_e, { id, name }) => db.renamePreset(id, String(name || '').trim()))
  ipcMain.handle('presets:delete', (_e, id) => {
    db.deletePreset(id)
    return { ok: true }
  })
  ipcMain.handle('presets:setMembers', (_e, { id, modIds }) => {
    db.setPresetMembers(id, modIds || [])
    return db.listPresets()
  })
  ipcMain.handle('presets:apply', (_e, id) => {
    // 差量：启用集 ⇄ 预设成员，逐个走真实联接操作
    const preset = db.listPresets().find((p) => p.id === id)
    if (!preset) throw new Error('预设不存在')
    const target = new Set(preset.modIds)
    const applied = { enabled: 0, disabled: 0, errors: [] }
    for (const m of db.listMods()) {
      const should = target.has(m.id) && m.status !== 'lost'
      if (should === m.enabled) continue
      try {
        enableModSystem(m, should)
        applied[should ? 'enabled' : 'disabled'] += 1
      } catch (err) {
        applied.errors.push({ name: m.name, message: err.message })
      }
    }
    return applied
  })

  ipcMain.handle('system:startupSync', () => runStartupSync())

  // ---- AI 快捷键识别（OpenAI 兼容接口；图片在发送前压缩）----
  ipcMain.handle('ai:recognize', (_e, payload) => {
    const imageDataUrl = payload?.imageDataUrl
      ? ai.compressImageDataUrl(payload.imageDataUrl)
      : null
    return ai.recognizeHotkeys(db.getSettings(), { text: payload?.text, imageDataUrl })
  })
  ipcMain.handle('ai:test', (_e, override) =>
    ai.testConnection({ ...db.getSettings(), ...(override || {}) })
  )
  ipcMain.handle('ai:readClipboardImage', async () => {
    const img = await clipboardImage()
    if (!img) return { ok: false, reason: 'empty' }
    return { ok: true, dataUrl: img.toDataURL() }
  })
  ipcMain.handle('ai:pickImage', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择快捷键截图',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
      properties: ['openFile'],
    })
    if (r.canceled || !r.filePaths.length) return { ok: false, reason: 'cancel' }
    try {
      return { ok: true, dataUrl: ai.fileToPreviewDataUrl(r.filePaths[0]), name: path.basename(r.filePaths[0]) }
    } catch (err) {
      return { ok: false, reason: 'unreadable', message: err.message }
    }
  })

  // ini 快捷键：本地解析 mod 目录下全部 .ini（词典命中的已带中文描述）
  ipcMain.handle('ai:scanModInis', (_e, modId) => {
    const mod = db.getMod(modId)
    const repo = db.getSettings().repoPath
    if (!mod || !repo) throw new Error('未找到 mod 目录')
    const dir = path.join(repo, mod.folderPath)
    if (!fs.existsSync(dir)) throw new Error('mod 文件夹已丢失，无法读取 ini')
    const files = iniHotkeys.listIniFiles(dir)
    const bindings = []
    for (const f of files) {
      try {
        const text = fs.readFileSync(f, 'utf8')
        bindings.push(...iniHotkeys.parseIniText(text, path.relative(dir, f)))
      } catch { /* 单个 ini 读取失败不阻断 */ }
    }
    const merged = iniHotkeys.mergeBindings(bindings)
    return {
      iniCount: files.length,
      bindings: merged,
      dictHit: merged.filter((b) => b.desc).length,
      uiCount: merged.filter((b) => b.ui).length,
    }
  })

  // ini 绑定的 AI 标注（只发解析后的精简条目；敏感词过滤在渲染层完成）
  ipcMain.handle('ai:labelIni', (_e, { items }) => ai.labelIniBindings(db.getSettings(), items))
}

function charName(id) {
  const c = db.listCharacters().find((x) => x.id === id)
  return c ? c.name : '未分类'
}
function skinName(id) {
  const s = db.listSkins().find((x) => x.id === id)
  return s ? s.name : ''
}
