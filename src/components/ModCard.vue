<script setup>
import { computed } from 'vue'
import { store, charById, toggleSelect, toggleModEnabled, previewUrl, openEditMod } from '../store'
import { coverDataUri } from '../utils/cover'

const props = defineProps({ mod: { type: Object, required: true } })

const char = computed(() => (props.mod.characterId ? charById.value[props.mod.characterId] : null))
const skin = computed(() => (props.mod.skinId ? store.skins.find((s) => s.id === props.mod.skinId) : null))
const cover = computed(() => previewUrl(props.mod) || coverDataUri(props.mod.name, char.value?.color || '#8ea2ba'))
const isSelected = computed(() => store.ui.selectedIds.includes(props.mod.id))
const showCheckbox = computed(() => store.ui.multiSelect || isSelected.value)

function onCardClick() {
  if (store.ui.multiSelect) {
    toggleSelect(props.mod.id)
  } else {
    store.ui.selectedModId = props.mod.id
  }
}
function onCheckboxClick(e) {
  e.stopPropagation()
  toggleSelect(props.mod.id)
}
function onSwitchClick(e) {
  e.stopPropagation()
  toggleModEnabled(props.mod)
}
</script>

<template>
  <article
    class="card"
    :class="{ selected: isSelected, lost: mod.status === 'lost', enabled: mod.enabled }"
    @click="onCardClick"
  >
    <div class="cover">
      <img :src="cover" :alt="mod.name" draggable="false" />

      <span v-if="mod.status === 'lost'" class="ribbon lost">丢失</span>
      <span v-else-if="mod.status === 'conflict'" class="ribbon conflict">冲突</span>

      <label v-if="showCheckbox" class="checkbox" :class="{ checked: isSelected }" @click="onCheckboxClick">
        {{ isSelected ? '✓' : '' }}
      </label>

      <button
        v-else
        class="edit-btn"
        title="编辑 mod 信息（名称/预览图/快捷键/备注）"
        @click.stop="openEditMod(mod)"
      >✎</button>

      <button
        class="switch"
        :class="{ on: mod.enabled }"
        :disabled="mod.status === 'lost'"
        :title="mod.enabled ? '点击停用（移除目录联接）' : '点击启用（创建目录联接）'"
        @click="onSwitchClick"
      ></button>

      <span v-if="mod.enabled" class="on-badge">已启用</span>
    </div>

    <div class="meta">
      <div class="name" :title="mod.name">{{ mod.name }}</div>
      <div class="badges">
        <span v-if="char" class="chip"><i class="dot" :style="{ background: char.color }"></i>{{ char.name }}</span>
        <span v-else class="chip warn">未分类</span>
        <span v-if="skin" class="chip">{{ skin.name }}</span>
        <span v-if="mod.hotkey" class="chip key">⌨ {{ mod.hotkey }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  border-radius: var(--radius); overflow: hidden;
  background: var(--bg2); border: 1px solid var(--line);
  cursor: pointer; transition: transform .12s, border-color .12s, box-shadow .12s;
}
.card:hover { transform: translateY(-2px); border-color: var(--line-strong); box-shadow: var(--shadow); }
.card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), var(--shadow); }
.card.lost { opacity: .6; }

.cover { position: relative; aspect-ratio: 4 / 3; background: var(--bg3); }
.cover img { width: 100%; height: 100%; object-fit: cover; user-select: none; }

.ribbon {
  position: absolute; top: 8px; left: 0;
  padding: 2px 9px 2px 7px; font-size: 10.5px; font-weight: 700;
  border-radius: 0 4px 4px 0; letter-spacing: .06em;
}
.ribbon.lost { background: var(--danger); color: #ffffff; }
.ribbon.conflict { background: var(--warn); color: #ffffff; }

.checkbox {
  position: absolute; top: 8px; right: 8px;
  width: 20px; height: 20px; border-radius: 6px;
  border: 1.5px solid #d4cfdd;
  background: rgba(255, 255, 255, .9); color: var(--accent-ink);
  font-size: 12px; font-weight: 800; line-height: 17px; text-align: center;
  cursor: pointer;
}
.checkbox.checked { background: var(--accent); border-color: var(--accent); }

.edit-btn {
  position: absolute; top: 8px; right: 8px;
  width: 24px; height: 24px; border-radius: 7px;
  border: none; background: rgba(255, 255, 255, .92); color: var(--text-dim);
  font-size: 12px; cursor: pointer;
  opacity: 0; transition: opacity .12s;
}
.card:hover .edit-btn { opacity: 1; }
.edit-btn:hover { color: var(--accent-text); background: #ffffff; }

.switch { position: absolute; bottom: 8px; right: 8px; }
.on-badge {
  position: absolute; bottom: 9px; left: 8px;
  font-size: 10.5px; font-weight: 700; color: var(--accent-ink);
  background: var(--accent); border-radius: 4px; padding: 1px 7px;
  letter-spacing: .04em;
}

.meta { padding: 9px 11px 11px; }
.name {
  font-size: 13px; font-weight: 600; margin-bottom: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.badges { display: flex; flex-wrap: wrap; gap: 5px; }
.chip.key { color: var(--info); border-color: #bcd9ec; background: #eef7fd; }
</style>
