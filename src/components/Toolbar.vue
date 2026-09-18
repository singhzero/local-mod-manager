<script setup>
import { computed } from 'vue'
import { store, visibleMods, batchSetEnabled, addSelectionToPreset, removeSelectionFromPreset } from '../store'

function addSel(p) { addSelectionToPreset(p) }
function removeSel(p) { removeSelectionFromPreset(p) }

const location = computed(() => {
  if (store.ui.editingPresetId) {
    const p = store.presets.find((x) => x.id === store.ui.editingPresetId)
    return `编辑预设 · ${p ? p.name : ''}`
  }
  const n = store.ui.nav
  if (n.type === 'skin') {
    const s = store.skins.find((x) => x.id === n.id)
    const c = s && store.characters.find((x) => x.id === s.characterId)
    return c ? `${c.name} / ${s.name}` : '皮肤'
  }
  if (n.type === 'char') return store.characters.find((x) => x.id === n.id)?.name || '角色'
  if (n.type === 'uncategorized') return '未分类'
  return '全部 mod'
})

const editingPreset = computed(() => store.presets.find((p) => p.id === store.ui.editingPresetId))

function exitEdit() {
  store.ui.editingPresetId = null
}
function clearSearch() {
  store.ui.search = ''
}
</script>

<template>
  <div class="toolbar-wrap">
    <div class="toolbar">
      <div class="left">
        <span class="location">{{ location }}</span>
        <span class="count-chip">{{ visibleMods.length }} 项</span>
      </div>

      <div class="center">
        <div class="search-box" v-if="store.ui.selectedIds.length === 0">
          <span class="s-ico">⌕</span>
          <input v-model="store.ui.search" class="search" placeholder="搜索 mod 名称…" />
          <button v-if="store.ui.search" class="clear" @click="clearSearch">✕</button>
        </div>
        <div v-else class="selection-info">已选中 {{ store.ui.selectedIds.length }} 项</div>
      </div>

      <div class="right">
        <template v-if="store.ui.selectedIds.length === 0">
          <button class="btn" :class="{ 'multi-on': store.ui.multiSelect }" @click="store.ui.multiSelect = !store.ui.multiSelect">
            ☑ 多选
          </button>
          <button class="btn primary" @click="store.ui.modal = 'import'">＋ 导入 mod</button>
        </template>
        <template v-else>
          <button class="btn ok-btn" @click="batchSetEnabled(true)">启用</button>
          <button class="btn" @click="batchSetEnabled(false)">停用</button>
          <button class="btn" @click="store.ui.modal = 'savePreset'">存为预设</button>
          <button class="btn ghost" @click="store.ui.selectedIds = []">取消</button>
        </template>
      </div>
    </div>

    <!-- 预设编辑副栏 -->
    <div v-if="editingPreset" class="preset-bar">
      <span class="pb-label">预设编辑模式</span>
      <span class="pb-name">「{{ editingPreset.name }}」共 {{ editingPreset.modIds.length }} 个成员</span>
      <span class="pb-tip">勾选卡片后可加入 / 移出预设</span>
      <span class="pb-actions">
        <button class="btn" :disabled="store.ui.selectedIds.length === 0" @click="addSel(editingPreset)">加入选中</button>
        <button class="btn" :disabled="store.ui.selectedIds.length === 0" @click="removeSel(editingPreset)">移除选中</button>
        <button class="btn primary" @click="store.ui.applyPresetId = editingPreset.id; store.ui.modal = 'applyPreset'">应用该预设</button>
        <button class="btn ghost" @click="exitEdit">退出编辑</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.toolbar-wrap { flex: none; }
.toolbar {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 18px; border-bottom: 1px solid var(--line);
}
.left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.location { font-size: 15px; font-weight: 700; white-space: nowrap; }
.count-chip {
  font-size: 11px; color: var(--text-faint);
  background: var(--bg3); border-radius: 12px; padding: 1px 8px; white-space: nowrap;
}
.center { flex: 1; display: flex; justify-content: center; }
.search-box {
  display: flex; align-items: center; gap: 6px;
  width: 320px; padding: 0 10px;
  background: var(--bg0); border: 1px solid var(--line-strong); border-radius: 20px;
}
.search-box:focus-within { border-color: var(--accent); }
.s-ico { color: var(--text-faint); font-size: 14px; }
.search {
  flex: 1; background: transparent; border: none; outline: none;
  color: var(--text); font-size: 13px; padding: 7px 0;
}
.search::placeholder { color: var(--text-faint); }
.clear {
  background: transparent; border: none; color: var(--text-faint); cursor: pointer; font-size: 11px;
}
.clear:hover { color: var(--text); }
.selection-info { font-size: 13px; color: var(--accent); font-weight: 600; }
.right { display: flex; gap: 8px; }
.multi-on { border-color: var(--accent); color: var(--accent-text); background: var(--accent-soft); }
.ok-btn { color: var(--ok); border-color: #bfe3d0; }

.preset-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 18px; font-size: 12.5px;
  background: var(--accent-soft); border-bottom: 1px solid var(--accent-border);
}
.pb-label {
  color: var(--accent-text); font-weight: 700; font-size: 11px;
  border: 1px solid var(--accent-border); border-radius: 5px; padding: 1px 7px;
  background: #ffffff;
}
.pb-name { color: var(--text); font-weight: 600; }
.pb-tip { color: var(--text-faint); flex: 1; }
.pb-actions { display: flex; gap: 8px; }
</style>
