<template>
  <div class="drag-overlay">
    <div class="box">
      <div class="icon">📦</div>
      <div class="title">松开鼠标，导入压缩包</div>
      <div class="sub">支持 zip / rar / 7z · 将进入导入向导（原型演示）</div>
    </div>
  </div>
</template>

<style scoped>
.drag-overlay {
  position: fixed; inset: 0; z-index: 400;
  background: rgba(251, 251, 253, .94);
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn .12s ease-out;
}
.box {
  border: 2px dashed var(--accent); border-radius: 16px;
  padding: 48px 72px; text-align: center; background: #ffffff;
  box-shadow: var(--shadow);
}
.icon { font-size: 44px; margin-bottom: 10px; }
.title { font-size: 22px; font-weight: 700; color: var(--accent-text); }
.sub { margin-top: 6px; color: var(--text-dim); font-size: 13px; }
</style>
