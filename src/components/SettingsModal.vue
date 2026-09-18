<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { store, toast, saveSettings, pickDirectory, validateDir, aiTestConnection } from '../store'
import { splitSensitiveWords } from '../lib/hotkeyText'
import { MEDIA_PROMPT, INI_LABEL_PROMPT } from '../../electron/prompts.js'
import ModalShell from './ModalShell.vue'

const repoPath = ref(store.settings.repoPath)
const modsPath = ref(store.settings.modsPath)
const sevenZipPath = ref(store.settings.sevenZipPath)
const aiBaseUrl = ref(store.settings.aiBaseUrl)
const aiApiKey = ref(store.settings.aiApiKey)
const aiModel = ref(store.settings.aiModel)
const aiExtraPrompt = ref(store.settings.aiExtraPrompt)
const sensitiveWordsText = ref(store.settings.sensitiveWords)
const showKey = ref(false)
const testing = ref(false)
const testResult = ref(null) // { ok, text }
const wordsCount = computed(() => splitSensitiveWords(sensitiveWordsText.value).length)
const detected7z = ref('')
const browsing = ref('') // 'repo' | 'mods'

// 校验状态：null=未校验，否则 { ok, reason }
const status = reactive({ repo: null, mods: null })
const timers = { repo: null, mods: null }

const REASON_TEXT = {
  empty: '✗ 尚未设置',
  'not-found': '✗ 目录不存在',
  'not-dir': '✗ 该路径不是目录',
  'no-write': '✗ 无写入权限',
  ok: '✓ 目录存在且可写',
}

function scheduleValidate(which, value) {
  clearTimeout(timers[which])
  if (!value || !value.trim()) {
    status[which] = { ok: false, reason: 'empty' }
    return
  }
  timers[which] = setTimeout(async () => {
    status[which] = { ok: null, reason: 'checking' }
    status[which] = await validateDir(value)
  }, 350)
}
function onInput(which, e) {
  scheduleValidate(which, e.target.value)
}

async function browse(which) {
  const picked = await pickDirectory()
  if (!picked) return
  if (which === 'repo') repoPath.value = picked
  else modsPath.value = picked
  scheduleValidate(which, picked)
}

async function browse7z() {
  const picked = await window.zmm.pickSevenZipFile()
  if (picked) sevenZipPath.value = picked
}

onMounted(async () => {
  if (store.settings.repoPath) scheduleValidate('repo', store.settings.repoPath)
  if (store.settings.modsPath) scheduleValidate('mods', store.settings.modsPath)
  if (store.mode === 'electron') {
    try {
      detected7z.value = (await window.zmm.detectSevenZip()).path || ''
    } catch { /* ignore */ }
  }
})

function valid(which) {
  const v = which === 'repo' ? repoPath.value : modsPath.value
  return v.trim().length > 0
}
function chip(which) {
  const st = status[which]
  if (!st) return { cls: '', text: '待校验' }
  if (st.reason === 'checking') return { cls: '', text: '校验中…' }
  const text = REASON_TEXT[st.reason] || '✗ 不可用'
  const cls = st.ok ? 'ok' : 'danger'
  return { cls, text }
}

async function testAi() {
  testing.value = true
  testResult.value = null
  try {
    // 用当前输入值测试（未保存也能测）
    const r = await aiTestConnection({
      aiBaseUrl: aiBaseUrl.value.trim(),
      aiApiKey: aiApiKey.value.trim(),
      aiModel: aiModel.value.trim(),
    })
    testResult.value = { ok: true, text: `连接正常，模型已应答：${r.reply || '（无内容）'}` }
  } catch (err) {
    testResult.value = { ok: false, text: err.message }
  }
  testing.value = false
}

// ---- 提示词管理：默认只读，「编辑」后才可修改，「保存」写库，「重置为默认」回退内置 ----
const PROMPT_FIELDS = { media: 'aiPromptMedia', ini: 'aiPromptIni' }
const promptEditors = reactive({
  media: { editing: false, draft: '' },
  ini: { editing: false, draft: '' },
})
function effectivePrompt(which) {
  return which === 'media'
    ? store.settings.aiPromptMedia || MEDIA_PROMPT
    : store.settings.aiPromptIni || INI_LABEL_PROMPT
}
function isCustomPrompt(which) {
  return !!(which === 'media' ? store.settings.aiPromptMedia : store.settings.aiPromptIni)
}
function editPrompt(which) {
  promptEditors[which].draft = which === 'media' ? store.settings.aiPromptMedia : store.settings.aiPromptIni
  promptEditors[which].editing = true
}
function cancelEditPrompt(which) {
  promptEditors[which].editing = false
}
async function persistPrompt(which, value) {
  await saveSettings({ ...store.settings, [PROMPT_FIELDS[which]]: value })
}
async function savePrompt(which) {
  await persistPrompt(which, promptEditors[which].draft.replace(/\r\n?/g, '\n').trim())
  promptEditors[which].editing = false
  toast('提示词已保存', 'ok')
}
async function resetPrompt(which) {
  await persistPrompt(which, '')
  promptEditors[which].editing = false
  toast('已重置为内置默认提示词', 'ok')
}

async function save() {
  if (!valid('repo') || !valid('mods')) {
    toast('请先完成两个目录的设置', 'warn')
    return
  }
  await saveSettings({
    repoPath: repoPath.value.trim(),
    modsPath: modsPath.value.trim(),
    sevenZipPath: sevenZipPath.value.trim(),
    aiBaseUrl: aiBaseUrl.value.trim(),
    aiApiKey: aiApiKey.value.trim(),
    aiModel: aiModel.value.trim(),
    aiExtraPrompt: aiExtraPrompt.value.trim(),
    sensitiveWords: sensitiveWordsText.value.replace(/\r\n?/g, '\n'),
    // 提示词有独立编辑/保存入口，普通保存只透传当前值不覆盖
    aiPromptMedia: store.settings.aiPromptMedia || '',
    aiPromptIni: store.settings.aiPromptIni || '',
  })
  toast(store.mode === 'electron' ? '设置已保存' : '（模拟）设置已保存，Phase 2 已接入真实持久化', 'ok')
  store.ui.modal = null
}
</script>

<template>
  <ModalShell title="设置" width="640px" @close="store.ui.modal = null">
    <div class="fields">
      <div class="field">
        <div class="f-head">
          <label>mod 存放目录（管理器仓库）</label>
          <span class="f-hint">mod 真身的归档位置，按 角色 / 皮肤 建目录</span>
        </div>
        <div class="f-row">
          <input v-model="repoPath" class="input" placeholder="例如 D:\ModStorage" spellcheck="false" @input="onInput('repo', $event)" />
          <button class="btn browse" @click="browse('repo')">浏览…</button>
        </div>
        <div class="f-status">
          <span class="chip" :class="chip('repo').cls">{{ chip('repo').text }}</span>
        </div>
      </div>

      <div class="field">
        <div class="f-head">
          <label>mod 加载目录（加载器 Mods 根目录）</label>
          <span class="f-hint">启用 mod 时在此目录创建目录联接（junction），停用时移除</span>
        </div>
        <div class="f-row">
          <input v-model="modsPath" class="input" placeholder="例如 D:\Games\ModLoader\Mods" spellcheck="false" @input="onInput('mods', $event)" />
          <button class="btn browse" @click="browse('mods')">浏览…</button>
        </div>
        <div class="f-status">
          <span class="chip" :class="chip('mods').cls">{{ chip('mods').text }}</span>
        </div>
      </div>

      <div class="field">
        <div class="f-head">
          <label>解压工具（7-Zip）路径</label>
          <span class="f-hint">用于解压 zip / rar / 7z 压缩包{{ detected7z ? `；自动探测：${detected7z}` : '' }}</span>
        </div>
        <div class="f-row">
          <input v-model="sevenZipPath" class="input" placeholder="留空则自动探测常见安装位置" spellcheck="false" />
          <button v-if="store.mode === 'electron'" class="btn browse" @click="browse7z">浏览…</button>
        </div>
      </div>

      <div class="divider">AI 快捷键识别（OpenAI 兼容接口）</div>

      <div class="field">
        <div class="f-head">
          <label>API 地址（Base URL）</label>
          <span class="f-hint">OpenAI 兼容接口即可，自动补 /chat/completions</span>
        </div>
        <div class="f-row">
          <input v-model="aiBaseUrl" class="input" placeholder="例如 https://api.openai.com/v1" spellcheck="false" />
        </div>
      </div>

      <div class="field">
        <div class="f-head">
          <label>API Key</label>
          <span class="f-hint">明文保存在本机数据库，不会上传</span>
        </div>
        <div class="f-row">
          <input
            v-model="aiApiKey"
            class="input"
            :type="showKey ? 'text' : 'password'"
            placeholder="sk-…"
            spellcheck="false"
            autocomplete="off"
          />
          <button class="btn browse" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
        </div>
      </div>

      <div class="field">
        <div class="f-head">
          <label>模型名</label>
          <span class="f-hint">识别截图需要支持图片输入的视觉模型；仅识别文本则无要求</span>
        </div>
        <div class="f-row">
          <input v-model="aiModel" class="input" placeholder="例如 gpt-4o-mini / qwen-vl-plus" spellcheck="false" />
          <button class="btn browse" :disabled="testing" @click="testAi">{{ testing ? '测试中…' : '测试连接' }}</button>
        </div>
        <div v-if="testResult" class="f-status">
          <span class="chip" :class="testResult.ok ? 'ok' : 'danger'">{{ testResult.ok ? '✓' : '✗' }} {{ testResult.text }}</span>
        </div>
      </div>

      <div class="field">
        <div class="f-head">
          <label>附加提示词（可选）</label>
          <span class="f-hint">追加到识别提示词末尾，用于微调输出（如固定翻译偏好）</span>
        </div>
        <div class="f-row">
          <textarea v-model="aiExtraPrompt" class="input" rows="2" spellcheck="false"></textarea>
        </div>
      </div>

      <div class="divider">识别提示词（内置默认，可自定义覆盖）</div>

      <div class="field">
        <div class="f-head">
          <label>文本 / 截图识别提示词</label>
          <span class="f-hint">{{ isCustomPrompt('media') ? '已自定义' : '当前为内置默认，未被修改' }}</span>
        </div>
        <textarea
          v-if="promptEditors.media.editing"
          v-model="promptEditors.media.draft"
          class="input prompt-view"
          rows="9"
          spellcheck="false"
        ></textarea>
        <textarea v-else :value="effectivePrompt('media')" class="input prompt-view" rows="9" readonly></textarea>
        <div class="prompt-ops">
          <template v-if="!promptEditors.media.editing">
            <button class="btn" @click="editPrompt('media')">✎ 编辑</button>
          </template>
          <template v-else>
            <button class="btn primary" @click="savePrompt('media')">保存</button>
            <button v-if="isCustomPrompt('media')" class="btn" @click="resetPrompt('media')">重置为默认</button>
            <button class="btn ghost" @click="cancelEditPrompt('media')">取消</button>
          </template>
        </div>
      </div>

      <div class="field">
        <div class="f-head">
          <label>ini 标注提示词</label>
          <span class="f-hint">{{ isCustomPrompt('ini') ? '已自定义' : '当前为内置默认，未被修改' }}</span>
        </div>
        <textarea
          v-if="promptEditors.ini.editing"
          v-model="promptEditors.ini.draft"
          class="input prompt-view"
          rows="9"
          spellcheck="false"
        ></textarea>
        <textarea v-else :value="effectivePrompt('ini')" class="input prompt-view" rows="9" readonly></textarea>
        <div class="prompt-ops">
          <template v-if="!promptEditors.ini.editing">
            <button class="btn" @click="editPrompt('ini')">✎ 编辑</button>
          </template>
          <template v-else>
            <button class="btn primary" @click="savePrompt('ini')">保存</button>
            <button v-if="isCustomPrompt('ini')" class="btn" @click="resetPrompt('ini')">重置为默认</button>
            <button class="btn ghost" @click="cancelEditPrompt('ini')">取消</button>
          </template>
        </div>
      </div>

      <div class="divider">敏感词库（本地拦截，词库完全由你维护）</div>

      <div class="field">
        <div class="f-head">
          <label>敏感词（每行一个，当前 {{ wordsCount }} 个）</label>
          <span class="f-hint">识别时命中这些词的输入行不会发送给模型，在本地拦截，由你在结果中手动填写</span>
        </div>
        <div class="f-row">
          <textarea
            v-model="sensitiveWordsText"
            class="input"
            rows="4"
            spellcheck="false"
            placeholder="每行填写一个词，留空表示不拦截"
          ></textarea>
        </div>
      </div>

      <div class="note">
        <template v-if="store.mode === 'electron'">
          ℹ 「浏览」将打开系统目录选择对话框；设置与角色/皮肤数据保存在本机 SQLite（{{ '目录校验为实时检查' }}）。
        </template>
        <template v-else>
          ℹ 浏览器预览模式：「浏览」为模拟填入；桌面版（npm run dev:app）中将打开系统目录选择对话框并实时校验。
        </template>
      </div>
    </div>

    <div class="footer">
      <button class="btn" @click="store.ui.modal = null">取消</button>
      <button class="btn primary" @click="save">保存设置</button>
    </div>
  </ModalShell>
</template>

<style scoped>
.fields { display: flex; flex-direction: column; gap: 18px; }
.field { display: flex; flex-direction: column; gap: 8px; }
.f-head label { font-size: 13px; font-weight: 600; }
.f-hint { font-size: 11.5px; color: var(--text-faint); margin-top: 2px; }
.f-row { display: flex; gap: 8px; }
.f-row .input { font-family: Consolas, monospace; font-size: 12.5px; }
.browse { flex: none; }
.f-status { display: flex; min-height: 22px; }
.divider {
  margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--line);
  font-size: 12.5px; font-weight: 700; color: var(--accent-text);
}
textarea.input { font-family: inherit; font-size: 12.5px; resize: vertical; line-height: 1.6; }
.prompt-view { font-family: Consolas, monospace; font-size: 12px; }
.prompt-view[readonly] { color: var(--text-dim); background: var(--bg3); cursor: default; }
.prompt-ops { display: flex; gap: 8px; }
.note {
  font-size: 12px; color: var(--text-faint);
  background: var(--bg3); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 10px 12px;
}
.footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
</style>
