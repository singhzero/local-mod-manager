<script setup>
import { ref, computed } from 'vue'
import { store, selectedMods, savePreset, modById } from '../store'
import ModalShell from './ModalShell.vue'

const defaults = selectedMods().map((m) => m.name)
const name = ref(`新预设 ${new Date().toISOString().slice(0, 10)}`)
const list = computed(() => store.ui.selectedIds.map((id) => modById.value[id]).filter(Boolean))

function save() {
  const n = name.value.trim()
  if (!n) return
  savePreset(n)
  store.ui.modal = null
}
</script>

<template>
  <ModalShell title="保存为预设" width="480px" @close="store.ui.modal = null">
    <div class="body">
      <p class="tip">将当前选中的 {{ defaults.length }} 个 mod 收录为一个预设。应用预设时会<b>替换</b>当前启用集（不在预设中的启用 mod 将被停用）。</p>
      <input v-model="name" class="input" placeholder="预设名称" autofocus @keydown.enter="save" />
      <ul v-if="list.length" class="members">
        <li v-for="m in list" :key="m.id">{{ m.name }}</li>
      </ul>
    </div>
    <div class="footer">
      <button class="btn" @click="store.ui.modal = null">取消</button>
      <button class="btn primary" :disabled="!list.length || !name.trim()" @click="save">保存预设</button>
    </div>
  </ModalShell>
</template>

<style scoped>
.body { display: flex; flex-direction: column; gap: 12px; }
.tip { font-size: 12.5px; color: var(--text-dim); }
.tip b { color: var(--accent-text); }
.members {
  list-style: none; max-height: 180px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 5px;
}
.members li {
  font-size: 12.5px; color: var(--text-dim);
  background: var(--bg3); border: 1px solid var(--line);
  border-radius: 6px; padding: 5px 10px;
}
.footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
