<script setup>
import { ref, computed } from 'vue'
import { store, setNav, charCount, skinCount, addCharacter, addSkin, renamePreset, deletePreset, toast, renameCharacter, deleteCharacter, renameSkin, deleteSkin, sortedCharacters, toggleCharacterStar } from '../store'
import ConfirmDialog from './ConfirmDialog.vue'

// 角色默认全部收起（点 › 展开），「«」一键收起
const expandedChars = ref(new Set())
const addingChar = ref(false)
const newCharName = ref('')
const addingSkinFor = ref(null) // characterId
const newSkinName = ref('')
const renamingPresetId = ref(null)
const renameValue = ref('')
const confirmingDeleteId = ref(null)

// 分类管理状态
const renamingCharId = ref(null)
const renamingSkinId = ref(null)
const catNameValue = ref('')
const confirmTarget = ref(null) // { type: 'char' | 'skin', target }

function skinsOf(charId) {
  return store.skins.filter((s) => String(s.characterId) === String(charId))
}
const sortedChars = computed(() => sortedCharacters.value)
function toggleExpand(id) {
  const s = new Set(expandedChars.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expandedChars.value = s
}
function collapseAll() {
  expandedChars.value = new Set()
}
function confirmNewChar() {
  const name = newCharName.value.trim()
  if (!name) return
  addCharacter(name).then((c) => {
    newCharName.value = ''
    addingChar.value = false
    setNav({ type: 'char', id: c.id })
  })
}
function confirmNewSkin() {
  const name = newSkinName.value.trim()
  if (!name || !addingSkinFor.value) return
  addSkin(addingSkinFor.value, name).then(() => {
    newSkinName.value = ''
    addingSkinFor.value = null
  })
}

// ---- 角色重命名 / 删除 ----
function startRenameChar(c) {
  renamingCharId.value = c.id
  renamingSkinId.value = null
  catNameValue.value = c.name
}
async function confirmRenameCat() {
  const isChar = renamingCharId.value !== null
  const id = isChar ? renamingCharId.value : renamingSkinId.value
  const target = isChar
    ? store.characters.find((x) => x.id === id)
    : store.skins.find((x) => x.id === id)
  renamingCharId.value = null
  renamingSkinId.value = null
  if (!target) return
  const ok = isChar ? await renameCharacter(target, catNameValue.value) : await renameSkin(target, catNameValue.value)
  if (ok) clearStaleNav(isChar ? 'char' : 'skin', id)
}
function askDeleteChar(c) {
  confirmTarget.value = { type: 'char', target: c }
}
function askDeleteSkin(s) {
  if (s.name === '原皮') {
    toast('原皮是角色的默认皮肤分类，不可删除', 'warn')
    return
  }
  confirmTarget.value = { type: 'skin', target: s }
}
async function doConfirmDelete() {
  const t = confirmTarget.value
  confirmTarget.value = null
  if (!t) return
  const ok = t.type === 'char' ? await deleteCharacter(t.target) : await deleteSkin(t.target)
  if (ok) clearStaleNav(t.type, t.target.id)
}
function clearStaleNav(type, id) {
  if (store.ui.nav.type === type && store.ui.nav.id === id) setNav({ type: 'all', id: null })
}
function confirmMessage() {
  const t = confirmTarget.value
  if (!t) return { title: '', message: '' }
  if (t.type === 'char') {
    const skinCount = store.skins.filter((s) => s.characterId === t.target.id).length
    const modCount = store.mods.filter((m) => m.characterId === t.target.id).length
    return {
      title: '删除角色',
      message: `将删除角色「${t.target.name}」${skinCount ? `及其 ${skinCount} 个皮肤` : ''}，其下 ${modCount} 个 mod 将移入「未分类」。mod 文件不会被删除，仅移动目录；若加载目录中有对应联接将同步移除。`,
    }
  }
  const modCount = store.mods.filter((m) => m.skinId === t.target.id).length
  return {
    title: '删除皮肤',
    message: `将删除皮肤「${t.target.name}」，其下 ${modCount} 个 mod 将上移到角色根目录。mod 文件不会被删除，仅移动目录。`,
  }
}

function startRenamePreset(p) {
  renamingPresetId.value = p.id
  renameValue.value = p.name
}
function confirmRenamePreset() {
  const p = store.presets.find((x) => x.id === renamingPresetId.value)
  const name = renameValue.value.trim()
  if (p && name) renamePreset(p, name)
  renamingPresetId.value = null
}
function askDeletePreset(p) {
  if (p.locked) {
    toast('默认预设不可删除', 'warn')
    return
  }
  if (confirmingDeleteId.value === p.id) {
    confirmingDeleteId.value = null
    deletePreset(p)
  } else {
    confirmingDeleteId.value = p.id
    setTimeout(() => {
      if (confirmingDeleteId.value === p.id) confirmingDeleteId.value = null
    }, 2500)
  }
}
</script>

<template>
  <aside class="side">
    <div class="brand">
      <div class="logo">M</div>
      <div>
        <div class="name">本地模组管理器</div>
        <div class="tag">{{ store.mode === 'electron' ? '桌面版 · 本机 SQLite' : '浏览器预览 · mock 数据' }}</div>
      </div>
    </div>

    <div class="scroll">
      <!-- 基础导航 -->
      <button class="nav-item" :class="{ active: store.ui.nav.type === 'all' && !store.ui.editingPresetId }" @click="setNav({ type: 'all', id: null })">
        <span class="ico">▦</span><span class="label">全部 mod</span><span class="count">{{ store.mods.length }}</span>
      </button>
      <button class="nav-item" :class="{ active: store.ui.nav.type === 'uncategorized' && !store.ui.editingPresetId }" @click="setNav({ type: 'uncategorized', id: null })">
        <span class="ico">?</span><span class="label">未分类</span><span class="count">{{ store.mods.filter((m) => !m.characterId).length }}</span>
      </button>

      <!-- 角色 -->
      <div class="sec-head">
        <span class="sec-title">角色</span>
        <span class="head-actions">
          <button class="mini-add" title="一键收起所有展开的角色" @click="collapseAll">«</button>
          <button class="mini-add" title="新增角色" @click="addingChar = !addingChar">＋</button>
        </span>
      </div>
      <div v-if="addingChar" class="inline-add">
        <input v-model="newCharName" class="input" placeholder="输入角色名，回车确认" autofocus @keydown.enter="confirmNewChar" @keydown.esc="addingChar = false" />
      </div>
      <div v-for="c in sortedChars" :key="c.id" class="char-block">
        <!-- 角色重命名态 -->
        <div v-if="renamingCharId === c.id" class="inline-add">
          <input v-model="catNameValue" class="input" autofocus @keydown.enter="confirmRenameCat" @keydown.esc="renamingCharId = null" @blur="confirmRenameCat" />
        </div>
        <div v-else class="nav-item row" :class="{ active: store.ui.nav.type === 'char' && store.ui.nav.id === c.id && !store.ui.editingPresetId }" role="button" @click="setNav({ type: 'char', id: c.id })">
          <span class="chev" :class="{ open: expandedChars.has(c.id) }" @click.stop="toggleExpand(c.id)">›</span>
          <span class="dot" :style="{ background: c.color }"></span>
          <span class="label" :title="c.name">{{ c.name }}</span>
          <span class="count">{{ charCount(c.id) }}</span>
          <span class="row-actions" :class="{ pinned: c.starred }">
            <button class="pbtn star-btn" :class="{ on: c.starred }" :title="c.starred ? '取消置顶' : '置顶（星标）'" @click.stop="toggleCharacterStar(c)">{{ c.starred ? '★' : '☆' }}</button>
            <button class="pbtn" title="重命名角色" @click.stop="startRenameChar(c)">✎</button>
            <button class="pbtn del" title="删除角色（其下 mod 移入未分类）" @click.stop="askDeleteChar(c)">🗑</button>
          </span>
        </div>
        <div v-if="expandedChars.has(c.id)" class="skins">
          <template v-for="s in skinsOf(c.id)" :key="s.id">
            <!-- 皮肤重命名态 -->
            <div v-if="renamingSkinId === s.id" class="inline-add">
              <input v-model="catNameValue" class="input" autofocus @keydown.enter="confirmRenameCat" @keydown.esc="renamingSkinId = null" @blur="confirmRenameCat" />
            </div>
            <div
              v-else
              class="nav-item sub row"
              :class="{ active: store.ui.nav.type === 'skin' && store.ui.nav.id === s.id && !store.ui.editingPresetId }"
              role="button"
              @click="setNav({ type: 'skin', id: s.id })"
            >
              <span class="dot small" :style="{ background: c.color }"></span>
              <span class="label" :title="s.name">{{ s.name }}</span>
              <span class="count">{{ skinCount(s.id) }}</span>
              <span class="row-actions">
                <button class="pbtn" title="重命名皮肤" @click.stop="renamingSkinId = s.id; renamingCharId = null; catNameValue = s.name">✎</button>
                <button v-if="s.name !== '原皮'" class="pbtn del" title="删除皮肤（其下 mod 上移到角色根目录）" @click.stop="askDeleteSkin(s)">🗑</button>
              </span>
            </div>
          </template>
          <template v-if="addingSkinFor === c.id">
            <div class="inline-add">
              <input v-model="newSkinName" class="input" placeholder="皮肤名，回车确认" @keydown.enter="confirmNewSkin" @keydown.esc="addingSkinFor = null" />
            </div>
          </template>
          <button v-else class="nav-item sub add-skin" @click="addingSkinFor = c.id; newSkinName = ''">
            <span class="label">＋ 新增皮肤</span>
          </button>
        </div>
      </div>

      <!-- 预设 -->
      <div class="sec-head preset-head">
        <span class="sec-title">预设</span>
      </div>
      <div v-for="p in store.presets" :key="p.id" class="preset-row" :class="{ editing: store.ui.editingPresetId === p.id }">
        <template v-if="renamingPresetId === p.id">
          <input v-model="renameValue" class="input" @keydown.enter="confirmRenamePreset" @keydown.esc="renamingPresetId = null" @blur="confirmRenamePreset" />
        </template>
        <template v-else>
          <button class="preset-name" @click="store.ui.editingPresetId = store.ui.editingPresetId === p.id ? null : p.id">
            <span class="label">{{ p.name }}</span>
            <span class="count">{{ p.modIds.length }}</span>
          </button>
          <span class="preset-actions">
            <button class="pbtn apply" title="一键应用（替换当前启用集）" @click="store.ui.applyPresetId = p.id; store.ui.modal = 'applyPreset'">▶</button>
            <button class="pbtn" title="重命名" @click="startRenamePreset(p)">✎</button>
            <button class="pbtn del" :class="{ confirm: confirmingDeleteId === p.id }" :title="p.locked ? '默认预设不可删除' : '删除预设'" @click="askDeletePreset(p)">✕</button>
          </span>
        </template>
      </div>
      <button
        class="new-preset"
        :disabled="store.ui.selectedIds.length === 0"
        @click="store.ui.modal = 'savePreset'"
      >
        ＋ 用选中的 {{ store.ui.selectedIds.length }} 项新建预设
      </button>
    </div>

    <div class="footer">
      <button class="nav-item" @click="store.ui.modal = 'settings'">
        <span class="ico">⚙</span><span class="label">设置</span>
      </button>
      <div class="paths" :title="`存放目录：${store.settings.repoPath || '未设置'}\n加载目录：${store.settings.modsPath || '未设置'}`">
        {{ (store.settings.repoPath && store.settings.modsPath) ? '目录已配置' : '目录未配置' }}
      </div>
    </div>

    <ConfirmDialog
      v-if="confirmTarget"
      :title="confirmMessage().title"
      :message="confirmMessage().message"
      @confirm="doConfirmDelete"
      @cancel="confirmTarget = null"
    />
  </aside>
</template>

<style scoped>
.side {
  display: flex; flex-direction: column;
  background: var(--bg0); overflow: hidden;
}
.brand {
  display: flex; gap: 10px; align-items: center;
  padding: 16px 16px 14px;
}
.logo {
  width: 34px; height: 34px; border-radius: 9px; flex: none;
  background: var(--accent); color: var(--accent-ink);
  font-weight: 800; font-size: 19px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(247, 184, 215, .5);
}
.name { font-weight: 700; font-size: 14px; }
.tag { font-size: 10px; color: var(--text-faint); margin-top: 1px; }

.scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 10px 12px; }

.sec-head {
  display: flex; align-items: center; justify-content: space-between;
  margin: 16px 8px 6px;
}
.sec-title { font-size: 11px; font-weight: 600; letter-spacing: .12em; color: var(--text-faint); }
.mini-add {
  width: 20px; height: 20px; border-radius: 6px; border: 1px solid var(--line-strong);
  background: transparent; color: var(--text-dim); cursor: pointer; font-size: 12px; line-height: 1;
}
.mini-add:hover { color: var(--accent-text); border-color: var(--accent); }
.head-actions { display: flex; gap: 4px; }

.inline-add { padding: 2px 8px 6px 30px; }
.inline-add .input { font-size: 12px; padding: 5px 8px; }

.nav-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 9px; border-radius: 8px; border: none;
  background: transparent; color: var(--text-dim);
  font-size: 13px; cursor: pointer; text-align: left;
}
.nav-item:hover { background: var(--bg3); color: var(--text); }
.nav-item.active { background: var(--accent-soft); color: var(--accent-text); }
.nav-item .ico { width: 18px; text-align: center; opacity: .8; flex: none; }
.nav-item .chev {
  width: 14px; flex: none; text-align: center; color: var(--text-faint);
  transition: transform .12s; font-size: 13px; margin-left: -4px;
}
.nav-item .chev.open { transform: rotate(90deg); }
.nav-item .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.nav-item .dot.small { width: 6px; height: 6px; }
.nav-item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-item .count { font-size: 11px; color: var(--text-faint); flex: none; }
.nav-item.sub { padding-left: 30px; font-size: 12.5px; }
.nav-item.add-skin { color: var(--text-faint); }
.nav-item.add-skin:hover { color: var(--accent-text); }
.skins { margin: 1px 0 3px; }

/* 行内管理按钮 */
.nav-item.row { padding-right: 4px; }
.row-actions { display: flex; gap: 1px; opacity: 0; transition: opacity .12s; flex: none; }
.nav-item.row:hover .row-actions, .row-actions.pinned { opacity: 1; }
.pbtn {
  width: 20px; height: 20px; border-radius: 5px; border: none;
  background: transparent; color: var(--text-faint); cursor: pointer; font-size: 10.5px;
}
.pbtn:hover { background: #ffffff; color: var(--text); }
.pbtn.del:hover { color: var(--danger); }
.star-btn.on { color: var(--accent-text); font-size: 12px; }

.preset-head { margin-top: 20px; }
.preset-row {
  display: flex; align-items: center; gap: 4px;
  border-radius: 8px; padding: 1px 4px 1px 2px; margin: 1px 0;
}
.preset-row:hover { background: var(--bg3); }
.preset-row.editing { background: var(--accent-soft); outline: 1px solid var(--accent-border); }
.preset-name {
  flex: 1; display: flex; align-items: center; gap: 8px;
  background: transparent; border: none; color: var(--text-dim);
  font-size: 13px; cursor: pointer; padding: 6px 7px; min-width: 0; text-align: left;
}
.preset-name .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preset-name .count { font-size: 11px; color: var(--text-faint); }
.preset-name:hover { color: var(--text); }
.preset-row.editing .preset-name { color: var(--accent-text); }
.preset-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .12s; }
.preset-row:hover .preset-actions, .preset-row.editing .preset-actions { opacity: 1; }
.pbtn.apply:hover { color: var(--ok); }
.pbtn.del.confirm { color: #ffffff; background: var(--danger); }

.new-preset {
  width: calc(100% - 8px); margin: 6px 4px 0;
  padding: 7px; border-radius: 8px; font-size: 12px;
  border: 1px dashed var(--line-strong); background: transparent;
  color: var(--text-faint); cursor: pointer;
}
.new-preset:hover:not(:disabled) { color: var(--accent-text); border-color: var(--accent); }
.new-preset:disabled { opacity: .45; cursor: not-allowed; }

.footer { border-top: 1px solid var(--line); padding: 8px 10px; }
.paths { font-size: 11px; color: var(--text-faint); padding: 4px 9px 2px; }
</style>
