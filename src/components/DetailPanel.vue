<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { store, charById, toast, toggleModEnabled, removeMod, updateMod, openModFolder, pastePreviewFromClipboard, previewUrl } from '../store'
import { parseHotkeyText, formatHotkeyEntries } from '../lib/hotkeyText'
import { coverDataUri } from '../utils/cover'
import CategoryPicker from './CategoryPicker.vue'
import HotkeyList from './HotkeyList.vue'

const mod = computed(() => store.mods.find((m) => m.id === store.ui.selectedModId) || null)
const char = computed(() => (mod.value?.characterId ? charById.value[mod.value.characterId] : null))
const skin = computed(() => (mod.value?.skinId ? store.skins.find((s) => s.id === mod.value.skinId) : null))
const cover = computed(() => previewUrl(mod.value) || coverDataUri(mod.value?.name || '?', char.value?.color || '#8ea2ba'))

// ---- 角色皮肤编辑（立即持久化）----
function onCharChange(id) {
  if (mod.value) updateMod(mod.value, { characterId: id || null })
}
function onSkinChange(id) {
  if (mod.value) updateMod(mod.value, { skinId: id || null })
}
function onNameChange(e) {
  const name = e.target.value.trim()
  if (mod.value && name) updateMod(mod.value, { name })
}

// ---- 快捷键记录（仅记录，不监听不触发 —— 与正式版一致）----
// 流程：点「＋ 记录按键」→ 按下组合键 → 捕获显示并在旁边输入描述 → 保存追加进列表
const recording = ref(false)   // 正在监听组合键
const pending = ref(null)      // 已捕获的 { key, desc }，等待输入描述并保存
const descInput = ref(null)

function onRecordKey(e) {
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    stopRecord()
    return
  }
  const parts = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  let key = e.key
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    if (e.metaKey) parts.push('Win')
    parts.push(key)
    // 捕获完成：退出监听，进入「输入描述 → 保存」状态
    recording.value = false
    window.removeEventListener('keydown', onRecordKey, true)
    pending.value = { key: parts.join('+'), desc: '' }
  }
}
function startRecord() {
  if (recording.value) return
  pending.value = null
  recording.value = true
  window.addEventListener('keydown', onRecordKey, true)
}
function stopRecord() {
  recording.value = false
  window.removeEventListener('keydown', onRecordKey, true)
}
function cancelPending() {
  pending.value = null
}
function savePending() {
  const p = pending.value
  if (!p || !mod.value) return
  const entries = parseHotkeyText(mod.value.hotkey)
  if (entries.some((e) => e.key === p.key)) {
    toast(`按键 ${p.key} 已在列表中，如需改描述请用「✎ 编辑」`, 'info')
    pending.value = null
    return
  }
  entries.push({ key: p.key, desc: p.desc.trim() })
  const text = formatHotkeyEntries(entries)
  mod.value.hotkey = text || null
  updateMod(mod.value, { hotkey: text || null })
  toast(`已保存 ${p.key}${p.desc.trim() ? '（' + p.desc.trim() + '）' : ''}`, 'ok')
  pending.value = null
}

// 捕获组合键后自动聚焦描述输入框
watch(pending, async (v) => {
  if (!v) return
  await nextTick()
  descInput.value?.focus()
})

// 切换选中 mod 时取消记录/待保存，避免按键串到别的 mod 上
watch(
  () => mod.value?.id,
  () => {
    stopRecord()
    pending.value = null
  }
)
function clearHotkey() {
  if (mod.value) {
    mod.value.hotkey = null
    updateMod(mod.value, { hotkey: null })
    toast('已清除快捷键记录', 'info')
  }
}

// ---- AI 识别快捷键（对话框叠加显示，由 HotkeyAIDialog 处理全流程）----
function openHotkeyAI() {
  if (!mod.value) return
  const m = mod.value
  store.ui.hotkeyAI = {
    modId: m.id,
    existingText: m.hotkey || '',
    save: async (text) => {
      m.hotkey = text
      const r = await updateMod(m, { hotkey: text })
      return !!r
    },
  }
}
onBeforeUnmount(() => window.removeEventListener('keydown', onRecordKey, true))

// ---- 全局 Ctrl+V：选中卡片后直接粘贴剪贴板图片为预览图 ----
// 输入框聚焦或任何弹窗打开时不劫持（让正常的文本粘贴/AI 对话框快捷键工作）
function onGlobalPaste(e) {
  if (e.key !== 'v' || !(e.ctrlKey || e.metaKey)) return
  if (!mod.value || store.ui.modal || store.ui.hotkeyAI) return
  const el = document.activeElement
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  e.preventDefault()
  pastePreviewFromClipboard(mod.value)
}
onMounted(() => window.addEventListener('keydown', onGlobalPaste))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalPaste))

// ---- 删除二次确认 ----
const confirmingDelete = ref(false)
function askDelete() {
  if (!confirmingDelete.value) {
    confirmingDelete.value = true
    setTimeout(() => (confirmingDelete.value = false), 2500)
  } else {
    confirmingDelete.value = false
    removeMod(mod.value)
  }
}

const statusChip = computed(() => {
  if (!mod.value) return null
  if (mod.value.status === 'lost') return { cls: 'danger', text: '文件夹丢失' }
  if (mod.value.status === 'conflict') return { cls: 'warn', text: '可能与其他启用 mod 冲突' }
  return { cls: 'ok', text: '正常' }
})
</script>

<template>
  <aside class="detail">
    <!-- 未选中 -->
    <div v-if="!mod" class="empty-state" style="height: 100%">
      <div class="icon">🗂</div>
      <div style="font-size: 15px; color: var(--text-dim)">未选中 mod</div>
      <div>点击卡片查看详情，详情页可编辑归属、粘贴预览图、记录快捷键</div>
    </div>

    <template v-else>
      <div class="detail-scroll">
        <div class="hero">
          <img :src="cover" :alt="mod.name" draggable="false" />
          <span v-if="mod.enabled" class="on-flag">已启用</span>
        </div>

        <div class="section">
          <div class="name-row">
            <input v-model="mod.name" class="input name-input" placeholder="mod 名称" @change="onNameChange" />
            <button class="btn" title="编辑 mod 信息（名称/预览图/快捷键/备注）" @click="store.ui.editModId = mod.id">✎ 编辑</button>
          </div>
          <CategoryPicker
            :character-id="mod.characterId || ''"
            :skin-id="mod.skinId || ''"
            @update:character-id="onCharChange"
            @update:skin-id="onSkinChange"
          />
          <div class="status-row">
            <span class="chip" :class="statusChip.cls">● {{ statusChip.text }}</span>
          </div>
        </div>

        <div class="section">
          <div class="sec-title">预览图</div>
          <div class="paste-hint" @click="pastePreviewFromClipboard(mod)">
            📋 点击此处或直接按 Ctrl+V<br />
            <span class="paste-sub">把剪贴板里的截图设为本 mod 预览图</span>
          </div>
        </div>

        <div class="section">
          <div class="sec-title">快捷键（仅记录）</div>
          <div class="hk-actions">
            <button v-if="!recording && !pending" class="btn" title="编辑快捷键（按键/描述 逐条）" @click="store.ui.editModId = mod.id">✎ 编辑</button>
            <button v-if="!recording && !pending" class="btn" title="按下组合键后输入描述并保存" @click="startRecord">＋ 记录按键</button>
            <button v-if="!recording && !pending" class="btn" title="粘贴文本或截图，由 AI 提取快捷键" @click="openHotkeyAI">✨ AI 识别</button>
            <button v-if="mod.hotkey && !recording && !pending" class="btn ghost" @click="clearHotkey">清除</button>
          </div>
          <div v-if="recording" class="hotkey-box">
            <span class="recording">按下组合键… <em>Esc 取消</em></span>
          </div>
          <div v-else-if="pending" class="hotkey-box">
            <span class="key-chip saved">{{ pending.key }}</span>
            <input
              ref="descInput"
              v-model="pending.desc"
              class="input desc-input"
              placeholder="输入描述（可留空），回车保存"
              @keydown.enter="savePending"
              @keydown.esc="cancelPending"
            />
            <button class="btn primary" @click="savePending">保存</button>
            <button class="btn ghost" @click="cancelPending">取消</button>
          </div>
          <HotkeyList v-if="!recording" :text="mod.hotkey" />
          <div class="hint">快捷键仅做记录与展示，不做全局监听、不触发执行</div>
        </div>

        <div class="section actions">
          <button class="btn primary wide" :disabled="mod.status === 'lost'" @click="toggleModEnabled(mod)">
            {{ mod.enabled ? '■ 停用（移除联接）' : '▶ 启用（创建联接）' }}
          </button>
          <div class="row">
            <button class="btn wide" @click="openModFolder(mod)">📂 打开所在目录</button>
            <button class="btn danger wide" @click="askDelete">
              {{ confirmingDelete ? '再点一次确认删除' : '🗑 删除' }}
            </button>
          </div>
        </div>

        <div class="section meta">
          <div class="sec-title">信息</div>
          <dl>
            <div><dt>来源压缩包</dt><dd>{{ mod.source }}</dd></div>
            <div><dt>大小</dt><dd>{{ mod.size }}</dd></div>
            <div><dt>导入时间</dt><dd>{{ mod.importedAt }}</dd></div>
            <div><dt>内容哈希</dt><dd class="mono">{{ mod.hash }}</dd></div>
          </dl>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.detail { background: var(--bg0); overflow: hidden; display: flex; flex-direction: column; }
.detail-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; }

.hero {
  position: relative; border-radius: var(--radius); overflow: hidden;
  border: 1px solid var(--line); aspect-ratio: 4 / 3; background: var(--bg3);
}
.hero img { width: 100%; height: 100%; object-fit: cover; }
.on-flag {
  position: absolute; top: 10px; left: 10px;
  background: var(--accent); color: var(--accent-ink);
  font-size: 11px; font-weight: 800; border-radius: 5px; padding: 2px 9px;
}

.section { display: flex; flex-direction: column; gap: 8px; }
.name-row { display: flex; gap: 8px; }
.name-row .name-input { flex: 1; min-width: 0; }
.name-input { font-weight: 600; }
.status-row { display: flex; }
.paste-hint {
  padding: 12px; text-align: center; font-size: 12.5px; color: var(--text-faint);
  border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); cursor: pointer;
  line-height: 1.7;
}
.paste-hint:hover { color: var(--accent-text); border-color: var(--accent); }
.paste-sub { font-size: 11px; color: var(--text-faint); }

.hotkey-box {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  min-height: 34px; padding: 5px 8px;
  background: var(--bg2); border: 1px solid var(--line); border-radius: var(--radius-sm);
}
.hotkey-box .desc-input { flex: 1; min-width: 180px; height: 30px; padding: 4px 9px; font-size: 12.5px; }
.key-chip {
  font-family: Consolas, monospace; font-size: 12.5px; font-weight: 700;
  padding: 2px 9px; border-radius: 6px;
  background: var(--bg3); border: 1px solid var(--line-strong); color: var(--info);
}
.key-chip.saved { color: var(--accent-text); border-color: var(--accent-border); }
.recording { color: var(--accent-text); font-size: 12.5px; }
.recording em { color: var(--text-faint); font-style: normal; margin-left: 6px; font-size: 11px; }
.none { color: var(--text-faint); font-size: 12.5px; flex: 1; }
.hk-actions { margin-left: auto; display: flex; gap: 6px; }
.hint { font-size: 11px; color: var(--text-faint); }

.actions .row { display: flex; gap: 8px; }
.wide { flex: 1; justify-content: center; }

.meta dl { display: flex; flex-direction: column; gap: 6px; }
.meta dl div { display: flex; gap: 10px; font-size: 12.5px; }
.meta dt { color: var(--text-faint); flex: none; width: 72px; }
.meta dd { color: var(--text-dim); word-break: break-all; }
.mono { font-family: Consolas, monospace; }
</style>
