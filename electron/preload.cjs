// preload：以受控 API 形式向渲染进程暴露主进程能力
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('zmm', {
  mode: 'electron',

  appInfo: () => ipcRenderer.invoke('app:info'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),

  pickDirectory: () => ipcRenderer.invoke('dir:pick'),
  validateDirectory: (dirPath) => ipcRenderer.invoke('dir:validate', dirPath),

  // 压缩包 / 导入
  pickArchiveFiles: () => ipcRenderer.invoke('files:pickArchives'),
  pickSevenZipFile: () => ipcRenderer.invoke('files:pickSevenZip'),
  detectSevenZip: () => ipcRenderer.invoke('sevenzip:detect'),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return null
    }
  },
  detectArchive: (archivePath) => ipcRenderer.invoke('archive:detect', archivePath),
  executeImport: (payload) => ipcRenderer.invoke('import:execute', payload),

  listCharacters: () => ipcRenderer.invoke('characters:list'),
  addCharacter: (name) => ipcRenderer.invoke('characters:add', name),
  setCharacterStar: (id, starred) => ipcRenderer.invoke('characters:setStar', { id, starred }),
  renameCharacter: (id, name) => ipcRenderer.invoke('characters:rename', { id, name }),
  deleteCharacter: (id) => ipcRenderer.invoke('characters:delete', id),
  listSkins: () => ipcRenderer.invoke('skins:list'),
  addSkin: (characterId, name) => ipcRenderer.invoke('skins:add', { characterId, name }),
  renameSkin: (id, name) => ipcRenderer.invoke('skins:rename', { id, name }),
  deleteSkin: (id) => ipcRenderer.invoke('skins:delete', id),

  listMods: () => ipcRenderer.invoke('mods:list'),
  updateMod: (id, fields) => ipcRenderer.invoke('mods:update', { id, fields }),
  setModEnabled: (id, enabled) => ipcRenderer.invoke('mods:setEnabled', { id, enabled }),
  deleteMod: (id) => ipcRenderer.invoke('mods:delete', id),
  openModFolder: (id) => ipcRenderer.invoke('mods:openFolder', id),
  setPreviewFromClipboard: (id) => ipcRenderer.invoke('mods:setPreviewFromClipboard', id),
  setPreviewFromFile: (id) => ipcRenderer.invoke('mods:setPreviewFromFile', id),
  clearPreview: (id) => ipcRenderer.invoke('mods:clearPreview', id),

  listPresets: () => ipcRenderer.invoke('presets:list'),
  addPreset: (name, modIds) => ipcRenderer.invoke('presets:add', { name, modIds }),
  renamePreset: (id, name) => ipcRenderer.invoke('presets:rename', { id, name }),
  deletePreset: (id) => ipcRenderer.invoke('presets:delete', id),
  setPresetMembers: (id, modIds) => ipcRenderer.invoke('presets:setMembers', { id, modIds }),
  applyPreset: (id) => ipcRenderer.invoke('presets:apply', id),
  startupSync: () => ipcRenderer.invoke('system:startupSync'),

  // AI 快捷键识别
  aiRecognize: (payload) => ipcRenderer.invoke('ai:recognize', payload),
  aiTest: (override) => ipcRenderer.invoke('ai:test', override),
  aiReadClipboardImage: () => ipcRenderer.invoke('ai:readClipboardImage'),
  aiPickImage: () => ipcRenderer.invoke('ai:pickImage'),
  scanModInis: (modId) => ipcRenderer.invoke('ai:scanModInis', modId),
  labelIni: (items) => ipcRenderer.invoke('ai:labelIni', { items }),
})
