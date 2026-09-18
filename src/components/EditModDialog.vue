<script setup>
// 编辑 mod 信息弹窗：名称 / 归属 / 预览图 / 快捷键 / 备注，一处集中修改
// 预览图操作（选择/粘贴/移除）即时生效；文本字段点「保存」统一写库
// 快捷键以「按键 / 描述」逐条编辑（一条一行），保存时序列化回存储格式
import { ref, computed } from 'vue'
import { store, updateMod, toast, previewUrl, setPreviewFromFile, clearPreview, pastePreviewFromClipboard } from '../store'
import { parseHotkeyText } from '../lib/hotkeyText'
import ModalShell from './ModalShell.vue'
import CategoryPicker from './CategoryPicker.vue'

const mod = computed(() => store.mods.find((m) => m.id === store.ui.editModId) || null)

// 挂载时快照文本字段（弹窗由 v-if 控制，打开即重建）
const m0 = store.mods.find((m) => m.id === store.ui.editModId)
const name = ref(m0?.name || '')
const notes = ref(m0?.notes || '')
const charId = ref(m0?.characterId ?? '')
const skinId = ref(m0?.skinId ?? '')

// ---- 快捷键逐条编辑 ----
function rowsFromText(t) {
  const es = parseHotkeyText(t)
  return es.length ? es.map((e) => ({ key: e.key, desc: e.desc })) : [{ key: '', desc: '' }]
}
const rows = ref(rowsFromText(m0?.hotkey || ''))
function serializeRows() {
  const parts = []
  for (const r of rows.value) {
    const key = String(r.key || '').trim()
    const desc = String(r.desc || '').trim()
    if (!key && !desc) continue
    parts.push(key && desc ? `${key}（${desc}）` : key || desc)
  }
  return parts.join(' · ')
}
function addRow() {
  rows.value.push({ key: '', desc: '' })
}
function removeRow(i) {
  rows.value.splice(i, 1)
  if (!rows.value.length) rows.value.push({ key: '', desc: '' })
}

function close() {
  store.ui.editModId = null
}

async function save() {
  const n = name.value.trim()
  if (!n) {
    toast('mod 名称不能为空', 'warn')
    return
  }
  const r = await updateMod(mod.value, {
    name: n,
    hotkey: serializeRows() || null,
    notes: notes.value.trim() || null,
    characterId: charId.value || null,
    skinId: skinId.value || null,
  })
  if (r) {
    toast('已保存 mod 信息', 'ok')
    close()
  }
}

// AI 识别叠在本弹窗之上：识别结果回填快捷键条目并即时写库
function openAI() {
  const m = mod.value
  if (!m) return
  store.ui.hotkeyAI = {
    modId: m.id,
    existingText: serializeRows(),
    save: async (text) => {
      rows.value = rowsFromText(text)
      m.hotkey = text
      const r = await updateMod(m, { hotkey: text })
      return !!r
    },
  }
}
</script>

<template>
  <ModalShell title="编辑 mod 信息" width="620px" :esc-close="!store.ui.hotkeyAI" @close="close">
    <div v-if="mod" class="form">
      <div class="field">
        <div class="sec-title">名称</div>
        <input v-model="name" class="input" placeholder="mod 名称" />
      </div>

      <div class="field">
        <div class="sec-title">归属（角色 / 皮肤）</div>
        <CategoryPicker
          :character-id="String(charId || '')"
          :skin-id="String(skinId || '')"
          :required="false"
          @update:character-id="(v) => (charId = v)"
          @update:skin-id="(v) => (skinId = v)"
        />
      </div>

      <div class="field">
        <div class="sec-title">预览图</div>
        <div class="preview-row">
          <img v-if="mod.previewPath" class="preview-img" :src="previewUrl(mod)" :alt="mod.name" />
          <div v-else class="preview-img empty">暂无预览图</div>
          <div class="pv-actions">
            <button class="btn" @click="setPreviewFromFile(mod)">🖼 选择图片</button>
            <button class="btn" @click="pastePreviewFromClipboard(mod)">📋 粘贴剪贴板</button>
            <button v-if="mod.previewPath" class="btn ghost" @click="clearPreview(mod)">🗑 移除</button>
          </div>
        </div>
      </div>

      <div class="field">
        <div class="sec-title">
          快捷键（仅记录，不触发）
          <button class="btn link" @click="openAI">✨ AI 识别</button>
        </div>
        <div class="hk-edit">
          <div class="hk-edit-head"><span class="k">按键</span><span class="d">描述</span><span class="x"></span></div>
          <div v-for="(r, i) in rows" :key="i" class="hk-edit-row">
            <input v-model="r.key" class="input k" placeholder="如 Ctrl+9" />
            <input v-model="r.desc" class="input d" placeholder="如 眼镜" />
            <button class="pbtn" title="删除该条" @click="removeRow(i)">✕</button>
          </div>
          <button class="btn ghost add" @click="addRow">＋ 添加一条</button>
        </div>
      </div>

      <div class="field">
        <div class="sec-title">备注</div>
        <textarea v-model="notes" class="input" rows="3" placeholder="可选：作者、版本、注意事项等" />
      </div>

      <div class="footer">
        <button class="btn ghost" @click="close">取消</button>
        <button class="btn primary" @click="save">保存</button>
      </div>
    </div>
  </ModalShell>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.sec-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px; font-weight: 600; letter-spacing: .08em; color: var(--text-faint);
}
.btn.link { padding: 2px 8px; font-size: 11.5px; letter-spacing: 0; }
textarea.input { resize: vertical; font-family: inherit; line-height: 1.6; }

.preview-row { display: flex; gap: 12px; align-items: stretch; }
.preview-img {
  width: 168px; aspect-ratio: 4 / 3; object-fit: cover; flex: none;
  border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--bg3);
}
.preview-img.empty {
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint); font-size: 12px;
}
.pv-actions { display: flex; flex-direction: column; gap: 8px; justify-content: center; }

/* 快捷键逐条编辑：按键 / 描述 两栏 + 删除按钮 */
.hk-edit { display: flex; flex-direction: column; gap: 6px; }
.hk-edit-head, .hk-edit-row {
  display: grid; grid-template-columns: 150px 1fr 28px; gap: 8px; align-items: center;
}
.hk-edit-head { font-size: 11px; color: var(--text-faint); }
.hk-edit-row .k { font-family: Consolas, monospace; }
.pbtn {
  width: 24px; height: 24px; border-radius: 6px; border: none;
  background: transparent; color: var(--text-faint); cursor: pointer; font-size: 11px;
}
.pbtn:hover { background: var(--bg3); color: var(--danger); }
.add { align-self: flex-start; }

.footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
