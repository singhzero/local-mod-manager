<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { store, toast, droppedFilePath } from './store'
import SideNav from './components/SideNav.vue'
import Toolbar from './components/Toolbar.vue'
import CardGrid from './components/CardGrid.vue'
import DetailPanel from './components/DetailPanel.vue'
import ImportWizard from './components/ImportWizard.vue'
import SettingsModal from './components/SettingsModal.vue'
import PresetSaveDialog from './components/PresetSaveDialog.vue'
import PresetApplyDialog from './components/PresetApplyDialog.vue'
import HotkeyAIDialog from './components/HotkeyAIDialog.vue'
import EditModDialog from './components/EditModDialog.vue'
import ToastHost from './components/ToastHost.vue'
import DragOverlay from './components/DragOverlay.vue'

function hasFiles(e) {
  return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')
}
function onDragEnter(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  store.ui.dragDepth++
}
function onDragOver(e) {
  if (hasFiles(e)) e.preventDefault()
}
function onDragLeave(e) {
  if (store.ui.dragDepth > 0) store.ui.dragDepth--
}
function onDrop(e) {
  e.preventDefault()
  store.ui.dragDepth = 0
  const fileObjs = [...(e.dataTransfer?.files || [])]
  const archives = fileObjs.filter((f) => /\.(zip|7z|rar)$/i.test(f.name))
  const skipped = fileObjs.length - archives.length
  if (skipped > 0) toast(`已跳过 ${skipped} 个非压缩包文件（仅支持 zip / 7z / rar）`, 'warn')
  if (!archives.length) return
  store.ui.droppedFiles = archives.map((f) => ({ name: f.name, path: droppedFilePath(f) }))
  store.ui.modal = 'import'
}
function onKeydown(e) {
  if (e.key !== 'Escape') return
  // AI 识别对话框可叠在导入向导之上：Esc 只关最上层
  if (store.ui.hotkeyAI) {
    store.ui.hotkeyAI = null
    return
  }
  if (store.ui.modal) store.ui.modal = null
}
onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app">
    <SideNav />
    <main class="main">
      <Toolbar />
      <div
        v-if="!(store.settings.repoPath && store.settings.modsPath) && !store.ui.bannerDismissed"
        class="config-banner"
      >
        <span>⚠ 尚未配置 mod 存放目录与 mod 加载目录，导入与启用功能不可用。</span>
        <span class="banner-actions">
          <button class="btn" @click="store.ui.modal = 'settings'">去设置</button>
          <button class="btn ghost" @click="store.ui.bannerDismissed = true">忽略</button>
        </span>
      </div>
      <CardGrid />
    </main>
    <DetailPanel />

    <ImportWizard v-if="store.ui.modal === 'import'" />
    <SettingsModal v-if="store.ui.modal === 'settings'" />
    <PresetSaveDialog v-if="store.ui.modal === 'savePreset'" />
    <PresetApplyDialog v-if="store.ui.modal === 'applyPreset'" />
    <EditModDialog v-if="store.ui.editModId" />
    <HotkeyAIDialog v-if="store.ui.hotkeyAI" />

    <DragOverlay v-if="store.ui.dragDepth > 0" />
    <ToastHost />
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 252px 1fr 330px;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
}
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg1);
  border-left: 1px solid var(--line);
  border-right: 1px solid var(--line);
}
.config-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin: 0 18px; padding: 9px 14px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border); border-radius: var(--radius-sm);
  color: var(--accent-text); font-size: 13px;
}
.banner-actions { display: flex; gap: 8px; }
</style>
