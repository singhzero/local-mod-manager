<template>
  <Teleport to="body">
    <div class="toasts">
      <div v-for="t in store.ui.toasts" :key="t.id" class="toast" :class="t.kind">
        {{ t.message }}
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { store } from '../store'
</script>

<style scoped>
.toasts {
  position: fixed; right: 18px; bottom: 18px; z-index: 300;
  display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
}
.toast {
  padding: 9px 14px; border-radius: var(--radius-sm);
  background: #ffffff; border: 1px solid var(--line-strong);
  color: var(--text); font-size: 13px; max-width: 420px;
  box-shadow: var(--shadow); animation: slideInRight .18s ease-out;
}
.toast.ok { border-color: #bfe3d0; color: var(--ok); }
.toast.warn { border-color: #f3ddb8; color: var(--warn); }
.toast.info { border-color: var(--accent-border); color: var(--accent-text); }
</style>
