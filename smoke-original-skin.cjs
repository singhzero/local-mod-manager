// 原皮皮肤分类冒烟测试（直接用系统 node 运行，不经 Electron）
// 覆盖：启动迁移补建原皮 / 未归皮肤 mod 归入原皮 / 悬空皮肤引用自愈 /
//       新建角色默认带原皮 / 原皮排序置顶 / 原皮不可删除 / 同名校验 / 未分类 mod 不受影响
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const db = require('./electron/db.cjs')

const ROOT = path.join(os.tmpdir(), `zmm-skin-smoke-${Date.now()}`)
const DB_FILE = path.join(ROOT, 'catalog.db')

let failed = 0
function assert(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label)
  if (!cond) failed += 1
}
function assertThrows(fn, label) {
  try {
    fn()
    assert(false, label + '（未抛错）')
  } catch (err) {
    assert(true, label + `（${err.message}）`)
  }
}

function skinsOf(charId) {
  return db.listSkins().filter((s) => s.characterId === charId)
}

function main() {
  fs.mkdirSync(ROOT, { recursive: true })

  // 1. 首次建库：种子角色全部自动带原皮
  const info = db.initDb(DB_FILE)
  assert(info.characters === 24, `建库种子角色 24 个（实际 ${info.characters}）`)
  const allHaveDefault = db.listCharacters().every((c) => skinsOf(c.id).some((s) => s.name === '原皮'))
  assert(allHaveDefault, '启动迁移：每个角色都补建了原皮皮肤')
  const seedSkins = db.listSkins()
  assert(seedSkins.every((s) => s.name === '原皮'), '迁移前不存在其他皮肤，只建原皮')

  // 2. 新建角色默认带原皮
  const charA = db.addCharacter('测试角色A')
  const aSkins = skinsOf(charA.id)
  assert(aSkins.length === 1 && aSkins[0].name === '原皮', '新建角色默认创建原皮皮肤')

  // 3. 原皮排序置顶
  const swim = db.addSkin(charA.id, '泳装')
  assert(skinsOf(charA.id)[0].name === '原皮' && skinsOf(charA.id)[1].id === swim.id, '皮肤列表原皮固定置顶')

  // 4. 未归皮肤的 mod 启动迁移后归入原皮
  const originalSkinId = aSkins[0].id
  const mod1 = db.insertMod({ name: 'M1', folderPath: '测试角色A/M1', characterId: charA.id, skinId: null })
  assert(mod1.skinId === null, '导入未选皮肤时 skin_id 为空')
  db.ensureOriginalSkins()
  assert(db.getMod(mod1.id).skinId === originalSkinId, '迁移：未归皮肤的 mod 归入角色原皮')

  // 5. 悬空皮肤引用自愈（皮肤被删 → FK 置空 → 重新归入原皮）
  const temp = db.addSkin(charA.id, '临时皮肤')
  db.updateMod(mod1.id, { skinId: temp.id })
  db.deleteSkin(temp.id) // 外键 ON DELETE SET NULL
  assert(db.getMod(mod1.id).skinId === null, '删除皮肤后 mod 皮肤引用置空')
  db.ensureOriginalSkins()
  assert(db.getMod(mod1.id).skinId === originalSkinId, '自愈：悬空引用的 mod 重新归入原皮')

  // 6. 未分类 mod（无角色）不受迁移影响
  const mod2 = db.insertMod({ name: 'M2', folderPath: '_未分类/M2', characterId: null, skinId: null })
  db.ensureOriginalSkins()
  assert(db.getMod(mod2.id).skinId === null && db.getMod(mod2.id).characterId === null, '未分类 mod 不被误归皮肤')

  // 7. 原皮不可删除 / 同名皮肤校验
  assertThrows(() => db.deleteSkin(originalSkinId), '数据库层删除原皮被拒绝')
  assertThrows(() => db.addSkin(charA.id, '原皮'), '同角色下重复建原皮被拒绝')
  assert(db.listSkins().some((s) => s.id === originalSkinId), '原皮删除尝试后仍存在')

  // 8. 再次 initDb（模拟重启）幂等：不重复建原皮、归类保持
  db.initDb(DB_FILE)
  assert(skinsOf(charA.id).filter((s) => s.name === '原皮').length === 1, '重启迁移幂等：不重复建原皮')
  assert(db.getMod(mod1.id).skinId === originalSkinId, '重启后归类保持')

  console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`} — 工作目录 ${ROOT}`)
  process.exit(failed === 0 ? 0 : 1)
}

try {
  main()
} catch (err) {
  console.error('SMOKE ERROR:', err)
  process.exit(1)
}
