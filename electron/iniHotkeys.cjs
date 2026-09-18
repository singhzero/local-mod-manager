// ini 快捷键本地解析（3DMigoto / XXMI 系 mod 的 [Key*] 分节）
// 键位绑定语法封闭（调研：346 条 key 行 100% 命中 `key = [修饰词序列] 键`），纯正则可完整提取；
// 部位中文描述先查内置词典（拼音 + 英文），未命中的交给 AI 标注（ai.cjs labelIniBindings）。
const fs = require('node:fs')
const path = require('node:path')

// ---- 词典（命中 → 本地映射中文，不调 API；按词条长度降序匹配，越具体越优先）----
const PINYIN_MAP = {
  maozi: '帽子', neiyi: '内衣', neiku: '内裤', shangyi: '上衣', xiazhuang: '下装',
  kuzi: '裤子', qunzi: '裙子', waitao: '外套', pijian: '披肩', xiezi: '鞋子',
  gaogen: '高跟鞋', wazi: '袜子', xiuzi: '袖子', shoutao: '手套', xiangquan: '项圈',
  shoushi: '手饰', shouzhuo: '手镯', xianglian: '项链', zhijia: '指甲', meijia: '美甲',
  kouzhao: '口罩', yanzhao: '眼罩', toufa: '头发', fazhuang: '发型', fase: '发色',
  bianzi: '辫子', weiba: '尾巴', chibang: '翅膀', yanjing: '眼镜', weijin: '围巾',
  yaodai: '腰带', ruhuan: '乳环', tuishi: '腿饰', erding: '耳钉', xiongbu: '胸部',
  xiong: '胸', datui: '大腿', dakai: '打开', guanbi: '关闭', yincang: '隐藏',
  xianshi: '显示', qiehuan: '切换', zuce: '坐姿', zitai: '姿势',
  daoju: '道具', zhebi: '遮蔽', ruxue: '乳穴', duanzi: '短袜', xiufu: '修复',
  // 带左/右的成对部位
  erhuanzuo: '左耳环', erhuanyou: '右耳环', ruhuanzuo: '左乳环', ruhuanyou: '右乳环',
  tuishizuo: '左腿饰', tuishiyou: '右腿饰',
}
const EN_MAP = {
  pantie: '内裤', panty: '内裤', skirt: '裙子', dress: '连衣裙', hair: '头发',
  hat: '帽子', cap: '帽子', shoe: '鞋子', boot: '靴子', heel: '高跟鞋',
  sock: '袜子', stocking: '丝袜', glove: '手套', sleeve: '袖子',
  cloth: '衣服', clothes: '衣服', top: '上衣', shirt: '上衣', bra: '胸罩',
  coat: '外套', jacket: '外套', cape: '披肩', glasses: '眼镜', tail: '尾巴',
  bag: '背包', necklace: '项链', bracelet: '手镯', ring: '戒指', earring: '耳环',
  mask: '口罩', makeup: '妆容', choker: '项圈', collar: '项圈', body: '身体',
  face: '脸', eye: '眼睛', arm: '手臂', leg: '腿', nail: '美甲', tattoo: '纹身',
  wing: '翅膀', horn: '角', pose: '姿势', sit: '坐下', dance: '跳舞',
  hide: '隐藏', weapon: '武器', umbrella: '雨伞', haircolor: '发色', skincolor: '肤色',
  bikini: '泳装', swimsuit: '泳装', underwear: '内衣',
}
// 长词优先（避免 top 命中 stop 之类的子串误伤：英文走分词精确匹配，拼音走整串包含）
const PINYIN_ENTRIES = Object.entries(PINYIN_MAP).sort((a, b) => b[0].length - a[0].length)
const EN_ENTRIES = Object.entries(EN_MAP).sort((a, b) => b[0].length - a[0].length)

// ---- 键位归一 ----
const VK_MAP = {
  VK_UP: '↑', VK_DOWN: '↓', VK_LEFT: '←', VK_RIGHT: '→',
  VK_NUMPAD0: 'Num0', VK_NUMPAD1: 'Num1', VK_NUMPAD2: 'Num2', VK_NUMPAD3: 'Num3',
  VK_NUMPAD4: 'Num4', VK_NUMPAD5: 'Num5', VK_NUMPAD6: 'Num6', VK_NUMPAD7: 'Num7',
  VK_NUMPAD8: 'Num8', VK_NUMPAD9: 'Num9',
  VK_LBUTTON: '鼠标左键', VK_RBUTTON: '鼠标右键', VK_MBUTTON: '鼠标中键',
  VK_RETURN: 'Enter', VK_SPACE: 'Space', VK_ESCAPE: 'Esc', VK_TAB: 'Tab',
  VK_BACK: 'Backspace', VK_DELETE: 'Del', VK_INSERT: 'Ins',
  VK_HOME: 'Home', VK_END: 'End', VK_PRIOR: 'PgUp', VK_NEXT: 'PgDn',
  VK_CAPITAL: 'CapsLock', VK_ADD: 'Num+', VK_SUBTRACT: 'Num-',
}
const ARROW_WORDS = { up: '↑', down: '↓', left: '←', right: '→' }
const MOD_ORDER = ['Ctrl', 'Alt', 'Shift']

function normalizeKeyToken(token) {
  const t = String(token || '').trim()
  if (!t) return ''
  const upper = t.toUpperCase()
  if (VK_MAP[upper]) return VK_MAP[upper]
  const lw = t.toLowerCase()
  if (ARROW_WORDS[lw]) return ARROW_WORDS[lw]
  if (/^(num|numpad)\s*\.?\s*(\d)$/.test(lw)) return 'Num' + lw.replace(/^\D*/, '')
  return /[a-z0-9]/i.test(t) ? t.toUpperCase() : t // 字符键：字母数字大写，标点原样
}

// `key = ctrl no_alt no_Shift 4` → `Ctrl+Alt+4`（no_* 为排除约束，不进显示）
function normalizeKeyCombo(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  // `Num 1` 带空格写法先合并
  const numSp = raw.match(/^(num(?:pad)?)\s+(\d)$/i)
  const tokens = (numSp ? ['Num' + numSp[2]] : raw.split(/\s+/)).filter(Boolean)
  const mods = new Set()
  let key = ''
  for (const tok of tokens) {
    const lw = tok.toLowerCase()
    if (lw === 'ctrl' || lw === 'control') { mods.add('Ctrl'); continue }
    if (lw === 'alt' || lw === 'menu') { mods.add('Alt'); continue }
    if (lw === 'shift') { mods.add('Shift'); continue }
    if (lw === 'win' || lw === 'meta') { mods.add('Win'); continue }
    if (/^no_/.test(lw) || lw === 'nomodifiers' || lw === 'no_modifiers') continue
    if (!key) key = normalizeKeyToken(tok)
  }
  if (!key) return ''
  return [...MOD_ORDER, 'Win'].filter((m) => mods.has(m)).concat(key).join('+')
}

// ---- 功能描述：词典命中 → 本地映射；未命中 → 返回空（交 AI 标注）----
function tokenizeEn(text) {
  return String(text || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
    .filter(Boolean)
}

function cleanComment(comment) {
  return String(comment || '')
    .replace(/^[;/\s]+/, '')
    .replace(/^[-=*_—\s·]+/, '')
    .replace(/[-=*_\s]+$/, '')
    .replace(/^MARK\s*:\s*/i, '')
    .trim()
}

function resolveLabel(section, variable, comment) {
  const cands = []
  const secCore = String(section || '').replace(/^key/i, '')
  if (section) cands.push(section)
  if (secCore) cands.push(secCore)
  if (variable) cands.push(variable.replace(/^\$/, ''))
  if (comment) cands.push(cleanComment(comment))
  const lowered = cands.map((c) => c.toLowerCase())
  // 拼音：整串包含（词长优先）；带 Zuo/You 后缀的先剥后缀试前缀
  for (let i = 0; i < cands.length; i++) {
    const l = lowered[i]
    const suf = l.match(/(zuo|you)$/)
    if (suf) {
      const prefix = PINYIN_MAP[l.slice(0, -suf[1].length)]
      if (prefix) return { desc: prefix + (suf[1] === 'zuo' ? '左' : '右'), source: 'dict' }
    }
  }
  for (const [py, zh] of PINYIN_ENTRIES) {
    if (lowered.some((l) => l.includes(py))) return { desc: zh, source: 'dict' }
  }
  // 英文：分词精确匹配
  for (const cand of cands) {
    const toks = tokenizeEn(cand)
    for (const [en, zh] of EN_ENTRIES) {
      if (toks.includes(en)) return { desc: zh, source: 'dict' }
    }
  }
  // 中文注释兜底
  const cjk = cleanComment(comment)
  if (/[\u4e00-\u9fff]/.test(cjk)) return { desc: cjk.slice(0, 12), source: 'comment' }
  return { desc: '', source: null }
}

// ---- 菜单/UI 键识别（默认隐藏，不是换装键）----
function isMenuBinding(binding) {
  if (/鼠标/.test(binding.keyCombo || '')) return true
  const s = `${binding.section || ''} ${binding.variable || ''}`.toLowerCase()
  return /menu|hover|click|drag|navigate|resetpos|reset_position|help|camera|zoom|slideshow|rotate|togglecanvas|hold/.test(s)
}

// ---- ini 文本解析 ----
// 一条 key 行 = 一个绑定条目；`back =` 反向键并入该分节首条（U/I 形式）
function parseIniText(text, fileName = '') {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const out = []
  let section = null
  let pendingComment = ''
  let sectionComment = ''
  let inlineComment = ''
  let first = null // 分节内首个绑定（back 并入它）
  let last = null

  const flushSection = () => { section = null; first = null; last = null; sectionComment = '' }

  for (const rawLine of lines) {
    const line = rawLine
    if (!line.trim()) continue

    // 注释行：暂存为下一个分节的标签候选
    const commentMatch = line.match(/^\s*(?:;|\/\/)\s*(.*)$/)
    if (commentMatch) {
      const cleaned = cleanComment(commentMatch[1])
      if (cleaned) pendingComment = cleaned
      continue
    }

    // 分节头（允许缩进）
    const header = line.match(/^\s*\[([^\]]+)\]/)
    if (header) {
      flushSection()
      section = header[1].trim()
      sectionComment = pendingComment
      pendingComment = ''
      continue
    }

    if (!section) continue

    const kv = line.match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*(.*)$/)
    if (!kv) continue
    const k = kv[1].toLowerCase()
    let v = kv[2]
    inlineComment = ''
    const trail = v.match(/\s*(?:;|\/\/)\s*(.+)$/)
    if (trail) {
      inlineComment = cleanComment(trail[1])
      v = v.slice(0, trail.index).trim()
    }

    if (k === 'key' || k === 'back') {
      const combo = normalizeKeyCombo(v)
      if (!combo) continue
      if (k === 'back' && first) {
        if (!first.keyCombo.includes('/')) first.keyCombo += '/' + combo
        continue
      }
      const binding = {
        section,
        file: fileName,
        keyCombo: combo,
        type: '',
        variable: '',
        comment: sectionComment || inlineComment,
        desc: '',
        descSource: null,
        ui: false,
      }
      out.push(binding)
      if (!first) first = binding
      last = binding
      continue
    }
    if (k === 'type' && last) last.type = v.trim().toLowerCase()
    if (/^\$[A-Za-z_]/.test(kv[1]) && !last?.variable) {
      if (last && !last.variable) last.variable = kv[1]
    }
  }
  for (const b of out) {
    const label = resolveLabel(b.section, b.variable, b.comment)
    b.desc = label.desc
    b.descSource = label.source
    b.ui = isMenuBinding(b)
  }
  return out
}

// 跨 ini 合并：同分节 + 同键组合视为重复（保留首个）
function mergeBindings(bindings) {
  const seen = new Set()
  const out = []
  for (const b of bindings || []) {
    const id = `${b.section}|${b.keyCombo}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(b)
  }
  return out
}

// 递归收集 mod 目录下全部 ini（深度限 6、最多 200 个文件）
function listIniFiles(root) {
  const files = []
  const walk = (dir, depth) => {
    if (depth > 6 || files.length >= 200) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (e.isFile() && /\.ini$/i.test(e.name)) {
        files.push(full)
        if (files.length >= 200) return
      }
    }
  }
  walk(root, 0)
  return files
}

module.exports = {
  parseIniText,
  mergeBindings,
  normalizeKeyCombo,
  normalizeKeyToken,
  resolveLabel,
  isMenuBinding,
  listIniFiles,
  PINYIN_MAP,
  EN_MAP,
}
