// ===== 演示用 mock 数据（正式实现中由 SQLite 数据层提供；全部为虚构名称）=====

export const seedCharacters = [
  { id: 'c1', name: '角色1', color: '#7dd3fc' },
  { id: 'c2', name: '角色2', color: '#fda4af' },
  { id: 'c3', name: '角色3', color: '#fcd34d' },
  { id: 'c4', name: '角色4', color: '#93c5fd' },
  { id: 'c5', name: '角色5', color: '#6ee7b7' },
  { id: 'c6', name: '角色6', color: '#c4b5fd' },
  { id: 'c7', name: '角色7', color: '#fdba74' },
]

// 每个角色默认带「原皮」皮肤分类（与桌面版数据层一致）
export const seedSkins = [
  { id: 's1', characterId: 'c1', name: '原皮' },
  { id: 's2', characterId: 'c1', name: '皮肤1' },
  { id: 's3', characterId: 'c2', name: '原皮' },
  { id: 's4', characterId: 'c6', name: '原皮' },
  { id: 's5', characterId: 'c6', name: '皮肤1' },
  { id: 's6', characterId: 'c3', name: '原皮' },
  { id: 's7', characterId: 'c4', name: '原皮' },
  { id: 's8', characterId: 'c5', name: '原皮' },
  { id: 's9', characterId: 'c7', name: '原皮' },
]

let seq = 0
function mod(data) {
  seq += 1
  return {
    id: 'm' + seq,
    characterId: null,
    skinId: null,
    enabled: false,
    status: 'normal', // normal | lost | conflict
    hotkey: null,
    source: '未知来源.zip',
    size: '12.0 MB',
    importedAt: '2026-08-20',
    hash: 'a1b2c3d4',
    ...data,
  }
}

export const seedMods = [
  mod({ name: 'mod1', characterId: 'c1', skinId: 's1', enabled: true, source: 'pack1.zip', size: '86.3 MB', importedAt: '2026-08-21', hash: '9f13c0e2' }),
  mod({ name: 'mod2', characterId: 'c1', skinId: 's2', source: 'pack2.7z', size: '42.1 MB', importedAt: '2026-08-21', hash: '51ab77f0' }),
  mod({ name: 'mod3', characterId: 'c1', skinId: 's1', enabled: true, source: 'pack3.zip', size: '8.9 MB', importedAt: '2026-08-22', hash: 'cc0491bb' }),
  mod({ name: 'mod4', characterId: 'c1', skinId: 's1', status: 'lost', source: 'pack4.rar', size: '—', importedAt: '2026-07-02', hash: '0000dead' }),
  mod({ name: 'mod5', characterId: 'c2', skinId: 's3', source: 'pack5.zip', size: '5.2 MB', importedAt: '2026-08-18', hash: '77de51aa' }),
  mod({ name: 'mod6', characterId: 'c2', skinId: 's3', enabled: true, status: 'conflict', source: 'pack6.zip', size: '128.6 MB', importedAt: '2026-08-19', hash: '12ba90fe' }),
  mod({ name: 'mod7', characterId: 'c2', skinId: 's3', enabled: true, status: 'conflict', source: 'pack7.zip', size: '64.2 MB', importedAt: '2026-07-28', hash: '3311cc8d' }),
  mod({ name: 'mod8', characterId: 'c3', skinId: 's6', source: 'pack8.7z', size: '3.1 MB', importedAt: '2026-08-10', hash: 'be22d1c9' }),
  mod({ name: 'mod9', characterId: 'c4', skinId: 's7', enabled: true, source: 'pack9.rar', size: '17.8 MB', importedAt: '2026-08-12', hash: '6a4ce001' }),
  mod({ name: 'mod10', characterId: 'c5', skinId: 's8', source: 'pack10.zip', size: '22.4 MB', importedAt: '2026-08-15', hash: 'd9081fa3' }),
  mod({ name: 'mod11', characterId: 'c6', skinId: 's4', enabled: true, source: 'pack11.zip', size: '31.5 MB', importedAt: '2026-08-25', hotkey: 'Ctrl+Shift+1', hash: '44f7b210' }),
  mod({ name: 'mod12', characterId: 'c6', skinId: 's5', source: 'pack12.7z', size: '55.0 MB', importedAt: '2026-08-25', hash: '8802ff6b' }),
  mod({ name: 'mod13', characterId: 'c7', skinId: 's9', enabled: true, source: 'pack13.zip', size: '6.7 MB', importedAt: '2026-08-26', hash: '19ca34de' }),
  mod({ name: 'mod14（未分类演示）', source: 'misc_textures_pack.zip', size: '48.9 MB', importedAt: '2026-08-14', hash: '5e6d9081' }),
]

// 预设：默认预设为空（已定稿决策），另含一个演示预设
export const seedPresets = [
  { id: 'p1', name: '默认预设', modIds: [], locked: true },
  { id: 'p2', name: '预设1', modIds: ['m1', 'm3', 'm9', 'm11', 'm13'] },
]

// 导入向导演示用的“已选压缩包”
export const demoPickedFiles = [
  { name: 'pack1.zip', size: '86.3 MB' },
  { name: 'pack2.7z', size: '154.2 MB' },
]

// 演示用结构识别结果：zip 单 mod；7z 内含 3 个 mod 文件夹
export function detectStructure(fileName) {
  if (fileName.endsWith('.7z')) {
    return {
      kind: 'multi',
      folders: ['mod1', 'mod2', 'mod3'],
    }
  }
  return {
    kind: 'single',
    folders: [fileName.replace(/\.(zip|7z|rar)$/i, '')],
  }
}
