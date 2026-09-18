<script setup>
import ModalShell from './ModalShell.vue'

defineProps({
  title: { type: String, required: true },
  message: { type: String, required: true },
  confirmText: { type: String, default: '确认删除' },
})
const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <ModalShell :title="title" width="460px" @close="emit('cancel')">
    <p class="msg">{{ message }}</p>
    <div class="footer">
      <button class="btn" @click="emit('cancel')">取消</button>
      <button class="btn danger" @click="emit('confirm')">{{ confirmText }}</button>
    </div>
  </ModalShell>
</template>

<style scoped>
.msg { font-size: 13px; color: var(--text-dim); line-height: 1.7; }
.footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
