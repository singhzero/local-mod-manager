// AI 快捷键识别 — 纯函数单测（不依赖网络 / Electron 运行时）
// 运行：node smoke-ai.cjs
const assert = require('node:assert')

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ✓', name)
  } catch (err) {
    failed += 1
    console.error('  ✗', name)
    console.error('     ', err.message)
  }
}

;(async () => {
  const ht = await import('./src/lib/hotkeyText.js')
  const ai = require('./electron/ai.cjs')
  const ini = require('./electron/iniHotkeys.cjs')

  console.log('\n[1] 敏感词解析与行拦截')
  check('splitSensitiveWords：多行 + CRLF + 去空行', () => {
    assert.deepStrictEqual(ht.splitSensitiveWords('a\r\nb\n\n c \n'), ['a', 'b', 'c'])
    assert.deepStrictEqual(ht.splitSensitiveWords(''), [])
    assert.deepStrictEqual(ht.splitSensitiveWords(null), [])
  })
  check('filterLinesBySensitive：命中行被剥离且上报', () => {
    const r = ht.filterLinesBySensitive('F1 - makeup\nCtrl+9 - xxx\nF3 - pose', ['xxx'])
    assert.strictEqual(r.cleanText, 'F1 - makeup\nF3 - pose')
    assert.deepStrictEqual(r.blockedLines, ['Ctrl+9 - xxx'])
  })
  check('行拦截：大小写不敏感 + 空词库全放行', () => {
    const r = ht.filterLinesBySensitive('F1 - AbC\nF2 - ok', ['abc'])
    assert.deepStrictEqual(r.blockedLines, ['F1 - AbC'])
    const r2 = ht.filterLinesBySensitive('F1 - AbC\nF2 - ok', [])
    assert.strictEqual(r2.blockedLines.length, 0)
    assert.strictEqual(r2.cleanText, 'F1 - AbC\nF2 - ok')
  })
  check('行拦截：整行为空或纯空白不入拦截名单', () => {
    const r = ht.filterLinesBySensitive('\n  \nF1 - ok', ['ok'])
    assert.strictEqual(r.cleanText, '')
    assert.deepStrictEqual(r.blockedLines, ['F1 - ok'])
  })

  console.log('\n[2] 键位本地提取（被拦截行的手动预填）')
  check('组合键提取 + 空格规范化', () => {
    assert.strictEqual(ht.extractKeyFromLine('Ctrl+Shift+1 - toggle makeup'), 'Ctrl+Shift+1')
    assert.strictEqual(ht.extractKeyFromLine('ctrl + 9 ：切换'), 'Ctrl+9')
    assert.strictEqual(ht.extractKeyFromLine('Alt+H hide weapon'), 'Alt+H')
  })
  check('单键提取：F 键 / 数字小键盘', () => {
    assert.strictEqual(ht.extractKeyFromLine('F3 切换姿势'), 'F3')
    assert.strictEqual(ht.extractKeyFromLine('Num9 隐藏'), 'Num9')
    assert.strictEqual(ht.extractKeyFromLine('Numpad 5 show'), 'Numpad 5')
  })
  check('无键位行返回空串', () => {
    assert.strictEqual(ht.extractKeyFromLine('这里没有任何键位'), '')
  })
  check('splitLineIntoEntry：key + 剩余描述 + 去首尾分隔符', () => {
    assert.deepStrictEqual(ht.splitLineIntoEntry('- F1 makeup toggle'), { key: 'F1', desc: 'makeup toggle' })
    assert.deepStrictEqual(ht.splitLineIntoEntry('Ctrl+9：切换'), { key: 'Ctrl+9', desc: '切换' })
    assert.deepStrictEqual(ht.splitLineIntoEntry('没有键位的描述'), { key: '', desc: '没有键位的描述' })
    assert.strictEqual(ht.splitLineIntoEntry('   '), null)
  })

  console.log('\n[3] 格式化 / 解析（与迁移数据格式一致：键（描述） · 键）')
  check('formatHotkeyEntries：中文描述 + 无描述 + 丢弃无键行', () => {
    assert.strictEqual(
      ht.formatHotkeyEntries([
        { key: 'F1', desc: '妆容' },
        { key: 'Ctrl+9', desc: '' },
        { key: '  ', desc: '无键位被丢弃' },
      ]),
      'F1（妆容） · Ctrl+9'
    )
  })
  check('parseHotkeyText：往返一致', () => {
    const entries = [
      { key: 'F1', desc: '切换妆容' },
      { key: 'Ctrl+Shift+1', desc: '' },
      { key: 'Num9', desc: '隐藏服装' },
    ]
    const text = ht.formatHotkeyEntries(entries)
    assert.strictEqual(text, 'F1（切换妆容） · Ctrl+Shift+1 · Num9（隐藏服装）')
    assert.deepStrictEqual(ht.parseHotkeyText(text), entries)
  })
  check('parseHotkeyText：空串 / 无分隔符单条', () => {
    assert.deepStrictEqual(ht.parseHotkeyText(''), [])
    assert.deepStrictEqual(ht.parseHotkeyText('Ctrl+1'), [{ key: 'Ctrl+1', desc: '' }])
  })
  check('flagSensitiveEntries：命中打标不删除', () => {
    const out = ht.flagSensitiveEntries(
      [{ key: 'F1', desc: 'safe' }, { key: 'F2', desc: 'has AbC inside' }],
      ['abc']
    )
    assert.strictEqual(out[0].sensitiveHit, false)
    assert.strictEqual(out[1].sensitiveHit, true)
  })

  console.log('\n[4] AI 响应解析（主进程纯函数）')
  check('extractJsonArray：纯数组 / markdown 围栏 / 前后杂文', () => {
    assert.deepStrictEqual(ai.extractJsonArray('[{"key":"F1","desc":"妆容"}]'), [{ key: 'F1', desc: '妆容' }])
    assert.deepStrictEqual(
      ai.extractJsonArray('```json\n[{"key":"F2","desc":"收起武器"}]\n```'),
      [{ key: 'F2', desc: '收起武器' }]
    )
    assert.deepStrictEqual(
      ai.extractJsonArray('好的，结果如下：\n[{"key":"F3","desc":"切换姿势"}]\n以上。'),
      [{ key: 'F3', desc: '切换姿势' }]
    )
  })
  check('extractJsonArray：无法解析返回 null', () => {
    assert.strictEqual(ai.extractJsonArray('抱歉，我无法提供该内容'), null)
    assert.strictEqual(ai.extractJsonArray(''), null)
    assert.strictEqual(ai.extractJsonArray('[{"key": broken'), null)
  })
  check('extractEntries：字段别名 + 跳过无键行 + 解析失败抛错附原文', () => {
    assert.deepStrictEqual(
      ai.extractEntries('[{"hotkey":"F1"},{"key":"F2","description":"收起武器"},{"desc":"没有键"},{"x":1}]'),
      [{ key: 'F1', desc: '' }, { key: 'F2', desc: '收起武器' }]
    )
    assert.throws(() => ai.extractEntries('拒绝回答'), /原始返回：拒绝回答/)
  })
  check('normalizeBaseUrl：补路径 / 去尾斜杠 / 补协议 / 空值报错', () => {
    assert.strictEqual(ai.normalizeBaseUrl('https://api.x.com/v1'), 'https://api.x.com/v1/chat/completions')
    assert.strictEqual(ai.normalizeBaseUrl('https://api.x.com/v1/'), 'https://api.x.com/v1/chat/completions')
    assert.strictEqual(ai.normalizeBaseUrl('https://api.x.com/v1/chat/completions'), 'https://api.x.com/v1/chat/completions')
    assert.strictEqual(ai.normalizeBaseUrl('api.x.com/v1'), 'https://api.x.com/v1/chat/completions')
    assert.throws(() => ai.normalizeBaseUrl('  '), /未配置 API 地址/)
  })
  check('buildUserContent：仅文本 / 图文混合 / 双空报错', () => {
    assert.strictEqual(ai.buildUserContent({ text: 'F1 makeup' }).length, 1)
    const mixed = ai.buildUserContent({ text: 'F1', imageDataUrl: 'data:image/png;base64,AAA' })
    assert.strictEqual(mixed.length, 3)
    assert.strictEqual(mixed[1].type, 'image_url')
    assert.strictEqual(mixed[1].image_url.url, 'data:image/png;base64,AAA')
    assert.throws(() => ai.buildUserContent({ text: '  ' }), /没有可识别的内容/)
  })
  check('buildSystemPrompt：附加提示词拼接', () => {
    assert.ok(!ai.buildSystemPrompt({}).includes('用户附加要求'))
    assert.ok(ai.buildSystemPrompt({ aiExtraPrompt: '全部用简体' }).includes('全部用简体'))
  })
  check('mapHttpError：常见状态码的中文转译', () => {
    assert.ok(ai.mapHttpError(401, '').includes('API Key'))
    assert.ok(ai.mapHttpError(404, '').includes('API 地址'))
    assert.ok(ai.mapHttpError(429, '').includes('限流'))
    assert.ok(ai.mapHttpError(400, 'content_filter').includes('审核'))
    assert.ok(ai.mapHttpError(503, 'server busy').includes('503'))
  })

  console.log('\n[5] ini 本地解析（真实样本片段）')
  check('normalizeKeyToken：VK 码 / 方向 / 鼠标 / 字符键', () => {
    assert.strictEqual(ini.normalizeKeyToken('VK_UP'), '↑')
    assert.strictEqual(ini.normalizeKeyToken('VK_NUMPAD9'), 'Num9')
    assert.strictEqual(ini.normalizeKeyToken('VK_LBUTTON'), '鼠标左键')
    assert.strictEqual(ini.normalizeKeyToken('4'), '4')
    assert.strictEqual(ini.normalizeKeyToken('h'), 'H')
    assert.strictEqual(ini.normalizeKeyToken('['), '[')
    assert.strictEqual(ini.normalizeKeyToken('up'), '↑')
  })
  check('normalizeKeyCombo：修饰词无序大小写随意、no_* 排除、Num N 带空格', () => {
    assert.strictEqual(ini.normalizeKeyCombo('ctrl no_alt no_Shift VK_UP'), 'Ctrl+↑')
    assert.strictEqual(ini.normalizeKeyCombo('no_ctrl no_shift VK_LBUTTON'), '鼠标左键')
    assert.strictEqual(ini.normalizeKeyCombo('no_modifiers H'), 'H')
    assert.strictEqual(ini.normalizeKeyCombo('ctrl R'), 'Ctrl+R')
    assert.strictEqual(ini.normalizeKeyCombo('Num 1'), 'Num1')
    assert.strictEqual(ini.normalizeKeyCombo('ctrl no_alt no_Shift 4'), 'Ctrl+4')
    assert.strictEqual(ini.normalizeKeyCombo('no_ctrl no_alt no_Shift ='), '=')
    assert.strictEqual(ini.normalizeKeyCombo('no_shift'), '') // 只剩修饰词 → 无效
  })
  check('标准分节：注释标签 + 词典命中（拼音）', () => {
    const r = ini.parseIniText(
      '; --------------------------------------------------内衣\n' +
      '[KeyNeiYi]\ncondition = $active == 1\nkey = ctrl no_alt no_Shift VK_UP\ntype = cycle\n$NeiYi = 0,1\n',
      'Body.ini'
    )
    assert.strictEqual(r.length, 1)
    assert.strictEqual(r[0].section, 'KeyNeiYi')
    assert.strictEqual(r[0].keyCombo, 'Ctrl+↑')
    assert.strictEqual(r[0].desc, '内衣')
    assert.strictEqual(r[0].descSource, 'dict')
    assert.strictEqual(r[0].ui, false)
  })
  check('JaneDoe 变体：缩进 key、back 反向键、大写字母、英文词典', () => {
    const r = ini.parseIniText(
      '[KeySwapBody]\ncondition = $active == 1\n key = U\n back = I\ntype = cycle\n$Body =  0,1,2\n',
      'JaneDoe.ini'
    )
    assert.strictEqual(r.length, 1)
    assert.strictEqual(r[0].keyCombo, 'U/I')
    assert.strictEqual(r[0].desc, '身体')
    assert.strictEqual(r[0].variable, '$Body')
  })
  check('Sunna 菜单键：鼠标/菜单分节标记 ui，一分节双 key', () => {
    const r = ini.parseIniText(
      '[KeyShowMenu1]\ncondition = $active == 1\nkey = h\ntype = cycle\n$menu = 0,1\n\n' +
      '[KeyHold]\nkey = no_ctrl no_shift VK_LBUTTON\nkey = no_ctrl no_shift VK_RBUTTON\ntype = hold\n',
      'Sunna.ini'
    )
    assert.strictEqual(r.length, 3)
    assert.ok(r.every((b) => b.ui), '菜单/鼠标键都应标记 ui')
    assert.strictEqual(r[1].keyCombo, '鼠标左键')
    assert.strictEqual(r[2].keyCombo, '鼠标右键')
  })
  check('词典未命中 → desc 空（交 AI 标注）；带 Zuo 后缀的成对部位', () => {
    const miss = ini.parseIniText('[KeyLmaeR]\nkey = 7\n', 'X.ini')
    assert.strictEqual(miss[0].desc, '')
    assert.strictEqual(miss[0].descSource, null)
    const pair = ini.parseIniText('[KeyErHuanZuo]\nkey = 8\n', 'X.ini')
    assert.strictEqual(pair[0].desc, '左耳环')
  })
  check('mergeBindings：同分节同键去重、不同键保留', () => {
    const merged = ini.mergeBindings([
      { section: 'A', keyCombo: 'Ctrl+1' },
      { section: 'A', keyCombo: 'Ctrl+1' },
      { section: 'A', keyCombo: 'Alt+1' },
      { section: 'B', keyCombo: 'Ctrl+1' },
    ])
    assert.strictEqual(merged.length, 3)
  })

  console.log('\n[6] 提示词设置化与 ini 标注解析')
  check('内置提示词常量存在且可被自定义覆盖', () => {
    assert.ok(ai.MEDIA_PROMPT.includes('快捷键信息提取器'))
    assert.ok(ai.INI_LABEL_PROMPT.includes('section'))
    assert.ok(ai.buildSystemPrompt({}).includes('快捷键信息提取器'))
    assert.ok(ai.buildSystemPrompt({ aiPromptMedia: '自定义词' }).startsWith('自定义词'))
    assert.ok(ai.buildSystemPrompt({ aiExtraPrompt: '附注' }).includes('附注'))
    assert.ok(ai.buildIniLabelPrompt({}).includes('标注器'))
    assert.ok(ai.buildIniLabelPrompt({ aiPromptIni: '我的标注词' }).startsWith('我的标注词'))
  })
  check('extractLabeled：围栏数组解析 + 跳过缺字段 + 垃圾输入抛错', () => {
    const r = ai.extractLabeled(
      '```json\n[{"section":"KeyMaoZi","key":"Ctrl+8","desc":"帽子"},{"bad":1},{"section":"A","key":"F1"}]\n```'
    )
    assert.deepStrictEqual(r, [
      { section: 'KeyMaoZi', key: 'Ctrl+8', desc: '帽子' },
      { section: 'A', key: 'F1', desc: '' },
    ])
    assert.throws(() => ai.extractLabeled('拒绝回答'), /无法解析/)
  })

  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  process.exit(failed ? 1 : 0)
})().catch((err) => {
  console.error('测试脚本执行失败：', err)
  process.exit(1)
})
