// AI 快捷键识别：OpenAI 兼容 chat/completions（支持文本 + base64 图片）
// 纯函数（解析/URL 规范化等）单独导出，供 smoke-ai.cjs 在 plain node 下测试。
const { nativeImage } = require('electron')
const fs = require('node:fs')
const { MEDIA_PROMPT, INI_LABEL_PROMPT } = require('./prompts.js')

const TIMEOUT_MS = 60000
const MAX_IMAGE_WIDTH = 1600

function buildSystemPrompt(settings) {
  const custom = String(settings?.aiPromptMedia || '').trim()
  const base = custom || MEDIA_PROMPT
  const extra = String(settings?.aiExtraPrompt || '').trim()
  return extra ? `${base}\n用户附加要求：${extra}` : base
}

function buildIniLabelPrompt(settings) {
  const custom = String(settings?.aiPromptIni || '').trim()
  return custom || INI_LABEL_PROMPT
}

// ---- URL / 参数（纯函数）----
function normalizeBaseUrl(raw) {
  let u = String(raw || '').trim().replace(/\/+$/, '')
  if (!u) throw new Error('未配置 API 地址（Base URL），请到设置页填写')
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  if (/\/chat\/completions$/i.test(u)) return u
  return u + '/chat/completions'
}

function requireApiKey(settings) {
  const key = String(settings?.aiApiKey || '').trim()
  if (!key) throw new Error('未配置 API Key，请到设置页填写')
  return key
}

function requireModel(settings) {
  const model = String(settings?.aiModel || '').trim()
  if (!model) throw new Error('未配置模型名，请到设置页填写')
  return model
}

// 组装 user content：文本 + 可选图片（OpenAI 视觉格式的 content 数组）
function buildUserContent({ text, imageDataUrl }) {
  const t = String(text || '').trim()
  if (!t && !imageDataUrl) throw new Error('没有可识别的内容：请粘贴文本或图片')
  const parts = []
  if (imageDataUrl) {
    parts.push({
      type: 'text',
      text: '请从下面的 mod 截图中提取快捷键' + (t ? '，并同时参考说明文本' : '') + '。',
    })
    parts.push({ type: 'image_url', image_url: { url: String(imageDataUrl) } })
  }
  if (t) parts.push({ type: 'text', text: t })
  return parts
}

function mapHttpError(status, bodyText) {
  const snippet = String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const suffix = snippet ? ` 服务端返回：${snippet}` : ''
  if (status === 401 || status === 403) return `认证失败（HTTP ${status}），请检查 API Key 是否正确。${suffix}`
  if (status === 404) return `接口地址不存在（HTTP 404），请检查 API 地址是否正确。${suffix}`
  if (status === 429) return `请求被限流或额度不足（HTTP 429），请稍后再试。${suffix}`
  if (status === 400) {
    return `请求被拒绝（HTTP 400）：可能是模型名有误、模型不支持图片输入，或内容触发了服务商审核（可改用文本模式；命中本地敏感词的行不会被发送，请手动填写）。${suffix}`
  }
  return `接口返回错误（HTTP ${status}）。${suffix}`
}

// ---- 请求 ----
async function callChat(settings, messages, { timeoutMs = TIMEOUT_MS } = {}) {
  const url = normalizeBaseUrl(settings?.aiBaseUrl)
  const key = requireApiKey(settings)
  const model = requireModel(settings)
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 2048, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || /timeout|aborted/i.test(String(err.message || '')))) {
      throw new Error('请求超时（60 秒），请检查网络连接或 API 地址')
    }
    throw new Error(`网络请求失败：${err?.message || err}`)
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(mapHttpError(res.status, bodyText))
  }
  const data = await res.json().catch(() => {
    throw new Error('接口返回的不是有效 JSON')
  })
  if (data?.error) {
    throw new Error(`接口返回错误：${data.error?.message || JSON.stringify(data.error).slice(0, 300)}`)
  }
  let content = data?.choices?.[0]?.message?.content
  if (Array.isArray(content)) {
    content = content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('')
  }
  if (typeof content !== 'string' || !content.trim()) throw new Error('接口没有返回内容')
  return content
}

// ---- 响应解析（纯函数）----
// 容错：剥 markdown 代码围栏 → 截取首 "[" 至末 "]" → JSON.parse
function extractJsonArray(content) {
  let s = String(content || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1].trim()) s = fence[1].trim()
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const arr = JSON.parse(s.slice(start, end + 1))
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

function extractEntries(content) {
  const arr = extractJsonArray(content)
  if (!arr) {
    const snippet = String(content || '').replace(/\s+/g, ' ').trim().slice(0, 400)
    throw new Error(`模型返回内容无法解析为快捷键列表，可截图反馈或手动填写。原始返回：${snippet || '(空)'}`)
  }
  const entries = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const key = String(item.key ?? item.hotkey ?? '').trim()
    if (!key) continue
    const desc = String(item.desc ?? item.description ?? '').trim()
    entries.push({ key, desc })
  }
  return entries
}

// ---- 高层入口 ----
async function recognizeHotkeys(settings, { text, imageDataUrl } = {}) {
  const content = await callChat(settings, [
    { role: 'system', content: buildSystemPrompt(settings) },
    { role: 'user', content: buildUserContent({ text, imageDataUrl }) },
  ])
  return { entries: extractEntries(content), raw: content }
}

// ---- ini 绑定 AI 标注：输入本地解析出的未命中条目，输出按 section+key 对齐的中文描述 ----
function extractLabeled(content) {
  const arr = extractJsonArray(content)
  if (!arr) {
    const snippet = String(content || '').replace(/\s+/g, ' ').trim().slice(0, 400)
    throw new Error(`AI 标注返回内容无法解析。原始返回：${snippet || '(空)'}`)
  }
  const out = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const section = String(item.section ?? '').trim()
    const key = String(item.key ?? '').trim()
    if (!section || !key) continue
    const desc = String(item.desc ?? '').trim()
    out.push({ section, key, desc })
  }
  return out
}

async function labelIniBindings(settings, items) {
  const list = (items || []).filter((it) => it && it.section && it.key)
  if (!list.length) return { labeled: [] }
  const payload = list.map((it) => {
    const row = { section: it.section, key: it.key }
    if (it.comment) row.comment = String(it.comment).slice(0, 40)
    if (it.variable) row.variable = it.variable
    return row
  })
  const content = await callChat(settings, [
    { role: 'system', content: buildIniLabelPrompt(settings) },
    { role: 'user', content: JSON.stringify(payload, null, 1) },
  ])
  return { labeled: extractLabeled(content) }
}

async function testConnection(settings) {
  const reply = await callChat(settings, [{ role: 'user', content: '请只回复两个字：正常' }], { timeoutMs: 20000 })
  return { ok: true, reply: reply.trim().slice(0, 50) }
}

// ---- 图片（Electron nativeImage，零新依赖）----
// 预览用：原样转 PNG data URL
function imageToPreviewDataUrl(img) {
  const url = img.toDataURL()
  if (!url) throw new Error('图片编码失败')
  return url
}

function fileToPreviewDataUrl(filePath) {
  let buf
  try {
    buf = fs.readFileSync(filePath)
  } catch {
    throw new Error('图片文件读取失败')
  }
  const img = nativeImage.createFromBuffer(buf)
  if (!img || img.isEmpty()) throw new Error('图片无法读取，请使用 PNG / JPG 格式的截图')
  return imageToPreviewDataUrl(img)
}

// 发送前压缩：宽 > 1600 缩放 → JPEG(85)，显著减小请求体
function compressImageDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/[\w+.-]+);base64,([\s\S]*)$/)
  const b64 = m ? m[2] : String(dataUrl || '')
  let buf
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    buf = null
  }
  if (!buf || !buf.length) throw new Error('图片数据为空或格式无法解析')
  const img = nativeImage.createFromBuffer(buf)
  if (!img || img.isEmpty()) throw new Error('图片无法读取，请使用 PNG / JPG 格式的截图')
  let out = img
  try {
    const { width } = img.getSize()
    if (width > MAX_IMAGE_WIDTH) out = img.resize({ width: MAX_IMAGE_WIDTH })
  } catch { /* 保持原图尺寸 */ }
  const jpeg = out.toJPEG(85)
  if (!jpeg || !jpeg.length) throw new Error('图片编码失败')
  return `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`
}

module.exports = {
  MEDIA_PROMPT,
  INI_LABEL_PROMPT,
  buildSystemPrompt,
  buildIniLabelPrompt,
  normalizeBaseUrl,
  requireApiKey,
  requireModel,
  buildUserContent,
  mapHttpError,
  callChat,
  extractJsonArray,
  extractEntries,
  extractLabeled,
  recognizeHotkeys,
  labelIniBindings,
  testConnection,
  fileToPreviewDataUrl,
  compressImageDataUrl,
}
