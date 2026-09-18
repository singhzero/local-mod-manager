<script setup>
import { onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  width: { type: String, default: '560px' },
  escClose: { type: Boolean, default: true }, // 叠放另一层弹窗时可关闭 Esc（如导入向导上叠 AI 识别）
})
const emit = defineEmits(['close'])

function onKey(e) {
  if (e.key === 'Escape' && props.escClose) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="modal" :style="{ width: props.width }">
        <header>
          <h2>{{ title }}</h2>
          <button class="close" @click="emit('close')">✕</button>
        </header>
        <div class="body">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(67, 41, 58, .32); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn .12s ease-out;
}
.modal {
  max-height: 86vh; display: flex; flex-direction: column;
  background: var(--bg2); border: 1px solid var(--line-strong);
  border-radius: 14px; box-shadow: var(--shadow);
  animation: popIn .16s ease-out;
}
header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--line);
}
h2 { font-size: 15px; font-weight: 600; }
.close {
  width: 28px; height: 28px; border-radius: 7px;
  background: transparent; border: none; color: var(--text-faint);
  font-size: 14px; cursor: pointer;
}
.close:hover { background: var(--bg3); color: var(--text); }
.body { padding: 18px; overflow-y: auto; }
</style>
