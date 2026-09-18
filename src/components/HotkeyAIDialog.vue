<script setup>
// AI 识别快捷键对话框：两种方式可复选——
// ① ini 文件识别（本地正则解析 → 词典命中即中文；未命中自动调 AI 标注；敏感词条目不发送）
// ② 提供文本/截图（OpenAI 兼容接口识别）
// 挂载条件是 store.ui.hotkeyAI 非空（不是 modal 字符串），因此可叠在导入向导之上。
import { ref, computed, watch, onMounted } from 'vue'
import {
  store, toast, aiRecognize, aiReadClipboardImage, aiPickImage,
  scanModInis, labelIni, aiConfigured,
} from '../store'
import {
  splitSensitiveWords,
  filterLinesBySensitive,
  splitLineIntoEntry,
  formatHotkeyEntries,
  parseHotkeyText,
  flagSensitiveEntries,
  lineHitSensitive,
} from '../lib/hotkeyText'
import ModalShell from './ModalShell.vue'

const ctx = computed(() => store.ui.hotkeyAI || {})
const hasMod = computed(() => !!ctx.value.modId)
const words = computed(() => splitSensitiveWords(store.settings.sensitiveWords))
const existingText = computed(() => String(ctx.value.existingText || ''))

const SOURCE_TAG = { dict: '词典', ai: 'AI', media: '文本', manual: '手动', pending: '待手动' }

// ---- 识别方式复选 ----
const useIni = ref(false)
const useMedia = ref(false)
const iniScan = ref(null) // { iniCount, bindings, dictHit, uiCount }
const scanning = ref(false)
const hideUi = ref(true)

const visibleBindings = computed(() =>
  iniScan.value ? iniScan.value.bindings.filter((b) => !(hideUi.value && b.ui)) : []
)
const iniSummary = computed(() => {
  if (scanning.value) return '正在读取 mod 文件夹中的 .ini…'
  if (!iniScan.value) return '解析 mod 文件夹内全部 .ini 的快捷键定义'
  const list = visibleBindings.value
  const hit = list.filter((b) => b.desc).length
  const pend = list.length - hit
  return `${iniScan.value.iniCount} 个 ini · ${list.length} 条绑定（词典命中 ${hit} 条，待 AI 标注 ${pend} 条${hideUi.value && iniScan.value.uiCount ? `，已隐藏菜单/鼠标键 ${iniScan.value.uiCount} 条` : ''}）`
})

async function rescan() {
  scanning.value = true
  errorMsg.value = ''
  try {
    iniScan.value = await scanModInis(ctx.value.modId)
  } catch (err) {
    iniScan.value = null
    errorMsg.value = err.message
  }
  scanning.value = false
}

watch(useIni, (on) => {
  if (on && hasMod.value && !iniScan.value) rescan()
})

// ---- 文本 / 截图输入 ----
const inputText = ref('')
const imageDataUrl = ref('')
const imageName = ref('')
const pasteBusy = ref(false)

async function pasteImage() {
  pasteBusy.value = true
  try {
    const r = await aiReadClipboardImage()
    if (!r?.ok) {
      toast(r?.reason === 'empty' ? '剪贴板中没有图片' : '当前环境不支持读取剪贴板图片', 'warn')
      return
    }
    imageDataUrl.value = r.dataUrl
    imageName.value = '剪贴板图片'
  } finally {
    pasteBusy.value = false
  }
}

async function pickImage() {
  const r = await aiPickImage()
  if (!r?.ok) {
    if (r?.reason === 'unreadable') toast(r.message, 'warn')
    return
  }
  imageDataUrl.value = r.dataUrl
  imageName.value = r.name
}
function clearImage() {
  imageDataUrl.value = ''
  imageName.value = ''
}

// ---- 识别 ----
const stage = ref('input') // input | result
const recognizing = ref(false)
const errorMsg = ref('')
const labelNote = ref('')
const blockedLines = ref([])

// ini 方式：词典命中直接用；未命中（且非敏感词）自动交 AI 标注。
// 实现在 buildIniRowsInto（可直接往识别结果数组里累积）。

// 被拦截的文本行：本地正则提取键位预填为手动条目（纯本地，不上传）
function manualEntriesFrom(blocked) {
  const list = []
  for (const line of blocked) {
    const e = splitLineIntoEntry(line)
    if (e && (e.key || e.desc)) list.push({ section: '', key: e.key, desc: e.desc, source: 'manual', sensitiveHit: false, ui: false })
  }
  return list
}

async function recognize() {
  errorMsg.value = ''
  labelNote.value = ''
  if (!useIni.value && !useMedia.value) {
    toast('请至少选择一种识别方式', 'warn')
    return
  }
  recognizing.value = true
  blockedLines.value = []
  const errors = []
  let rows = []
  try {
    // ---- ① ini 文件识别 ----
    if (useIni.value) {
      if (!iniScan.value) await rescan()
      if (iniScan.value) {
        try {
          const before = rows.length
          await buildIniRowsInto(rows)
          if (rows.length === before && !iniScan.value.bindings.length) errors.push('mod 文件夹中没有解析到任何 ini 快捷键')
        } catch (err) {
          errors.push('ini 标注失败：' + err.message)
        }
      }
    }
    // ---- ② 文本 / 截图识别 ----
    if (useMedia.value) {
      const { cleanText, blockedLines: blocked } = filterLinesBySensitive(inputText.value, words.value)
      blockedLines.value = blocked
      if (cleanText || imageDataUrl.value) {
        try {
          const r = await aiRecognize({ text: cleanText, imageDataUrl: imageDataUrl.value })
          rows.push(...(r.entries || []).map((e) => ({ section: '', key: e.key || '', desc: e.desc || '', source: 'media', sensitiveHit: false, ui: false })))
        } catch (err) {
          errors.push(err.message)
        }
      }
      rows.push(...manualEntriesFrom(blocked))
    }
  } finally {
    recognizing.value = false
  }

  // 敏感词终检（AI / 词典结果都可能命中，仅打标不删除）
  rows = flagSensitiveEntries(rows, words.value)
  if (!rows.length) {
    if (errors.length) errorMsg.value = errors[0]
    else toast('没有识别到任何快捷键', 'warn')
    return
  }
  if (errors.length) toast(errors[0], 'warn')
  entries.value = rows
  saveMode.value = existingText.value ? 'append' : 'replace'
  stage.value = 'result'
}

// buildIniRows 的可累积版本（直接往 rows 数组里填）
async function buildIniRowsInto(rows) {
  const visible = visibleBindings.value
  const w = words.value
  const pending = []
  for (const b of visible) {
    const row = {
      section: b.section, key: b.keyCombo, desc: b.desc || '',
      source: b.desc ? 'dict' : 'pending', sensitiveHit: false, ui: b.ui,
    }
    rows.push(row)
    if (!b.desc) {
      const hit = lineHitSensitive(`${b.section} ${b.comment || ''} ${b.variable || ''}`, w)
      if (hit) row.sensitiveHit = true
      else pending.push({ row, payload: { section: b.section, key: b.keyCombo, comment: b.comment || '', variable: b.variable || '' } })
    }
  }
  if (!pending.length) return
  if (!aiConfigured()) {
    labelNote.value = `有 ${pending.length} 条词典未命中；未配置 API 无法自动标注，请在结果中手动填写`
    return
  }
  const r = await labelIni(pending.map((p) => p.payload))
  const map = new Map(r.labeled.map((x) => [`${x.section}|${x.key}`, x]))
  let ok = 0
  for (const p of pending) {
    const hit = map.get(`${p.row.section}|${p.row.key}`)
    if (hit?.desc) {
      p.row.desc = hit.desc
      p.row.source = 'ai'
      ok += 1
    }
  }
  const fail = pending.length - ok
  labelNote.value = fail ? `AI 已标注 ${ok} 条，${fail} 条未返回（请手动填写）` : `AI 已标注 ${ok} 条未命中词条`
}

// ---- 结果阶段 ----
const entries = ref([])
const saveMode = ref('replace')
const saving = ref(false)

function backToInput() {
  stage.value = 'input'
  errorMsg.value = ''
}
function addRow() {
  entries.value.push({ section: '', key: '', desc: '', source: 'manual', sensitiveHit: false, ui: false })
}
function removeRow(i) {
  entries.value.splice(i, 1)
}

const finalText = computed(() => {
  const rows = entries.value
  if (saveMode.value === 'append' && existingText.value) {
    return formatHotkeyEntries([...parseHotkeyText(existingText.value), ...rows])
  }
  return formatHotkeyEntries(rows)
})

async function save() {
  if (!finalText.value) {
    toast('没有可保存的快捷键（至少填写一个键位）', 'warn')
    return
  }
  saving.value = true
  try {
    const ok = ctx.value.save ? await ctx.value.save(finalText.value) : false
    if (ok === false) return // 保存失败时 store 已提示，保持对话框打开
    toast('快捷键已保存', 'ok')
    close()
  } catch (err) {
    toast('保存失败：' + err.message, 'warn')
  } finally {
    saving.value = false
  }
}
function close() {
  store.ui.hotkeyAI = null
}

onMounted(() => {
  // 已入库 mod 默认走 ini 方式；向导上下文只有文本/截图
  if (hasMod.value) {
    useIni.value = true
    rescan()
  } else {
    useMedia.value = true
  }
})
</script>

<template>
  <ModalShell title="AI 识别快捷键" width="700px" @close="close">
    <!-- 输入阶段 -->
    <div v-if="stage === 'input'" class="stage">
      <div class="methods">
        <label v-if="hasMod" class="method" :class="{ on: useIni }">
          <input v-model="useIni" type="checkbox" />
          <div>
            <b>📄 ini 文件识别</b>
            <div class="method-sub">{{ iniSummary }}</div>
            <div class="method-sub dim">本地解析 + 词典映射，词典未命中的自动交 AI 标注（敏感词条目不发送）</div>
          </div>
          <button v-if="iniScan && !scanning" class="btn ghost mini" @click.prevent="rescan">重新扫描</button>
        </label>
        <label class="method" :class="{ on: useMedia }">
          <input v-model="useMedia" type="checkbox" />
          <div>
            <b>✏️ 提供文本 / 截图</b>
            <div class="method-sub dim">粘贴 mod 作者的说明文本或快捷键截图，AI 提取为「按键（中文描述）」，英文自动翻译</div>
          </div>
        </label>
      </div>
      <label v-if="useIni && hasMod" class="hide-ui">
        <input v-model="hideUi" type="checkbox" /> 隐藏菜单 / 鼠标键（非换装键，可取消勾选查看）
      </label>

      <template v-if="useMedia">
        <textarea
          v-model="inputText"
          class="input textarea"
          rows="6"
          placeholder="把 mod 说明里的快捷键部分粘贴到这里（每行一条识别效果最好）&#10;只识别图片时可留空"
          spellcheck="false"
        ></textarea>

        <div class="img-row">
          <button class="btn" :disabled="pasteBusy" @click="pasteImage">
            {{ pasteBusy ? '读取中…' : '📋 粘贴剪贴板截图' }}
          </button>
          <button v-if="store.mode === 'electron'" class="btn" @click="pickImage">🖼 选择图片文件</button>
          <template v-if="imageName">
            <span class="img-name">{{ imageName }}</span>
            <button class="btn ghost" @click="clearImage">移除图片</button>
          </template>
        </div>
        <img v-if="imageDataUrl" :src="imageDataUrl" class="img-preview" alt="待识别截图" />

        <div v-if="words.length" class="sens-note on">
          🛡 本地敏感词拦截已启用（{{ words.length }} 个词）：命中的输入行 / ini 条目不会发送给模型。<template v-if="imageDataUrl"><br />⚠ 图片内容无法本地拦截，若服务商开启内容审核可能拒绝本次请求。</template>
        </div>
        <div v-else class="sens-note">
          💡 若担心内容触发服务商审核，可先到「设置 → 敏感词库」添加词条；命中的行会被本地拦截，不会发送给模型。
        </div>
      </template>

      <div v-if="errorMsg" class="err">✗ {{ errorMsg }}</div>
    </div>

    <!-- 结果阶段 -->
    <div v-else class="stage">
      <div v-if="labelNote" class="label-note">{{ labelNote }}</div>
      <div v-if="blockedLines.length" class="blocked">
        <b>🛡 本地拦截 {{ blockedLines.length }} 行（未发送给模型，以下条目请手动确认）：</b>
        <div v-for="(l, i) in blockedLines" :key="i" class="blocked-line">{{ l }}</div>
      </div>

      <table class="rows">
        <thead>
          <tr><th class="th-key">按键</th><th>描述（中文）</th><th class="th-ops"></th></tr>
        </thead>
        <tbody>
          <tr v-for="(e, i) in entries" :key="i" :class="{ hit: e.sensitiveHit, blank: !e.key.trim() }">
            <td><input v-model="e.key" class="input key" placeholder="如 Ctrl+9" spellcheck="false" /></td>
            <td><input v-model="e.desc" class="input" placeholder="功能描述" spellcheck="false" /></td>
            <td class="row-ops">
              <span v-if="SOURCE_TAG[e.source]" class="tag" :class="{ warn: e.source === 'pending' }">{{ SOURCE_TAG[e.source] }}</span>
              <span v-if="e.sensitiveHit" class="tag warn" title="描述命中敏感词，请自行确认">敏感词</span>
              <button class="btn ghost" title="删除此行" @click="removeRow(i)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <button class="btn ghost" @click="addRow">＋ 手动加一行</button>

      <div class="save-block">
        <div class="save-mode">
          <label><input v-model="saveMode" type="radio" value="replace" /> 替换现有快捷键</label>
          <label><input v-model="saveMode" type="radio" value="append" /> 追加到现有</label>
          <span v-if="existingText" class="existing" :title="existingText">现有：{{ existingText }}</span>
        </div>
        <div class="final">
          <span class="final-label">将保存为</span>
          <code>{{ finalText || '（空 — 至少填写一个键位）' }}</code>
        </div>
      </div>
    </div>

    <div class="footer">
      <template v-if="stage === 'input'">
        <button class="btn" @click="close">取消</button>
        <button class="btn primary" :disabled="recognizing || scanning" @click="recognize">
          {{ recognizing ? '识别中…' : '✨ 开始识别' }}
        </button>
      </template>
      <template v-else>
        <button class="btn" @click="backToInput">← 重新识别</button>
        <span style="flex: 1"></span>
        <button class="btn primary" :disabled="saving || !finalText" @click="save">
          {{ saving ? '保存中…' : '保存快捷键' }}
        </button>
      </template>
    </div>
  </ModalShell>
</template>

<style scoped>
.stage { display: flex; flex-direction: column; gap: 10px; }

.methods { display: flex; flex-direction: column; gap: 8px; }
.method {
  display: flex; gap: 10px; align-items: flex-start; cursor: pointer;
  border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  padding: 10px 12px; transition: border-color .12s;
}
.method:hover { border-color: var(--accent); }
.method.on { border-color: var(--accent); background: var(--accent-soft); }
.method input { accent-color: var(--accent); margin-top: 3px; }
.method b { font-size: 13px; }
.method-sub { font-size: 11.5px; color: var(--text-dim); margin-top: 2px; }
.method-sub.dim { color: var(--text-faint); }
.mini { flex: none; margin-left: auto; font-size: 11px; padding: 3px 8px; }
.hide-ui { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-dim); cursor: pointer; }
.hide-ui input { accent-color: var(--accent); }

.textarea { font-family: inherit; font-size: 12.5px; resize: vertical; min-height: 100px; }

.img-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.img-name { font-size: 12px; color: var(--text-dim); }
.img-preview {
  max-width: 100%; max-height: 200px; object-fit: contain;
  border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--bg3);
}

.sens-note {
  font-size: 12px; color: var(--text-faint); line-height: 1.6;
  background: var(--bg3); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 9px 12px;
}
.sens-note.on { color: var(--warn); background: #fffaf0; border-color: #f5e3bd; }

.err {
  font-size: 12.5px; color: var(--danger);
  background: #fef2f2; border: 1px solid #fecaca;
  border-radius: var(--radius-sm); padding: 9px 12px;
  word-break: break-all; max-height: 130px; overflow-y: auto;
}
.label-note {
  font-size: 12px; color: var(--info);
  background: #f0f8fe; border: 1px solid #cfe6f7;
  border-radius: var(--radius-sm); padding: 8px 12px;
}

.blocked {
  font-size: 12px; color: var(--warn);
  background: #fffaf0; border: 1px solid #f5e3bd;
  border-radius: var(--radius-sm); padding: 9px 12px;
  display: flex; flex-direction: column; gap: 4px;
}
.blocked-line { font-family: Consolas, monospace; font-size: 11.5px; color: var(--text-dim); }

.rows { width: 100%; border-collapse: collapse; }
.rows th { text-align: left; font-size: 11.5px; color: var(--text-faint); font-weight: 600; padding: 2px 4px; }
.rows td { padding: 3px 4px; }
.rows .input { font-size: 12.5px; padding: 5px 8px; }
.rows .key { font-family: Consolas, monospace; width: 130px; }
.th-key { width: 140px; }
.th-ops { width: 150px; }
.row-ops { display: flex; align-items: center; gap: 5px; justify-content: flex-end; }
tr.hit td { background: #fffaf0; }
tr.blank .key { border-color: #f0b4b4; }
.tag {
  flex: none; font-size: 10.5px; padding: 1px 6px; border-radius: 4px;
  background: var(--bg3); border: 1px solid var(--line-strong); color: var(--text-faint);
}
.tag.warn { color: var(--warn); border-color: #f5e3bd; background: #fffaf0; }

.save-block {
  display: flex; flex-direction: column; gap: 8px;
  border-top: 1px solid var(--line); padding-top: 10px;
}
.save-mode { display: flex; align-items: center; gap: 14px; font-size: 12.5px; }
.save-mode input { accent-color: var(--accent); margin-right: 4px; }
.existing {
  margin-left: auto; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11.5px; color: var(--text-faint);
}
.final { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
.final-label { flex: none; color: var(--text-faint); }
.final code {
  font-size: 12px; color: var(--text);
  background: var(--bg3); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 6px 9px;
  word-break: break-all; line-height: 1.6;
}

.footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
</style>
