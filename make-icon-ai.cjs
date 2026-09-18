// 图标合成：AI 粉渐变背景 → 裁切/拉正 → 白色矢量 Z（超采样）→ 圆角 → 多尺寸 → ICO
// 运行：node make-icon-ai.cjs
const fs = require('node:fs')
const path = require('node:path')
const Jimp = require('jimp')

const SRC = 'build/ai/bg-33.png'
const OUT_DIR = 'build/icon-png'
const SIZES = [256, 128, 64, 48, 32, 16]
const MASTER = 512
const RADIUS_RATIO = 0.225

// 块状 Z 轮廓（单位坐标）
const Z = [
  [0.27, 0.22], [0.73, 0.22], [0.73, 0.335], [0.42, 0.665], [0.73, 0.665],
  [0.73, 0.78], [0.27, 0.78], [0.27, 0.665], [0.58, 0.335], [0.27, 0.335],
]

function inPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// 在 n×n 画布上光栅化 Z，返回 {x,y} 命中集合的 alpha 掩码（0/255）
function rasterizeZ(n) {
  const poly = Z.map(([x, y]) => [x * n, y * n])
  const mask = Buffer.alloc(n * n, 0)
  let minX = n, minY = n, maxX = 0, maxY = 0
  for (const [x, y] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY) && y < n; y++) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX) && x < n; x++) {
      // 像素中心采样
      if (inPolygon(x + 0.5, y + 0.5, poly)) mask[y * n + x] = 255
    }
  }
  return mask
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // 1) 裁掉 AI 图留白，取内部安全区，拉伸到 512 主图
  const src = await Jimp.read(SRC)
  const W = src.bitmap.width, H = src.bitmap.height
  const cx = Math.round(W * 0.185), cy = Math.round(H * 0.175)   // 裁掉四周留白（含轻微透视边）
  const cw = W - cx * 2, ch = H - cy * 2
  src.crop(cx, cy, cw, ch).resize(MASTER, MASTER)
  console.log('[icon] background cropped/resized', cw, 'x', ch, '->', MASTER)

  // 2) 白色 Z：1024 超采样光栅化 → 缩到 512（抗锯齿）→ 作为白色图层的 alpha
  const Z_N = 1024
  const zMask = new Jimp(Z_N, Z_N, 0x00000000)
  const zm = rasterizeZ(Z_N)
  zMask.scan(0, 0, Z_N, Z_N, function (x, y, idx) {
    this.bitmap.data[idx + 0] = 255
    this.bitmap.data[idx + 1] = 255
    this.bitmap.data[idx + 2] = 255
    this.bitmap.data[idx + 3] = zm[y * Z_N + x]
  })
  const zLayer = (await zMask.resize(MASTER, MASTER)).clone()

  // 叠加：轻微下移阴影增加立体感 + 白色 Z 主体
  const shadow = (await zMask.resize(MASTER, MASTER)).clone()
  shadow.scan(0, 0, MASTER, MASTER, function (x, y, idx) {
    this.bitmap.data[idx + 0] = 120   // 深粉阴影色
    this.bitmap.data[idx + 1] = 30
    this.bitmap.data[idx + 2] = 80
  })
  src.composite(shadow, 0, 3, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 0.25 })
  src.composite(zLayer, 0, 0)

  // 3) 圆角透明：超采样掩码（2048）→ 缩小得到软边 alpha
  const M = 2048
  const mask = new Jimp(M, M, 0x00000000)
  const r = M * RADIUS_RATIO
  mask.scan(0, 0, M, M, function (x, y, idx) {
    const px = x + 0.5, py = y + 0.5
    let inside = true
    const cxr = Math.min(Math.max(px, r), M - r)
    const cyr = Math.min(Math.max(py, r), M - r)
    if ((px - cxr) * (px - cxr) + (py - cyr) * (py - cyr) > r * r) {
      // 四个角外
      if ((px < r || px > M - r) && (py < r || py > M - r)) inside = false
    }
    this.bitmap.data[idx + 3] = inside ? 255 : 0
  })
  const softMask = await mask.resize(MASTER, MASTER)

  src.scan(0, 0, MASTER, MASTER, function (x, y, idx) {
    this.bitmap.data[idx + 3] = Math.min(this.bitmap.data[idx + 3], softMask.bitmap.data[idx + 3])
  })

  // 4) 多尺寸输出
  for (const s of SIZES) {
    const out = (await src.clone().resize(s, s)).write(path.join(OUT_DIR, `icon-${s}.png`))
    void out
  }
  await src.writeAsync('build/ai/icon-master-512.png')
  console.log('[icon] pngs written to', OUT_DIR)

  // 5) 打包 ICO（PNG 内嵌格式）
  const pngs = SIZES.map((s) => ({ s, data: fs.readFileSync(path.join(OUT_DIR, `icon-${s}.png`)) }))
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4)
  const entries = []
  let offset = 6 + 16 * count
  for (const { s, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(s >= 256 ? 0 : s, 0)
    e.writeUInt8(s >= 256 ? 0 : s, 1)
    e.writeUInt8(0, 2); e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }
  fs.writeFileSync('build/icon.ico', Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]))
  console.log('[icon] build/icon.ico written,', fs.statSync('build/icon.ico').size, 'bytes')
}

main().catch((e) => { console.error(e); process.exit(1) })
