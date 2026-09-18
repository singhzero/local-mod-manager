<script setup>
// 角色 / 皮肤选择器：供导入向导与详情面板复用，支持内联新增
// 「原皮」是每个角色的真实皮肤分类（建角色时默认创建），默认选中
import { ref, computed, watch } from 'vue'
import { store, addCharacter, addSkin } from '../store'

const props = defineProps({
  characterId: { type: String, default: '' },
  skinId: { type: String, default: '' },
  required: { type: Boolean, default: true },
})
const emit = defineEmits(['update:characterId', 'update:skinId'])

const charSel = ref(props.characterId)
const skinSel = ref(props.skinId)
const newCharMode = ref(false)
const newCharName = ref('')
const newSkinMode = ref(false)
const newSkinName = ref('')

watch(
  () => props.characterId,
  (v) => {
    charSel.value = v
    newCharMode.value = false
  }
)
watch(
  () => props.skinId,
  (v) => {
    skinSel.value = v
    newSkinMode.value = false
  }
)

// HTML select 的 value 恒为字符串，而角色/皮肤 id 是数字 —— 统一按字符串比较、提交时转回数字
// （否则下拉选完角色后皮肤列表永远为空，导入时 id 传给主进程也会查不到归属）
const skinsOfChar = computed(() =>
  store.skins.filter((s) => String(s.characterId) === String(charSel.value || ''))
)
function coerceId(v) {
  if (v === '' || v == null) return ''
  return /^\d+$/.test(String(v)) ? Number(v) : v
}

// 该角色的原皮皮肤（不存在时回退为空 = 未归皮肤，启动迁移会归入原皮）
function defaultSkinId(charId) {
  const s = store.skins.find((x) => String(x.characterId) === String(charId || '') && x.name === '原皮')
  return s ? coerceId(s.id) : ''
}
function applyDefaultSkin() {
  const def = defaultSkinId(charSel.value)
  skinSel.value = def
  emit('update:skinId', def)
}

function onCharChange() {
  if (charSel.value === '__new') {
    newCharMode.value = true
    newCharName.value = ''
    return
  }
  newCharMode.value = false
  emit('update:characterId', coerceId(charSel.value))
  // 角色变化后原皮肤失效，默认选中该角色的原皮
  applyDefaultSkin()
}
async function confirmNewChar() {
  const name = newCharName.value.trim()
  if (!name) return
  const c = await addCharacter(name)
  newCharMode.value = false
  charSel.value = c.id
  emit('update:characterId', coerceId(c.id))
  applyDefaultSkin()
}
function onSkinChange() {
  if (skinSel.value === '__new') {
    newSkinMode.value = true
    newSkinName.value = ''
    return
  }
  newSkinMode.value = false
  emit('update:skinId', coerceId(skinSel.value))
}
async function confirmNewSkin() {
  const name = newSkinName.value.trim()
  if (!name || !charSel.value) return
  const s = await addSkin(charSel.value, name)
  newSkinMode.value = false
  skinSel.value = coerceId(s.id)
  emit('update:skinId', coerceId(s.id))
}
</script>

<template>
  <div class="cat-picker">
    <select class="input" :class="{ invalid: required && !charSel }" :value="props.characterId" @change="charSel = $event.target.value; onCharChange()">
      <option value="" disabled>{{ required ? '选择角色（必选）' : '（未分类）' }}</option>
      <option v-for="c in store.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
      <option value="__new">＋ 新建角色…</option>
    </select>
    <input
      v-if="newCharMode"
      v-model="newCharName"
      class="input new-input"
      placeholder="输入新角色名，回车确认 · Esc 取消"
      @keydown.enter.prevent="confirmNewChar"
      @keydown.esc="newCharMode = false; charSel = props.characterId"
    />
    <select class="input" :disabled="!props.characterId" :value="props.skinId" @change="skinSel = $event.target.value; onSkinChange()">
      <option v-if="!skinsOfChar.length" value="">原皮</option>
      <option v-for="s in skinsOfChar" :key="s.id" :value="s.id">{{ s.name }}</option>
      <option value="__new">＋ 新建皮肤…</option>
    </select>
    <input
      v-if="newSkinMode"
      v-model="newSkinName"
      class="input new-input"
      placeholder="输入皮肤名，回车确认 · Esc 取消"
      @keydown.enter.prevent="confirmNewSkin"
      @keydown.esc="newSkinMode = false; skinSel = props.skinId"
    />
  </div>
</template>

<style scoped>
.cat-picker { display: flex; flex-direction: column; gap: 8px; }
select.input.invalid { border-color: var(--danger); }
.new-input { font-size: 12.5px; }
</style>
