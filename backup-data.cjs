// 应用数据备份：catalog.db + previews/ → backups/<时间戳>/
// 运行：node backup-data.cjs   （应用开着也能跑：优先走 SQLite 在线 backup API）
// 保留最近 10 份，更早的自动删除。mod 真身文件在你的仓库目录，
// 体积大且不可再生的只有这一个副本，如需容灾请自行对该目录做额外备份。
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const DATA_DIR = path.join(process.env.APPDATA, 'local-mod-manager')
const DB = path.join(DATA_DIR, 'catalog.db')
const PREVIEWS = path.join(DATA_DIR, 'previews')
const BACKUP_ROOT = path.join(__dirname, 'backups')
const KEEP = 10

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true })
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) await copyDir(s, d)
    else await fsp.copyFile(s, d)
  }
}

async function main() {
  if (!fs.existsSync(DB)) {
    console.error('✗ 未找到数据库：' + DB)
    process.exit(1)
  }
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const dest = path.join(BACKUP_ROOT, stamp)
  await fsp.mkdir(dest, { recursive: true })

  // SQLite 在线 backup API（一致性快照，应用运行中也可用）；不可用时回退普通复制
  const db = new DatabaseSync(DB)
  if (typeof db.backup === 'function') {
    await db.backup(path.join(dest, 'catalog.db'))
    console.log('✓ catalog.db（SQLite 在线快照）')
  } else {
    await fsp.copyFile(DB, path.join(dest, 'catalog.db'))
    console.log('✓ catalog.db（文件复制，建议关闭应用后执行）')
  }
  db.close()

  if (fs.existsSync(PREVIEWS)) {
    await copyDir(PREVIEWS, path.join(dest, 'previews'))
    console.log('✓ previews/')
  }

  // 清理：只保留最近 KEEP 份
  const all = (await fsp.readdir(BACKUP_ROOT)).filter((n) => /^\d{4}-\d{2}-\d{2}/.test(n)).sort()
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
    await fsp.rm(path.join(BACKUP_ROOT, old), { recursive: true, force: true })
    console.log('清理旧备份：' + old)
  }
  console.log(`备份完成 → ${dest}（保留最近 ${KEEP} 份）`)
}

main().catch((err) => {
  console.error('✗ 备份失败：', err.message)
  process.exit(1)
})
