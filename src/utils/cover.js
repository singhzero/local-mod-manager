// 程序生成占位封面（SVG data URI），替代真实预览图 —— 浅色版本

export function coverDataUri(title, color = '#b491c9') {
  const initial = (title || '?').trim().charAt(0).toUpperCase()
  const ink = shade(color, -0.38) // 浅色底上用加深色保证可读
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="${color}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.85"/>
    </linearGradient>
    <pattern id="p" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
      <rect width="26" height="26" fill="none"/>
      <rect width="11" height="26" fill="#ffffff" opacity="0.35"/>
    </pattern>
  </defs>
  <rect width="480" height="360" fill="#fafafc"/>
  <rect width="480" height="360" fill="url(#p)"/>
  <rect width="480" height="360" fill="url(#g)"/>
  <circle cx="392" cy="72" r="130" fill="#ffffff" opacity="0.4"/>
  <text x="34" y="248" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="150" font-weight="800" fill="${ink}" opacity="0.8">${initial}</text>
  <text x="38" y="330" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="13" fill="#8f89a3" opacity="0.85">占位预览图 · Phase 2 接入真实贴图</text>
</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

// hex 颜色按比例变深 / 变浅（f < 0 变深）
function shade(hex, f) {
  const n = hex.replace('#', '')
  const v = parseInt(n, 16)
  const ch = (shift) => (v >> shift) & 0xff
  const mix = (c) => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f)
  const r = mix(ch(16)).toString(16).padStart(2, '0')
  const g = mix(ch(8)).toString(16).padStart(2, '0')
  const b = mix(ch(0)).toString(16).padStart(2, '0')
  return '#' + r + g + b
}
