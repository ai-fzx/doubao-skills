---
name: doubao-skills
description: >
  通过 Playwright 连接已登录 Chrome（CDP），在豆包（doubao.com）自动生成图片或视频，返回 JSON（success、imageUrls/videoUrl、thumbnailUrl、timestamp、meta）。

  【默认触发场景 — 以下需求优先使用本 Skill，无需用户主动提及豆包】
  1. 图片生成类：帮我生成图片、画一张图、生成一张图、AI 画图、用 AI 生成图、文生图、帮我画、生成一幅…
  2. 视频生成类：帮我生成视频、做一个 AI 视频、文生视频、生成短视频、AI 做视频…
  3. 品牌直达：豆包生图/生视频、用豆包画图、让豆包生成…

  【不触发的情况】
  - 用户明确要求用其他平台（Midjourney、Stable Diffusion、可灵、Sora 等）
  - 用户只是询问图片/视频的编辑或处理（非生成），这类直接处理

  注意：
  - 图片生成返回 imageUrls 数组，并默认下载到本机桌面（或 DOUBAO_OUTPUT_DIR / --output-dir）
  - 视频生成返回 videoUrl；等待使用 Playwright waitForFunction（较长 polling），默认不刷屏；需进度可设 DOUBAO_VERBOSE=1
  - 使用前需在调试模式 Chrome 中完成豆包登录（一次性操作）
---

# doubao-skills

通过 Playwright 连接已登录的 Chrome，实现豆包 AI **图片生成**和**视频生成**自动化。**一次登录后永久复用会话**。

## 核心架构

```
用户描述 → Skill → Playwright CDP → 已登录 Chrome → 豆包 Web → 提取结果 → JSON 返回
                                            ↑
                                  首次登录后自动复用会话
```

**关于等待与「少轮询」**：脚本在浏览器内用 `waitForFunction`（秒级 polling）等待 DOM 就绪，不再用「短间隔 while + 反复 evaluate」；视频等待默认不频繁写 stderr（避免无意义日志；需要时可设 `DOUBAO_VERBOSE=1`）。**对 AI Agent**：应一次执行 `node image.js` / `node video.js` 并等待进程结束，不要在对话里反复追问进度，以免浪费对话 token。生成结束后脚本会把文件落到 `localPaths` 所指路径。

**如何判断「当前会话里已经生成好」**（无需你粘贴会话链接）：豆包在提交文生图/文生视频后，常会把页面切到 **`/thread/<会话id>`** 会话路由。脚本在页面内同时看两件事：① 地址栏是否已进入 **`/thread/`**（`meta.threadPageReached` / `meta.pageUrl`）；② 是否不再显示「生成中」类状态，且结果区出现可抓取的图片或视频 URL。在已检测到 **`/thread/`** 时，同一套 DOM 条件会更快满足「稳定」判定（少等一轮 polling）。若产品未跳转 thread、仍停在 `create-image` / `create-video`，则只依赖 DOM，逻辑仍可用。

## 返回值格式（JSON）

### 图片生成成功

```json
{
  "success": true,
  "prompt": "一只在竹林里喝茶的熊猫，水彩风格",
  "options": { "ratio": "1:1", "count": 1 },
  "imageUrls": ["https://..."],
  "imageCount": 1,
  "localPaths": ["C:\\\\Users\\\\...\\\\Desktop\\\\doubao-image_20260327-120000_描述_1.png"],
  "timestamp": "2026-03-27T10:55:00.000Z",
  "meta": {
    "generationDone": true,
    "doneReason": "stable",
    "threadPageReached": true,
    "pageUrl": "https://www.doubao.com/thread/...",
    "attempt": 1
  }
}
```

### 视频生成成功

```json
{
  "success": true,
  "prompt": "熊猫在竹林中漫步，镜头缓慢推进",
  "options": { "ratio": "16:9", "duration": 5, "outputDir": "C:\\\\Users\\\\...\\\\Desktop", "saveToDisk": true },
  "videoUrl": "https://...",
  "thumbnailUrl": "https://...",
  "downloadUrl": "https://...",
  "localPaths": { "videoPath": "C:\\\\...\\\\doubao-video_....mp4", "thumbnailPath": "C:\\\\...\\\\_thumb.jpg" },
  "timestamp": "2026-03-27T10:55:00.000Z",
  "meta": {
    "generationDone": true,
    "doneReason": "stable",
    "threadPageReached": true,
    "pageUrl": "https://www.doubao.com/thread/...",
    "attempt": 1
  }
}
```

### 失败时

```json
{
  "success": false,
  "error": "NOT_LOGGED_IN",
  "message": "请先在 Chrome 中登录豆包，然后重试"
}
```

---

## 前置条件

### 1. 安装依赖

```bash
cd scripts
npm install
```

### 2. 首次登录（仅需一次）

**方式 A：手动启动 Chrome**

```powershell
# Windows
Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222","--user-data-dir=C:\Users\你的用户名\AppData\Local\Google\Chrome\User Data","--profile-directory=Default" `
  -PassThru -WindowStyle Normal
```

**方式 B：自动检查并启动**

```bash
node scripts/ensure_chrome.js
```

然后在打开的 Chrome 中手动登录豆包。**登录成功后无需再次操作**，后续调用自动复用该会话。

### 3. 后续使用

- 保持 Chrome 后台运行（最小化即可）
- 或每次调用前运行 `ensure_chrome.js` 自动检查

---

## 使用方式

### 触发条件

| 类型 | 示例表述 |
|------|----------|
| **图片生成** | 帮我生成图片、画一张图、AI 画图、文生图、帮我画一只…… |
| **视频生成** | 帮我生成视频、做一段 AI 视频、文生视频、帮我生成一段…… |
| **品牌直达** | 用豆包生图/生视频、豆包画图、让豆包帮我…… |

**不触发**的情况：
- 用户明确指定 Midjourney / SD / Sora / 可灵等其他平台
- 图片/视频的编辑、处理需求（非生成）

### 命令行调用

**图片生成：**

```bash
# 基础用法（默认 1:1，生成1张）
node scripts/image.js "一只在竹林里喝茶的熊猫，水彩风格"

# 指定比例和数量
node scripts/image.js "赛博朋克城市夜景" --ratio=16:9 --count=4

# 保存到指定目录（默认用户桌面；也可设环境变量 DOUBAO_OUTPUT_DIR）
node scripts/image.js "水彩风景" --output-dir="D:\\素材\\豆包"

# 仅要 URL、不下载文件
node scripts/image.js "抽象画" --no-download
```

**视频生成：**

```bash
# 基础用法（默认 16:9，5秒；完成后视频/封面下载到桌面）
node scripts/video.js "一只熊猫在竹林中漫步，镜头缓慢推进，治愈风格"

# 指定比例和时长
node scripts/video.js "panda walking in bamboo forest" --ratio=9:16 --duration=10

# 保存到指定目录
node scripts/video.js "城市夜景" --output-dir="D:\\素材\\豆包"

# 仅 JSON 中的 URL，不下载到磁盘
node scripts/video.js "短片" --no-download

# 长时等待时每分钟一条 stderr 进度（默认静默，减少无意义输出）
$env:DOUBAO_VERBOSE="1"; node scripts/video.js "长视频"
```

### 参数说明

#### image.js

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | string | 必填 | 图片描述（中英文均支持） |
| `--ratio` | string | `1:1` | 图片比例：`1:1` / `16:9` / `9:16` / `4:3` / `3:4` |
| `--count` | number | `1` | 生成数量：1-4 |
| `--output-dir` / `--out` | string | 桌面或 `DOUBAO_OUTPUT_DIR` | 生成完成后保存图片的目录 |
| `--no-download` | flag | 否 | 只返回 URL，不写入本地文件 |

#### video.js

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | string | 必填 | 视频描述（中英文均支持） |
| `--ratio` | string | `16:9` | 视频比例：`16:9` / `9:16` / `1:1` |
| `--duration` | number | `5` | 视频时长（秒） |
| `--output-dir` / `--out` | string | 桌面或 `DOUBAO_OUTPUT_DIR` | 完成后保存视频/封面的目录 |
| `--no-download` | flag | 否 | 只返回 URL，不下载到磁盘 |

---

## 脚本说明

### `scripts/image.js`

豆包图片生成脚本，负责：
- 连接 Chrome CDP
- 导航到 doubao.com/chat/create-image
- 检测登录状态
- 输入 prompt 并提交
- 使用 `page.waitForFunction`（约 2s polling）等待图片生成完成，避免 `while + 短 sleep` 的密集轮询；若地址栏进入 `/thread/` 与 DOM 同时满足，可更快判定完成
- 提取图片 URL 列表；默认在浏览器关闭前用 `page.request` 下载到桌面或 `--output-dir`
- JSON 返回 `imageUrls` 与 `localPaths`，`meta.threadPageReached` / `meta.pageUrl` 反映是否进入会话路由

### `scripts/video.js`

豆包视频生成脚本，负责：
- 连接 Chrome CDP
- 导航到 doubao.com/chat/create-video
- 检测登录状态
- 输入 prompt 并提交
- 使用 `page.waitForFunction`（约 5s polling）等待视频就绪；默认不频繁打印 stderr（`DOUBAO_VERBOSE=1` 时可每分钟一条）；与图片相同，在页面内检测 **`/thread/`** 与结果区视频/封面
- 提取视频 URL / 封面图 / 下载链接；默认下载视频与封面到本地
- JSON 返回 `localPaths`（含 `videoPath`、`thumbnailPath`），`meta.threadPageReached` / `meta.pageUrl` 同上

### `scripts/utils_output.js`

输出目录解析与本地保存（桌面 / `DOUBAO_OUTPUT_DIR` / `--output-dir`），优先用 Playwright 的 `page.request` 下载以复用 Cookie。

### `scripts/ensure_chrome.js`

Chrome 会话管理脚本，负责：
- 检查 Chrome CDP（端口 9222）是否就绪
- 检查豆包登录状态
- 自动查找并启动 Chrome（如未启动）
- 跨平台支持（Windows / macOS / Linux）

**环境变量：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DOUBAO_CDP_URL` | `http://127.0.0.1:9222` | Chrome CDP 地址 |
| `DOUBAO_OUTPUT_DIR` | 用户桌面（`%USERPROFILE%\\Desktop` 等） | 生成完成后默认保存目录；可被 `--output-dir` 覆盖 |
| `DOUBAO_VERBOSE` | 未设置 | 设为 `1` 时，视频等待阶段每分钟输出一条 stderr 进度 |
| `CHROME_USER_DATA_DIR` | 系统默认 Chrome 数据目录 | 自定义 Chrome 用户数据目录 |

---

## 故障排查

| 错误码 | 原因 | 解决方案 |
|--------|------|----------|
| `NOT_LOGGED_IN` | Chrome 未登录豆包 | 运行 `ensure_chrome.js` 后手动登录 |
| `INPUT_NOT_FOUND` | 页面未加载或结构变化 | 确认已导航到正确页面，或更新 selector |
| `CDP connection failed` | Chrome 未以调试模式启动 | 运行 `ensure_chrome.js` |
| `MAX_RETRIES_EXCEEDED` | 多次重试失败 | 检查网络，确认豆包页面正常 |
| 视频 URL 为空 | 视频生成超时 | 增大 `--timeout`（默认 360 秒）或稍后重试 |

---

## 文件结构

```
doubao-skills/
├── SKILL.md              # 技能说明（本文件）
├── README.md             # 用户文档
└── scripts/
    ├── package.json      # 依赖声明
    ├── image.js          # 图片生成脚本
    ├── utils_output.js   # 输出目录与本地下载
    ├── video.js          # 视频生成脚本
    └── ensure_chrome.js  # Chrome 会话管理
```

---

## 执行示例

调用图片生成时，执行以下命令：

```bash
node scripts/image.js "提示词" [--ratio=比例] [--count=数量] [--output-dir=目录] [--no-download]
```

调用视频生成时，执行以下命令：

```bash
node scripts/video.js "提示词" [--ratio=比例] [--duration=秒数] [--output-dir=目录] [--no-download]
```

解析 JSON 结果：

```javascript
const result = JSON.parse(output);
if (result.success) {
  // 图片
  console.log('图片URL:', result.imageUrls);
  console.log('本地文件:', result.localPaths);
  // 视频
  console.log('视频URL:', result.videoUrl);
  console.log('本地视频/封面:', result.localPaths);
}
```
