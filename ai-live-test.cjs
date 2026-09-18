// 阶跃星辰（StepFun）真实 API 验证：模型发现 → 文本识别 → 截图识别
// 运行：node ai-live-test.cjs   （读取环境变量 STEP_API_KEY，不打印、不落盘）
const Jimp = require('jimp')
const ai = require('./electron/ai.cjs')

const KEY = process.env.STEP_API_KEY
if (!KEY) {
  console.error('✗ 未找到环境变量 STEP_API_KEY')
  process.exit(1)
}
console.log('STEP_API_KEY:', KEY.slice(0, 5) + '****（已读取，不打印全文）')

const BASE = 'https://api.stepfun.com/v1'

async function listModels() {
  const res = await fetch(BASE + '/models', { headers: { Authorization: `Bearer ${KEY}` } })
  if (!res.ok) throw new Error(`模型列表 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return (data.data || []).map((m) => m.id)
}

async function main() {
  // ---- 1. 模型发现：优先挑视觉模型 ----
  let models = []
  try {
    models = await listModels()
    console.log('\n[1] 可用模型:', models.join(', ') || '(空)')
  } catch (err) {
    console.log('\n[1] 模型列表获取失败：' + err.message)
  }
  const vision =
    models.find((m) => /vision/i.test(m) && /mini|turbo|lite|small/i.test(m)) ||
    models.find(/1v/i.test) ||
    models.find((m) => /vision/i.test(m)) ||
    models[0]
  const model = vision || 'step-1v-8k'
  console.log('    选定识别模型:', model)

  const settings = { aiBaseUrl: BASE, aiApiKey: KEY, aiModel: model }

  // ---- 2. 文本识别（英文描述应翻译为中文）----
  console.log('\n[2] 文本识别测试')
  const text = ['F9 - hide weapon', 'Ctrl+7 - glasses', 'F1 makeup toggle', 'Num5 sit down'].join('\n')
  const t0 = Date.now()
  const textResult = await ai.recognizeHotkeys(settings, { text })
  console.log(`    耗时 ${Date.now() - t0}ms，解析出 ${textResult.entries.length} 条：`)
  for (const e of textResult.entries) console.log(`      ${e.key}（${e.desc}）`)

  // ---- 3. 截图识别（jimp 生成两张带文字的 PNG，模拟用户截图）----
  console.log('\n[3] 截图识别测试')
  const img = await new Jimp(420, 140, '#ffffff')
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK)
  img.print(font, 24, 24, 'H  - hide UI')
  img.print(font, 24, 84, 'Ctrl+K  - tail')
  const png = await img.getBufferAsync(Jimp.MIME_PNG)
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  console.log(`    图片体积: ${png.length} 字节（base64 后 ${(dataUrl.length / 1024).toFixed(0)} KB）`)
  const t1 = Date.now()
  const imgResult = await ai.recognizeHotkeys(settings, { text: '', imageDataUrl: dataUrl })
  console.log(`    耗时 ${Date.now() - t1}ms，解析出 ${imgResult.entries.length} 条：`)
  for (const e of imgResult.entries) console.log(`      ${e.key}（${e.desc}）`)

  console.log('\n✅ 真实调用验证完成：返回格式可被本地解析器直接解析')
}

main().catch((err) => {
  console.error('\n✗ 调用失败：', err.message)
  process.exit(1)
})
