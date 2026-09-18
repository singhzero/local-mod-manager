// 导入管线冒烟测试（直接用系统 node 运行，不经 Electron）
// 覆盖：7z 探测 → 结构识别（单包/多包）→ 解压 → 归档入库 → 预览图提取 → 重名去重
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execSync } = require('node:child_process')
const db = require('./electron/db.cjs')
const importer = require('./electron/importer.cjs')

const ROOT = path.join(os.tmpdir(), `zmm-smoke-${Date.now()}`)
const FIXTURES = path.join(ROOT, 'fixtures')
const REPO = path.join(ROOT, 'repo')
const PREVIEWS = path.join(ROOT, 'previews')
const DB_FILE = path.join(ROOT, 'catalog.db')
const SEVENZIP = 'C:\\Program Files\\7-Zip\\7z.exe'

function makeMod(dir, withPreview = true) {
  fs.mkdirSync(path.join(dir, 'textures'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'mod.ini'), `[MOD]\nname=${path.basename(dir)}\n`)
  fs.writeFileSync(path.join(dir, 'textures', 'body.dds'), Buffer.alloc(1024, 7))
  if (withPreview) fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
}

function zip(srcDir, outZip) {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${outZip}' -Force"`)
}

let failed = 0
function assert(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label)
  if (!cond) failed += 1
}

async function main() {
  // ---- 造测试数据 ----
  fs.mkdirSync(path.join(FIXTURES, 'single-src', 'Ellen_SharkTail'), { recursive: true })
  makeMod(path.join(FIXTURES, 'single-src', 'Ellen_SharkTail'))
  zip(path.join(FIXTURES, 'single-src'), path.join(FIXTURES, 'single_mod.zip'))

  fs.mkdirSync(path.join(FIXTURES, 'multi-src', 'Nico_A'), { recursive: true })
  fs.mkdirSync(path.join(FIXTURES, 'multi-src', 'Nico_B'), { recursive: true })
  makeMod(path.join(FIXTURES, 'multi-src', 'Nico_A'), false)
  makeMod(path.join(FIXTURES, 'multi-src', 'Nico_B'))
  zip(path.join(FIXTURES, 'multi-src'), path.join(FIXTURES, 'multi_mod.zip'))

  // ---- 初始化库与角色 ----
  db.initDb(DB_FILE)
  importer.wireDb({ insertMod: db.insertMod, updateMod: db.updateMod })
  fs.mkdirSync(PREVIEWS, { recursive: true })
  const byName = Object.fromEntries(db.listCharacters().map((c) => [c.name, c]))
  const ellen = byName['角色1'] // 来自内置种子
  const nico = byName['角色3'] // 来自内置种子
  const skin = db.addSkin(nico.id, '默认')

  // ---- 1) 7-Zip 探测 ----
  console.log('\n[1] 7-Zip 探测')
  assert(importer.detectSevenZip('') === SEVENZIP, '自动探测到 7z.exe')
  assert(importer.detectSevenZip('X:\\不存在\\7z.exe') === SEVENZIP, '无效配置回退到探测')

  // ---- 2) 结构识别：单 mod 包 ----
  console.log('\n[2] 结构识别')
  const singleZip = path.join(FIXTURES, 'single_mod.zip')
  const entries1 = await importer.listArchive(SEVENZIP, singleZip)
  const s1 = importer.detectStructure(entries1, 'single_mod.zip')
  assert(s1.kind === 'single' && s1.folders[0] === 'Ellen_SharkTail' && !s1.wrap, '单 mod 包识别正确')

  const multiZip = path.join(FIXTURES, 'multi_mod.zip')
  const entries2 = await importer.listArchive(SEVENZIP, multiZip)
  const s2 = importer.detectStructure(entries2, 'multi_mod.zip')
  assert(s2.kind === 'multi' && s2.folders.length === 2, '多 mod 包识别出 2 个文件夹')

  // ---- 3) 导入：单 mod → 角色1 ----
  console.log('\n[3] 导入单 mod 包')
  const created1 = await importer.importExecute({
    exe: SEVENZIP, archivePath: singleZip, repoPath: REPO, previewsDir: PREVIEWS,
    items: [{ folder: 'Ellen_SharkTail', name: 'modA', characterId: ellen.id, characterName: '角色1', skinId: null, skinName: '' }],
  })
  assert(created1.length === 1, '入库 1 条记录')
  const m1 = created1[0]
  assert(fs.existsSync(path.join(REPO, '角色1', 'modA', 'mod.ini')), '仓库目录结构正确 {角色}/{mod}')
  assert(m1.folderPath === path.join('角色1', 'modA'), 'folder_path 相对路径正确')
  assert(m1.sizeBytes > 0, '体积统计 > 0')
  assert(typeof m1.contentHash === 'string' && m1.contentHash.length === 12, '内容哈希已生成')
  assert(m1.previewPath && fs.existsSync(m1.previewPath), '预览图已提取（跳过 textures 目录）')

  // ---- 4) 导入：多 mod 包拆分 → 角色3（其中一个带皮肤）----
  console.log('\n[4] 导入多 mod 包（拆分）')
  const created2 = await importer.importExecute({
    exe: SEVENZIP, archivePath: multiZip, repoPath: REPO, previewsDir: PREVIEWS,
    items: [
      { folder: 'Nico_A', name: 'modB', characterId: nico.id, characterName: '角色3', skinId: null, skinName: '' },
      { folder: 'Nico_B', name: 'modC', characterId: nico.id, characterName: '角色3', skinId: skin.id, skinName: '默认' },
    ],
  })
  assert(created2.length === 2, '拆分入库 2 条记录')
  assert(fs.existsSync(path.join(REPO, '角色3', 'modB', 'mod.ini')), '无皮肤 → {角色}/{mod}')
  assert(fs.existsSync(path.join(REPO, '角色3', '默认', 'modC', 'mod.ini')), '带皮肤 → {角色}/{皮肤}/{mod}')
  assert(created2[0].previewPath === null, '无图片的 mod 预览为空')

  // ---- 5) 重名去重 ----
  console.log('\n[5] 重名去重')
  const created3 = await importer.importExecute({
    exe: SEVENZIP, archivePath: singleZip, repoPath: REPO, previewsDir: PREVIEWS,
    items: [{ folder: 'Ellen_SharkTail', name: 'modA', characterId: ellen.id, characterName: '角色1', skinId: null, skinName: '' }],
  })
  assert(fs.existsSync(path.join(REPO, '角色1', 'modA (2)')), '重名自动加后缀 (2)')

  // ---- 6) 库内校验 + 预设应用 ----
  console.log('\n[6] 数据库校验')
  const mods = db.listMods()
  assert(mods.length === 4, `mods 表共 4 条（实际 ${mods.length}）`)
  assert(mods.every((m) => m.characterName), '联表查询带出角色名')
  db.setModEnabled(m1.id, true)
  const p = db.addPreset('主线常驻', [m1.id])
  const diff = db.applyPreset(p.id)
  assert(diff.toDisable.length === 0 && diff.toEnable.length === 0, `启用集已与预设一致（启用 ${diff.toEnable.length} / 停用 ${diff.toDisable.length}）`)
  assert(db.listMods().find((m) => m.id === created2[0].id).enabled === false, '不在预设中的 mod（modB）被停用')
  db.renamePreset(p.id, '主线')
  assert(db.listPresets().find((x) => x.id === p.id).name === '主线', '预设重命名')

  // ---- 7) 目录联接调度（Phase 4 核心）----
  console.log('\n[7] 目录联接调度')
  const junctions = require('./electron/junctions.cjs')
  const MODS_DIR = path.join(ROOT, 'Mods')
  fs.mkdirSync(MODS_DIR, { recursive: true })
  const targetDir = path.join(REPO, '角色1', 'modA')
  const linkPath = path.join(MODS_DIR, 'modA')
  const nicoA = path.join(REPO, '角色3', 'modB')

  assert(junctions.createJunction(linkPath, targetDir).action === 'created', '创建联接')
  assert(fs.existsSync(path.join(linkPath, 'mod.ini')), '联接透传真身文件')
  assert(junctions.createJunction(linkPath, targetDir).action === 'exists', '重复创建幂等')
  assert(junctions.createJunction(linkPath, nicoA).reason === 'occupied-link', '同名校验：已指向其他目标')
  junctions.removeJunction(linkPath)
  fs.mkdirSync(linkPath)
  assert(junctions.createJunction(linkPath, targetDir).reason === 'occupied-dir', '同名校验：真实目录占用')
  fs.rmdirSync(linkPath)
  junctions.createJunction(linkPath, targetDir)
  junctions.removeJunction(linkPath)
  assert(!fs.existsSync(linkPath), '移除联接')
  assert(fs.existsSync(path.join(targetDir, 'mod.ini')), '移除后真身完好')

  // 启动一致性同步场景
  const brokenTarget = path.join(REPO, '角色1', '临时目标')
  fs.mkdirSync(brokenTarget)
  junctions.createJunction(path.join(MODS_DIR, '断链联接'), brokenTarget)
  fs.rmSync(brokenTarget, { recursive: true })
  junctions.createJunction(path.join(MODS_DIR, '外部联接'), path.join(FIXTURES, 'multi-src', 'Nico_A'))
  fs.mkdirSync(path.join(MODS_DIR, '手动目录'))
  junctions.createJunction(path.join(MODS_DIR, 'modB'), nicoA) // 库里未启用

  const modsNow = db.listMods()
  const view = junctions.syncEnabledView({
    modsPath: MODS_DIR,
    repoPath: REPO,
    mods: modsNow.map((m) => ({ id: m.id, folderPath: m.folderPath, enabled: m.enabled, status: m.status })),
  })
  assert(view.orphansRemoved.includes('断链联接'), '断链联接被清理')
  assert(!junctions.isJunction(path.join(MODS_DIR, '断链联接')), '断链联接已实际删除')
  assert(view.external.includes('外部联接'), '外部联接不被动')
  assert(view.manualDirs.includes('手动目录'), '手动目录不被动')
  assert(view.healed.includes('modA'), '库启用但联接缺失 → 补建')
  assert(view.flags.some((f) => f.id === created2[0].id && f.enabled === true), '联接存在但库未启用 → 标志补开')
  assert(fs.existsSync(path.join(MODS_DIR, 'modA')), '自愈后联接存在')
  for (const f of view.flags) db.setModEnabled(f.id, f.enabled)
  assert(db.listMods().find((m) => m.id === created2[0].id).enabled === true, '同步后数据库标志一致')

  // ---- 8) 分类重命名与删除 ----
  console.log('\n[8] 分类重命名与删除')
  db.setSettings({ repoPath: REPO, modsPath: MODS_DIR }) // categorize 依赖仓库/加载目录配置
  const createCategorize = require('./electron/categorize.cjs')
  const categorize = createCategorize({ db, junctions, importer })
  const normTarget = (t) => path.resolve(String(t).replace(/^\\\\\?\\/, '')).toLowerCase()

  const nicoSkins = () => db.listSkins().filter((s) => s.characterId === nico.id)
  const defaultSkin = nicoSkins().find((s) => s.name === '默认')

  // 皮肤重命名：目录移动 + folder_path 更新
  const rSkin = await categorize.renameSkin(defaultSkin.id, '夏日')
  assert(rSkin.moved === 1 && rSkin.errors.length === 0, '皮肤重命名：mod 目录同步移动')
  assert(fs.existsSync(path.join(REPO, '角色3', '夏日', 'modC', 'mod.ini')), '新皮肤目录正确')
  assert(
    db.listMods().find((m) => m.id === created2[1].id).folderPath === path.join('角色3', '夏日', 'modC'),
    'folder_path 已更新'
  )
  const skin2 = db.addSkin(nico.id, '限定')
  let threw = false
  try { await categorize.renameSkin(defaultSkin.id, '限定') } catch { threw = true }
  assert(threw, '同角色下重名皮肤被拒绝')
  db.deleteSkin(skin2.id)

  // 角色重命名（modB 启用中，联接应重建指向新路径）
  const rChar = await categorize.renameCharacter(nico.id, '角色A')
  assert(rChar.moved === 2 && rChar.errors.length === 0, '角色重命名：2 个 mod 目录移动')
  assert(fs.existsSync(path.join(REPO, '角色A', 'modB', 'mod.ini')), '新角色目录（无皮肤层）')
  assert(fs.existsSync(path.join(REPO, '角色A', '夏日', 'modC', 'mod.ini')), '皮肤层级保持')
  const nicoALink = path.join(MODS_DIR, 'modB')
  assert(
    junctions.isJunction(nicoALink) &&
      normTarget(junctions.readTarget(nicoALink)) === normTarget(path.join(REPO, '角色A', 'modB')),
    '启用联接已重建指向新路径'
  )

  // 角色删除：mod 移入未分类 + 皮肤级联删除 + 联接跟随迁移
  const rDel = await categorize.deleteCharacter(nico.id)
  assert(rDel.moved === 2, '删除角色：2 个 mod 移入未分类')
  assert(fs.existsSync(path.join(REPO, '_未分类', 'modB', 'mod.ini')), '未分类目录正确')
  assert(db.listMods().find((m) => m.id === created2[0].id).characterId === null, '归属已清空')
  assert(!db.listCharacters().some((c) => c.id === nico.id), '角色已删除')
  assert(!db.listSkins().some((s) => s.characterId === nico.id), '皮肤级联删除')
  assert(
    junctions.readTarget(nicoALink) && normTarget(junctions.readTarget(nicoALink)).includes('_未分类'),
    '启用联接跟随迁移到未分类'
  )

  // 删除皮肤：mod 上移到角色根目录
  const ellenSkin = db.addSkin(ellen.id, '测试皮肤')
  db.updateMod(m1.id, { skinId: ellenSkin.id })
  const m1Old = db.listMods().find((m) => m.id === m1.id)
  fs.mkdirSync(path.join(REPO, '角色1', '测试皮肤'), { recursive: true })
  fs.renameSync(path.join(REPO, '角色1', 'modA'), path.join(REPO, '角色1', '测试皮肤', 'modA'))
  db.updateMod(m1.id, { folderPath: path.join('角色1', '测试皮肤', 'modA') })
  const rUp = await categorize.deleteSkin(ellenSkin.id)
  assert(rUp.moved === 1, '删除皮肤：mod 上移')
  assert(fs.existsSync(path.join(REPO, '角色1', 'modA', 'mod.ini')), '上移到角色根目录')
  assert(db.listMods().find((m) => m.id === m1.id).skinId === null, '皮肤归属清空')

  // ---- 9) 角色排序与星标置顶 ----
  console.log('\n[9] 角色排序与星标置顶')
  const byCount = () => {
    const sorted = db.listCharacters()
    const n = (c) => db.listMods().filter((m) => m.characterId === c.id).length
    return { sorted, n }
  }
  const base = byCount()
  const maxChar = [...base.sorted].sort((a, b) => base.n(b) - base.n(a))[0]
  assert(base.sorted[0].id === maxChar.id, '默认按 mod 数量降序')
  db.setCharacterStarred(base.sorted[base.sorted.length - 1].id, true)
  const starred = byCount()
  const lastId = base.sorted[base.sorted.length - 1].id
  assert(starred.sorted[0].id === lastId, '星标角色置顶（即使 mod 数为 0）')
  assert(starred.sorted.slice(1).every((c) => !c.starred), '星标组之后全为未星标')
  const restCounts = starred.sorted.slice(1).map((c) => starred.n(c))
  assert(restCounts.every((v, i) => i === 0 || restCounts[i - 1] >= v), '未星标组内仍按数量降序')
  db.setCharacterStarred(lastId, false)
  assert(db.listCharacters().find((c) => c.id === lastId).starred === false, '取消星标写库')

  console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`} — 工作目录 ${ROOT}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err)
  process.exit(1)
})
