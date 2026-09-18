<script setup>
// 快捷键只读列表：一条一行，按键 / 描述 两栏（替代旧的「·」拼接不换行文本）
import { computed } from 'vue'
import { parseHotkeyText } from '../lib/hotkeyText'

const props = defineProps({ text: { type: String, default: '' } })
const entries = computed(() => parseHotkeyText(props.text))
</script>

<template>
  <div v-if="entries.length" class="hk-list">
    <div class="hk-head"><span class="k">按键</span><span class="d">描述</span></div>
    <div v-for="(e, i) in entries" :key="i" class="hk-row">
      <span class="k">{{ e.key }}</span>
      <span class="d" :class="{ empty: !e.desc }">{{ e.desc || '—' }}</span>
    </div>
  </div>
  <div v-else class="hk-none">未记录</div>
</template>

<style scoped>
.hk-list {
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: var(--bg2); overflow: hidden;
}
.hk-head, .hk-row {
  display: grid; grid-template-columns: 128px 1fr; gap: 10px;
  padding: 6px 10px; align-items: baseline;
}
.hk-head {
  background: var(--bg3); font-size: 11px; color: var(--text-faint);
  border-bottom: 1px solid var(--line);
}
.hk-row + .hk-row { border-top: 1px dashed var(--line); }
.hk-row .k {
  font-family: Consolas, monospace; font-size: 12.5px; font-weight: 700;
  color: var(--info); word-break: break-all;
}
.hk-row .d { font-size: 12.5px; color: var(--text-dim); word-break: break-all; }
.hk-row .d.empty { color: var(--text-faint); }
.hk-none { color: var(--text-faint); font-size: 12.5px; }
</style>
