<script setup>
import { computed } from 'vue'
import { store, presetDiff, presetConflicts, applyPreset, modById } from '../store'
import ModalShell from './ModalShell.vue'

const preset = computed(() => store.presets.find((p) => p.id === store.ui.applyPresetId))
const diff = computed(() => (preset.value ? presetDiff(preset.value) : { toEnable: [], toDisable: [] }))
const enableList = computed(() => diff.value.toEnable.map((id) => modById.value[id]).filter(Boolean))
const disableList = computed(() => diff.value.toDisable.map((id) => modById.value[id]).filter(Boolean))
const noChange = computed(() => !enableList.value.length && !disableList.value.length)
const conflicts = computed(() => (preset.value ? presetConflicts(preset.value) : []))

function confirm() {
  applyPreset(preset.value)
  store.ui.modal = null
}
</script>

<template>
  <ModalShell v-if="preset" :title="`应用预设 · ${preset.name}`" width="560px" @close="store.ui.modal = null">
    <p class="rule">
      应用后<b>启用集将严格等于该预设成员</b>（差量执行：删除多余目录联接、补建缺失联接）。
    </p>

    <div v-if="noChange" class="same">当前启用集与该预设已一致，无需变更。</div>

    <div v-if="conflicts.length" class="conflicts">
      <div class="c-head">⚠ 资源重叠提示（仅提示，不影响应用）</div>
      <div v-for="(g, i) in conflicts" :key="i" class="c-group">
        <b>{{ g.character?.name || '未分类' }}{{ g.skin ? ' / ' + g.skin.name : '' }}</b>
        （{{ g.mods.length }} 个）：{{ g.mods.map((m) => m.name).join('、') }}
      </div>
      <div class="c-sub">同组 mod 若替换同一游戏资源可能相互覆盖；改的是不同资源则可并存。</div>
    </div>

    <div v-else class="cols">
      <div class="col">
        <div class="col-head on">将启用 {{ enableList.length }} 个</div>
        <ul v-if="enableList.length">
          <li v-for="m in enableList" :key="m.id">＋ {{ m.name }}</li>
        </ul>
        <div v-else class="none">无</div>
      </div>
      <div class="col">
        <div class="col-head off">将停用 {{ disableList.length }} 个</div>
        <ul v-if="disableList.length">
          <li v-for="m in disableList" :key="m.id">－ {{ m.name }}</li>
        </ul>
        <div v-else class="none">无</div>
      </div>
    </div>

    <div v-if="preset.modIds.length === 0" class="warn-note">
      ⚠ 该预设为空：应用后将停用全部已启用的 mod。
    </div>

    <div class="footer">
      <button class="btn" @click="store.ui.modal = null">取消</button>
      <button class="btn primary" :disabled="noChange" @click="confirm">
        应用（启用 {{ enableList.length }} · 停用 {{ disableList.length }}）
      </button>
    </div>
  </ModalShell>
</template>

<style scoped>
.rule { font-size: 12.5px; color: var(--text-dim); margin-bottom: 14px; }
.rule b { color: var(--accent-text); }
.same {
  font-size: 13px; color: var(--ok); text-align: center;
  padding: 18px; border: 1px dashed #bfe3d0; border-radius: var(--radius-sm);
  background: #eefaf3;
}
.cols { display: flex; gap: 12px; }
.conflicts {
  margin-bottom: 14px;
  background: #fdf6ea; border: 1px solid #f3ddb8;
  border-radius: var(--radius-sm); padding: 10px 12px;
  display: flex; flex-direction: column; gap: 5px;
}
.c-head { font-size: 12.5px; font-weight: 700; color: var(--warn); }
.c-group { font-size: 12.5px; color: var(--text); line-height: 1.6; }
.c-group b { color: var(--warn); }
.c-sub { font-size: 11.5px; color: var(--text-faint); }
.col { flex: 1; min-width: 0; }
.col-head { font-size: 12px; font-weight: 700; margin-bottom: 8px; }
.col-head.on { color: var(--ok); }
.col-head.off { color: var(--text-faint); }
.col ul {
  list-style: none; max-height: 220px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 4px;
}
.col li {
  font-size: 12.5px; padding: 5px 9px; border-radius: 6px;
  background: var(--bg3); border: 1px solid var(--line);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.col:first-child li { border-color: #bfe3d0; }
.none { font-size: 12px; color: var(--text-faint); }
.warn-note {
  margin-top: 14px; font-size: 12.5px; color: var(--warn);
  background: #fdf6ea; border: 1px solid #f3ddb8;
  border-radius: var(--radius-sm); padding: 9px 12px;
}
.footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
