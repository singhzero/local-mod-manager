// ===== 快捷键文本纯函数：敏感词行拦截、键位本地提取、格式化/解析 =====
// 供 HotkeyAIDialog（渲染层）与 smoke-ai.cjs（node 测试）共用，不依赖 Vue / Electron。

// ---- 敏感词 ----
// 词库由用户在设置页自行维护（每行一个词），应用不预置任何词条。
export function splitSensitiveWords(multiline) {
  return String(multiline || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

export function lineHitSensitive(line, words) {
  const lower = String(line || '').toLowerCase()
  return (words || []).some((w) => w && lower.includes(String(w).toLowerCase()))
}

// 按行拦截：命中敏感词的行被剥离，绝不进入发送给模型的内容
export function filterLinesBySensitive(text, words) {
  const lines = String(text || '').split(/\r?\n/)
  const kept = []
  const blocked = []
  for (const line of lines) {
    if (line.trim() && lineHitSensitive(line, words)) blocked.push(line.trim())
    else kept.push(line)
  }
  return { cleanText: kept.join('\n').trim(), blockedLines: blocked }
}

// ---- 键位本地提取（用于被拦截行的手动预填）----
const MOD = 'Ctrl|Shift|Alt|Win|Meta|Cmd|Option'
const KEY_TOKEN = '[A-Z0-9]{1,2}|Num(?:pad)?\\s?\\d|F\\d{1,2}'
const COMBO_RE = new RegExp(`(?:${MOD})\\s*(?:\\+\\s*(?:${MOD}|${KEY_TOKEN}))+`, 'gi')
const PLAIN_RE = /\b(?:F\d{1,2}|Num(?:pad)?\s?\d)\b/gi

const MOD_CANON = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', win: 'Win', meta: 'Win', cmd: 'Cmd', option: 'Option' }

export function normalizeKey(key) {
  return String(key || '')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(ctrl|shift|alt|win|meta|cmd|option)\b/gi, (w) => MOD_CANON[w.toLowerCase()] || w)
}

export function extractKeyFromLine(line) {
  const s = String(line || '')
  let m = s.match(COMBO_RE)
  if (m) return normalizeKey(m[0])
  m = s.match(PLAIN_RE)
  if (m) return normalizeKey(m[0])
  return ''
}

// 一行拆成 { key, desc }：key 用正则提取，剩余部分（去分隔符）作为描述
export function splitLineIntoEntry(line) {
  const s = String(line || '').trim()
  if (!s) return null
  const key = extractKeyFromLine(s)
  let desc = s
  if (key) {
    const i = s.indexOf(key)
    desc = (s.slice(0, i) + ' ' + s.slice(i + key.length)).replace(/\s+/g, ' ')
  }
  desc = desc.replace(/^[\s\-—–:：=·,，、|]+|[\s\-—–:：=·,，、|]+$/g, '').trim()
  return { key, desc }
}

// ---- 格式化 / 解析（存储格式与迁移数据一致：键（描述） · 键（描述））----
export function formatHotkeyEntries(entries) {
  return (entries || [])
    .map((e) => {
      const key = String(e?.key || '').trim()
      if (!key) return ''
      const desc = String(e?.desc || '').trim()
      return desc ? `${key}（${desc}）` : key
    })
    .filter(Boolean)
    .join(' · ')
}

export function parseHotkeyText(text) {
  const s = String(text || '').trim()
  if (!s) return []
  return s
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)（(.*)）$/)
      if (m) return { key: m[1].trim(), desc: m[2].trim() }
      return { key: part, desc: '' }
    })
    .filter((e) => e.key)
}

// 模型返回的条目再过一遍词库，命中打标（仅提示，不自动删）
export function flagSensitiveEntries(entries, words) {
  return (entries || []).map((e) => ({ ...e, sensitiveHit: lineHitSensitive(e?.desc, words) }))
}
