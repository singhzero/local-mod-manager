<script setup>
import { store, visibleMods } from '../store'
import ModCard from './ModCard.vue'
</script>

<template>
  <div class="grid-scroll">
    <!-- 浏览器预览模式的演示数据说明 -->
    <div v-if="store.mode === 'browser' && store.mods.length" class="demo-note">
      ℹ 浏览器预览模式，列表为演示数据；桌面版（npm run dev:app）中导入真实解压入库。
    </div>

    <!-- 全库为空 -->
    <div v-if="store.mods.length === 0" class="empty-state" style="height: 100%">
      <div class="icon">📦</div>
      <div style="font-size: 16px; color: var(--text-dim)">还没有任何 mod</div>
      <div>把压缩包拖进窗口，或点击右上角「导入 mod」开始</div>
      <button class="btn primary" style="margin-top: 8px" @click="store.ui.modal = 'import'">＋ 导入 mod</button>
    </div>

    <!-- 筛选无结果 -->
    <div v-else-if="visibleMods.length === 0" class="empty-state" style="height: 100%">
      <div class="icon">🔍</div>
      <div style="font-size: 15px; color: var(--text-dim)">当前筛选下没有 mod</div>
      <div>试试切换左侧分类或清空搜索词</div>
    </div>

    <div v-else class="grid">
      <ModCard v-for="m in visibleMods" :key="m.id" :mod="m" />
    </div>
  </div>
</template>

<style scoped>
.grid-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.demo-note {
  margin: 14px 18px 0; padding: 8px 12px;
  font-size: 12px; color: var(--text-dim);
  background: var(--bg3); border: 1px solid var(--line); border-radius: var(--radius-sm);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 14px;
  padding: 18px;
}
</style>
