<script setup>
import { ref, computed, watch } from 'vue'
import { store, charById, toast, importModsMock, pickArchiveFiles, detectArchive, executeImport } from '../store'
import { demoPickedFiles, detectStructure } from '../data/mock'
import ModalShell from './ModalShell.vue'
import CategoryPicker from './CategoryPicker.vue'

const step = ref(1)
const steps = ['选择文件', '识别结构', '归属分类', '完成导入']
const isElectron = store.mode === 'electron'

// files: [{ name, path|null, size, structure: {kind, folders, wrap?}|null, error, mode }]
const files = ref(
  store.ui.droppedFiles.length
    ? store.ui.droppedFiles.map((f) => ({ name: f.name, path: f.path || null, size: '—', structure: null, error: null, mode: 'split' }))
    : []
)
const detecting = ref(false)

async function addDemoFiles() {
  if (isElectron) {
    const paths = await pickArchiveFiles()
    for (const p of paths) {
      if (!files.value.some((x) => x.path === p)) {
        files.value.push({ name: p.split(/[\\/]/).pop(), path: p, size: '—', structure: null, error: null, mode: 'split' })
      }
    }
  } else {
    demoPickedFiles.forEach((f) => {
      if (!files.value.some((x) => x.name === f.name)) {
        files.value.push({ name: f.name, path: null, size: f.size, structure: null, error: null, mode: 'split' })
      }
    })
  }
}
function removeFile(i) {
  files.value.splice(i, 1)
}

// ---- 步骤 2：结构识别（真实 7z l / 浏览器 mock）----
async function runDetect() {
  detecting.value = true
  for (const f of files.value) {
    f.error = null
    try {
      if (isElectron && f.path) {
        f.structure = await detectArchive(f.path)
      } else {
        f.structure = detectStructure(f.name)
      }
    } catch (err) {
      f.error = err.message
    }
  }
  detecting.value = false
}
watch(step, async (s) => {
  if (s === 2) await runDetect()
  if (s === 3) buildItems()
})

function modeOf(f) {
  return f.mode
}
function setMode(f, v) {
  f.mode = v
}
const hasError = computed(() => files.value.some((f) => f.error))
const allDetected = computed(() => files.value.every((f) => f.structure || f.error))

// ---- 步骤 3：归属 ----
const items = ref([])
function baseName(name) {
  return name.replace(/\.(zip|7z|rar)$/i, '')
}
function buildItems() {
  const list = []
  for (const f of files.value) {
    if (!f.structure) continue
    const st = f.structure
    if (st.kind === 'multi' && f.mode === 'split') {
      // 拆分：每个顶层文件夹一个 mod
      st.folders.forEach((folder) => {
        list.push({ name: folder, source: f, folder, characterId: '', skinId: '', hotkey: '' })
      })
    } else {
      // 整体：单个文件夹 / 散文件 / 多文件夹选整体 → 移动整个解压根
      const wrap = st.kind === 'multi' ? true : !!st.wrap
      list.push({
        name: st.kind === 'multi' ? baseName(f.name) : (st.folders[0] || baseName(f.name)),
        source: f,
        folder: wrap ? null : st.folders[0],
        characterId: '',
        skinId: '',
        hotkey: '',
      })
    }
  }
  items.value = list
}
const allAssigned = computed(() => items.value.length > 0 && items.value.every((it) => it.characterId))

// AI 识别快捷键：结果暂存在向导条目上，完成导入时随 items 落库
function openAI(it) {
  store.ui.hotkeyAI = {
    existingText: it.hotkey || '',
    save: async (text) => {
      it.hotkey = text
      return true
    },
  }
}

// ---- 步骤 4：摘要 + 执行 ----
function charName(id) {
  return charById.value[id]?.name || ''
}
function skinName(id) {
  return store.skins.find((s) => s.id === id)?.name || ''
}
const importing = ref(false)
async function finish() {
  importing.value = true
  try {
    if (isElectron) {
      // 按压缩包分组逐个执行真实导入
      const bySource = new Map()
      for (const it of items.value) {
        if (!bySource.has(it.source)) bySource.set(it.source, [])
        bySource.get(it.source).push({
          folder: it.folder,
          name: it.name,
          characterId: it.characterId,
          skinId: it.skinId || null,
          hotkey: it.hotkey || null,
        })
      }
      let count = 0
      for (const [archive, list] of bySource) {
        const created = await executeImport({ archivePath: archive.path, items: list })
        count += created.length
      }
      toast(`已导入 ${count} 个 mod 并归档入库`, 'ok')
    } else {
      const created = importModsMock(items.value.map((it) => ({
        name: it.name, characterId: it.characterId, skinId: it.skinId, source: it.source.name, size: it.source.size,
        hotkey: it.hotkey || null,
      })))
      if (created.length) store.ui.selectedModId = created[0].id
      toast(`（模拟）已导入 ${created.length} 个 mod（桌面版中为真实解压入库）`, 'ok')
    }
    if (store.mods.length) store.ui.selectedModId = store.mods[0].id
    store.ui.droppedFiles = []
    store.ui.modal = null
  } catch (err) {
    toast('导入失败：' + err.message, 'warn')
  }
  importing.value = false
}
</script>

<template>
  <ModalShell title="导入 mod 压缩包" width="680px" :esc-close="!store.ui.hotkeyAI" @close="store.ui.modal = null">
    <!-- 步骤条 -->
    <ol class="stepper">
      <li v-for="(s, i) in steps" :key="s" :class="{ cur: step === i + 1, done: step > i + 1 }">
        <span class="num">{{ step > i + 1 ? '✓' : i + 1 }}</span>{{ s }}
      </li>
    </ol>

    <!-- 步骤 1 -->
    <div v-if="step === 1" class="step-body">
      <div class="dropzone" @click="addDemoFiles">
        <div class="dz-icon">📂</div>
        <div class="dz-main">点击选择压缩包，或将文件拖入窗口</div>
        <div class="dz-sub">支持 zip / rar / 7z {{ isElectron ? '· 将真实解压入库' : '· 预览模式使用演示数据' }}</div>
      </div>
      <ul v-if="files.length" class="file-list">
        <li v-for="(f, i) in files" :key="f.path || f.name">
          <span class="f-ico">🗜</span>
          <span class="f-name">{{ f.name }}</span>
          <span class="f-size">{{ f.size }}</span>
          <button class="btn ghost" @click="removeFile(i)">移除</button>
        </li>
      </ul>
    </div>

    <!-- 步骤 2 -->
    <div v-if="step === 2" class="step-body">
      <div v-if="detecting" class="tip">正在读取压缩包结构…</div>
      <div v-for="f in files" :key="f.path || f.name" class="struct-card">
        <div class="struct-head">
          <span class="f-ico">🗜</span><b>{{ f.name }}</b>
        </div>
        <div v-if="f.error" class="struct-result danger-line">✗ {{ f.error }}</div>
        <template v-else-if="f.structure">
          <template v-if="f.structure.kind === 'single'">
            <div class="struct-result ok-line">
              ✓ {{ f.structure.wrap ? '压缩包内为散文件 / 混合内容' : '识别到 1 个 mod 文件夹' }}：<code>{{ f.structure.folders[0] }}</code>，将整体导入为 1 个 mod
            </div>
          </template>
          <template v-else>
            <div class="struct-result warn-line">
              ⚠ 检测到压缩包内含 {{ f.structure.folders.length }} 个 mod 文件夹：
              <code v-for="fd in f.structure.folders" :key="fd">{{ fd }}</code>
            </div>
            <div class="mode-row">
              <label class="mode" :class="{ on: modeOf(f) === 'split' }">
                <input type="radio" :name="'m-' + f.name" :checked="modeOf(f) === 'split'" @change="setMode(f, 'split')" />
                <div>
                  <b>拆分导入（推荐）</b>
                  <div class="mode-sub">每个文件夹作为一个独立 mod，分别归属角色</div>
                </div>
              </label>
              <label class="mode" :class="{ on: modeOf(f) === 'whole' }">
                <input type="radio" :name="'m-' + f.name" :checked="modeOf(f) === 'whole'" @change="setMode(f, 'whole')" />
                <div>
                  <b>整体导入</b>
                  <div class="mode-sub">压缩包作为一个 mod 入库，不做拆分</div>
                </div>
              </label>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- 步骤 3 -->
    <div v-if="step === 3" class="step-body">
      <p class="tip">每个 mod 必须归属一个角色（可在此新建角色 / 皮肤），皮肤可选。</p>
      <div v-for="(it, i) in items" :key="i" class="assign-card">
        <div class="assign-head">
          <input v-model="it.name" class="input name" placeholder="mod 名称" />
          <span class="src" :title="it.source.name">来自 {{ it.source.name }}</span>
        </div>
        <CategoryPicker
          :character-id="it.characterId"
          :skin-id="it.skinId"
          @update:character-id="(v) => (it.characterId = v)"
          @update:skin-id="(v) => (it.skinId = v)"
        />
        <div class="hk-row">
          <button class="btn ghost" @click="openAI(it)">✨ AI 识别快捷键</button>
          <span v-if="it.hotkey" class="hk-text" :title="it.hotkey">⌨ {{ it.hotkey }}</span>
          <button v-if="it.hotkey" class="btn ghost" @click="it.hotkey = ''">清除</button>
        </div>
      </div>
    </div>

    <!-- 步骤 4 -->
    <div v-if="step === 4" class="step-body">
      <p class="tip">确认导入清单{{ isElectron ? '，完成后将解压并归档到仓库：' : '（预览模式，仅写入演示数据）：' }}</p>
      <ul class="summary">
        <li v-for="(it, i) in items" :key="i">
          <b>{{ it.name }}</b>
          <span class="chip"><i class="dot" :style="{ background: charById[it.characterId]?.color }"></i>{{ charName(it.characterId) }}</span>
          <span class="chip">{{ it.skinId ? skinName(it.skinId) : '原皮' }}</span>
          <span class="src">{{ it.source.name }}</span>
        </li>
      </ul>
    </div>

    <!-- 底部按钮 -->
    <div class="wizard-footer">
      <button v-if="step > 1" class="btn" :disabled="importing" @click="step--">← 上一步</button>
      <span style="flex: 1"></span>
      <button v-if="step === 1" class="btn primary" :disabled="!files.length" @click="step = 2">下一步：识别结构</button>
      <button v-if="step === 2" class="btn primary" :disabled="!allDetected || hasError" @click="step = 3">
        {{ hasError ? '存在读取失败的压缩包' : '下一步：归属分类' }}
      </button>
      <button v-if="step === 3" class="btn primary" :disabled="!allAssigned" @click="step = 4">
        {{ allAssigned ? '下一步：确认导入' : '请先为所有 mod 选择角色' }}
      </button>
      <button v-if="step === 4" class="btn primary" :disabled="importing" @click="finish">
        {{ importing ? '正在导入…' : `✓ 完成导入（${items.length} 个）` }}
      </button>
    </div>
  </ModalShell>
</template>

<style scoped>
.stepper {
  display: flex; gap: 6px; list-style: none; margin-bottom: 18px;
}
.stepper li {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-faint);
  padding: 4px 10px; border-radius: 20px; border: 1px solid var(--line);
}
.stepper li.cur { color: var(--accent-text); border-color: var(--accent); background: var(--accent-soft); }
.stepper li.done { color: var(--ok); border-color: #bfe3d0; }
.num {
  width: 17px; height: 17px; border-radius: 50%; flex: none;
  background: var(--bg3); font-size: 10.5px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
li.cur .num { background: var(--accent); color: var(--accent-ink); }
li.done .num { background: #eefaf3; }

.step-body { display: flex; flex-direction: column; gap: 12px; min-height: 220px; }
.dropzone {
  border: 2px dashed var(--line-strong); border-radius: 12px;
  padding: 28px; text-align: center; cursor: pointer; transition: border-color .12s;
}
.dropzone:hover { border-color: var(--accent); }
.dz-icon { font-size: 30px; margin-bottom: 6px; }
.dz-main { font-size: 14px; font-weight: 600; }
.dz-sub { font-size: 12px; color: var(--text-faint); margin-top: 4px; }

.file-list, .summary { list-style: none; display: flex; flex-direction: column; gap: 7px; }
.file-list li, .summary li {
  display: flex; align-items: center; gap: 9px;
  background: var(--bg3); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 8px 11px; font-size: 13px;
}
.f-ico { flex: none; }
.f-name { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.f-size { color: var(--text-faint); font-size: 12px; flex: none; }
.summary .src { margin-left: auto; color: var(--text-faint); font-size: 11.5px; }

.struct-card { background: var(--bg3); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px; }
.struct-head { display: flex; gap: 8px; align-items: center; font-size: 13px; margin-bottom: 8px; }
.struct-result { font-size: 12.5px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.ok-line { color: var(--ok); }
.warn-line { color: var(--warn); }
.danger-line { color: var(--danger); }
.struct-result code {
  background: var(--bg0); border: 1px solid var(--line-strong);
  border-radius: 5px; padding: 1px 7px; font-size: 11.5px; color: var(--text);
  font-family: Consolas, monospace;
}
.mode-row { display: flex; gap: 10px; margin-top: 10px; }
.mode {
  flex: 1; display: flex; gap: 9px; align-items: flex-start;
  border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  padding: 9px 11px; cursor: pointer; font-size: 13px;
}
.mode:hover { border-color: var(--accent); }
.mode.on { border-color: var(--accent); background: var(--accent-soft); }
.mode input { accent-color: var(--accent); margin-top: 3px; }
.mode-sub { font-size: 11.5px; color: var(--text-faint); margin-top: 2px; }

.tip { font-size: 12.5px; color: var(--text-dim); }
.assign-card {
  display: flex; flex-direction: column; gap: 9px;
  background: var(--bg3); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 11px 12px;
}
.assign-head { display: flex; gap: 10px; align-items: center; }
.assign-head .name { max-width: 300px; font-weight: 600; }
.assign-head .src { margin-left: auto; color: var(--text-faint); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hk-row { display: flex; align-items: center; gap: 8px; }
.hk-text {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--accent-text);
  font-family: Consolas, monospace;
}

.wizard-footer { display: flex; gap: 10px; margin-top: 18px; }
</style>
