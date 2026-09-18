# 详细文档

用法速览请看 [README](../README.md)。本页收录功能细节、设计决策、目录结构、测试、第三方许可与免责声明。

## 功能清单

- **导入**：zip / 7z / rar 解压入库（整包一个 mod，多 mod 包自动识别拆分），预览图自动提取，重名自动加后缀
- **组织**：角色 / 皮肤两级分类（每个角色默认带「原皮」），卡片网格 + 搜索 + 多选批量操作
- **启用调度**：启用 = 在加载器 Mods 根目录创建 junction（`fs.symlink(..., 'junction')`，免管理员），停用即移除；启动时自动清理孤儿联接、补建断链
- **预设**：一键替换当前启用集（差量建 / 删联接）；同角色同皮肤多个 mod 同时启用时提示可能冲突
- **快捷键**：按键记录（按下组合键 → 输入描述 → 保存，两栏列表展示）、逐条手动编辑、AI 识别（OpenAI 兼容接口，文本 / 截图；英文描述自动翻译）
- **AI + ini 识别**：本地正则解析 mod 内全部 `.ini` 的快捷键定义 → 拼音 / 英文词典命中直接得中文描述 → 未命中的批量交 AI 标注；用户自建敏感词库在本地做行级拦截，命中内容绝不发送
- **mod 信息编辑弹窗**：名称 / 归属（角色 + 皮肤）/ 预览图（选择、粘贴、移除）/ 快捷键 / 备注，一处集中修改
- **数据安全**：元数据存本机 SQLite，mod 真身原地不动；附带备份脚本

## AI 快捷键识别

详情面板提供「✨ AI 识别」，两种方式**可复选**：

- **ini 文件识别**（已入库 mod）：本地正则解析 mod 文件夹内全部 `.ini` 的快捷键定义（3DMigoto/XXMI 语法）→ **词典命中（拼音/英文部位词）直接得中文描述，零成本零延迟**；词典未命中的自动批量交 AI 标注（只发分节名/键位/注释的精简条目，不发整个 ini）；未配置 API 则标「待手动」。菜单/鼠标键自动识别并默认隐藏（可切换显示）
- **提供文本/截图**：粘贴说明文本 / 剪贴板截图 / 本地图片 → OpenAI 兼容 chat/completions 识别（需视觉模型），英文描述自动翻译
- **敏感词拦截贯穿**：待 AI 标注的 ini 条目与用户输入行先过本地敏感词库（用户自建，每行一词），命中条目**绝不发送**，标黄待手动；识别结果再过一遍词库打标
- **结果可编辑**：来源标签（词典 / AI / 文本 / 手动 / 待手动）、逐行改删、替换/追加现有快捷键，保存格式 `键（描述） · 键（描述）`；导入向导同样可入口（文本/截图方式，识别结果随导入落库）
- **提示词设置化**：两条内置提示词（文本/截图识别、ini 标注）在设置页管理——默认只读展示，点「编辑」才能修改，「保存」写库，「重置为默认」回退内置

## 界面导览

| 区域 | 内容 |
|---|---|
| 左侧导航 | 全部 mod / 未分类、角色列表（折叠展开皮肤子级、计数、新增角色 / 皮肤）、预设区（应用 ▶ / 重命名 ✎ / 删除 ✕ / 用选中项新建）、底部设置（固定可见） |
| 中间 | 工具栏（位置标题、搜索、多选、导入）+ 配置提醒条 + 卡片网格（真实预览图、名称、角色 / 皮肤徽标、启用开关、丢失角标、多选勾选框、悬停 ✎ 编辑）；多选时切换为批量栏 |
| 右侧详情 | 大图、名称、角色 / 皮肤编辑（必选 / 可选 + 内联新建）、状态、粘贴预览图、快捷键（两栏列表 + 记录 / 编辑 / AI 识别 / 清除）、启用 / 打开所在目录 / 删除、来源 / 体积 / 哈希等元数据 |
| 弹窗 | 导入向导（选包 → 识别结构 → 归属分类 → 确认导入）、mod 信息编辑、AI 识别、设置（目录 / AI / 提示词 / 敏感词）、预设保存与应用 |

## 测试脚本

```bash
node smoke-import.cjs        # 导入管线 + 联接调度 + 分类管理（46 项断言）
node smoke-original-skin.cjs # 原皮皮肤分类迁移 / 幂等 / 自愈（15 项）
node smoke-ai.cjs            # AI 识别纯函数：敏感词拦截 / 键位提取 / 响应解析（28 项）
node ai-live-test.cjs        # 真实 API 联调（读环境变量 STEP_API_KEY，不打印不落盘）
node backup-data.cjs         # 备份应用数据（catalog.db + previews/）到 backups/，保留最近 10 份
```

> 国内网络下构建需要镜像：
>
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist
> ```

## 数据与安全设计

- **代码**：git 仓库（`node_modules` / `dist` / `release*` / `backups` / `.zcode` 已忽略）
- **数据**：mod 元数据在 `%APPDATA%/local-mod-manager/`（catalog.db + previews/），**不在仓库里**——定期运行 `node backup-data.cjs` 生成快照到 `backups/`（自动保留最近 10 份）
- **mod 真身**：体积大且不可再生，位于你自己配置的仓库目录，请另行做文件级备份
- **API Key**：AI 功能所需的 Key 由用户自行填写，明文保存在本机 SQLite（`settings` 表），不会上传到任何地方；仓库内不含任何密钥

## 设计决策

- 技术栈：Electron + Vue 3 + Vite + `node:sqlite`；解压用 7-Zip（7z.exe）；目录联接用 junction（免管理员权限）
- 加载器 Mods 目录为**平铺**结构：联接建在 Mods 根、联接名 = mod 文件夹名；**启用状态 = Mods 根下存在同名联接**
- 导入默认**整包一个 mod**；检测到多个 mod 文件夹时提示用户选拆分 / 整体；**角色导入时必选**（皮肤可选，内置名单种子 + 自定义新增）
- 每个角色固定带一个「原皮」皮肤分类（排序置顶、不可删除）；未归皮肤的 mod 启动时自动归入原皮
- **预设应用 = 替换当前启用集**（差量：删多余联接 + 补缺失联接）；初始仅一个空的「默认预设」
- 快捷键仅记录，不做全局监听、不触发执行
- 配色：净白底 + 偏白淡粉

## 里程碑

- ✅ Phase 1 UI 原型（布局 / 流程确认，配色定稿）
- ✅ Phase 2 Electron 外壳 + SQLite 数据层 + 设置页真实目录选择
- ✅ Phase 3 导入管线（7z 解压 / 结构识别 / 入库编目 / 预览图 / 预设持久化）
- ✅ Phase 4 启用调度：junction 建 / 删、启动一致性校验（孤儿联接清理、断链自愈、手动目录共存）
- ✅ Phase 5 打磨打包：NSIS 中文安装包、7-Zip 捆绑、异常兜底、开发/打包版数据目录统一
- ✅ AI 快捷键识别（OpenAI 兼容接口，文本 + 截图）+ 用户自建敏感词库的本地行级拦截
- ✅ ini 文件快捷键识别：本地正则解析 + 拼音/英文词典映射 + AI 兜底标注，提示词设置化管理
- ✅ 原皮皮肤分类 + mod 信息编辑弹窗 + 快捷键两栏列表 / 逐条编辑

## 目录结构

```
electron/
├── main.cjs           # 主进程：窗口 / IPC 注册 / preview 协议 / 剪贴板 / shell 操作
├── db.cjs             # node:sqlite 数据层：建库 / 种子 / 设置 / 角色皮肤 / mods / 预设
├── importer.cjs       # 导入管线：7z 探测 / 结构识别 / 解压 / 归档 / 预览图提取
├── junctions.cjs      # 目录联接：建/删（幂等+冲突检测）/ 启动一致性同步
├── categorize.cjs     # 分类重组织：角色/皮肤重命名与删除（磁盘+库+联接同步）
├── iniHotkeys.cjs     # ini 快捷键本地解析：键位归一 / 拼音英文词典 / 菜单键过滤
├── prompts.js         # 内置 AI 提示词（ESM 单一来源，主进程与渲染层共用）
├── ai.cjs             # AI 快捷键识别：OpenAI 兼容调用 / 响应解析 / 图片压缩 / ini 标注
└── preload.cjs        # contextBridge 暴露 window.zmm
src/
├── App.vue                  # 三栏布局 + 全局拖拽 + 模态调度
├── store.js                 # 全局状态：Electron 走 IPC，浏览器退回 mock
├── lib/hotkeyText.js        # 纯函数：敏感词行拦截 / 键位本地提取 / 格式化解析
├── data/mock.js             # 浏览器预览用演示数据（全部虚构）
├── utils/cover.js           # 占位封面 SVG（无预览图时兜底）
├── styles/global.css        # 设计令牌（净白 + 淡粉）
└── components/              # SideNav / Toolbar / CardGrid / ModCard / DetailPanel
    │                          CategoryPicker / ImportWizard / SettingsModal / HotkeyAIDialog
    │                          EditModDialog / HotkeyList / PresetSaveDialog / PresetApplyDialog
    │                          ModalShell / DragOverlay / ToastHost
smoke-import.cjs             # 冒烟测试（导入管线 + 联接调度 + 分类管理，46 项）
smoke-original-skin.cjs      # 原皮皮肤分类迁移测试（15 项）
smoke-ai.cjs                 # AI 识别纯函数单测（28 项，不依赖网络）
vendor/7zip/                 # 捆绑的 7-Zip 组件 + 许可文本（打包时经 extraResources 注入）
docs/screenshots/            # README 截图（虚构演示数据）
LICENSE                      # PolyForm Noncommercial License 1.0.0
release/                     # 打包产物（git 忽略）：NSIS 安装包 + win-unpacked 免安装目录
dist/                        # vite build 产物（git 忽略，打包后由主进程加载）
```

## 第三方组件与许可

| 组件 | 许可 | 说明 |
|---|---|---|
| [7-Zip](https://www.7-zip.org/)（`vendor/7zip/7z.exe`、`7z.dll`） | 7-Zip License（LGPL + unRAR 限制） | 允许再分发，许可文本已随附（`vendor/7zip/License.txt`）。unRAR 限制仅禁止用其重建 RAR 压缩算法，本项目只用于**解压** |
| Electron / Vue 3 / Vite / electron-builder | MIT | 均为 npm 依赖，未修改源码 |
| 本项目自身 | PolyForm Noncommercial License 1.0.0（见 [LICENSE](../LICENSE)） | 允许个人非商业使用、修改与分发；**禁止任何商业用途** |

## 免责声明

1. 本项目仅供**个人学习、研究与本地文件管理**使用。请自行遵守当地法律法规；因使用本工具产生的一切后果由使用者自行承担。
2. 仓库内**不包含**任何游戏资源、美术素材、mod 文件或成人内容；演示数据（`src/data/mock.js`）与截图均为虚构。
3. 本工具只在本机整理用户自己的 mod 文件并创建目录联接，不修改游戏客户端、不注入进程、不绕过任何保护机制。
4. 软件按「现状」提供，不附带任何明示或暗示的担保。
5. 本项目采用**禁止商业使用**的许可（PolyForm Noncommercial 1.0.0）：任何商业用途（含售卖、付费分发、以本软件为卖点的服务）均不被授权。
