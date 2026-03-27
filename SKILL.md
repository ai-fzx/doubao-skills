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
  - 图片生成返回 imageUrls 数组
  - 视频生成返回 videoUrl（视频生成耗时较长，通常 1-5 分钟）
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

## 返回值格式（JSON）

### 图片生成成功

```json
{
  "success": true,
  "prompt": "一只在竹林里喝茶的熊猫，水彩风格",
  "options": { "ratio": "1:1", "count": 1 },
  "imageUrls": ["https://..."],
  "imageCount": 1,
  "timestamp": "2026-03-27T10:55:00.000Z",
  "meta": {
    "generationDone": true,
    "doneReason": "stable",
    "attempt": 1
  }
}
```

### 视频生成成功

```json
{
  "success": true,
  "prompt": "熊猫在竹林中漫步，镜头缓慢推进",
  "options": { "ratio": "16:9", "duration": 5 },
  "videoUrl": "https://...",
  "thumbnailUrl": "https://...",
  "downloadUrl": "https://...",
  "timestamp": "2026-03-27T10:55:00.000Z",
  "meta": {
    "generationDone": true,
    "doneReason": "stable",
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
```

**视频生成：**

```bash
# 基础用法（默认 16:9，5秒）
node scripts/video.js "一只熊猫在竹林中漫步，镜头缓慢推进，治愈风格"

# 指定比例和时长
node scripts/video.js "panda walking in bamboo forest" --ratio=9:16 --duration=10
```

### 参数说明

#### image.js

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | string | 必填 | 图片描述（中英文均支持） |
| `--ratio` | string | `1:1` | 图片比例：`1:1` / `16:9` / `9:16` / `4:3` / `3:4` |
| `--count` | number | `1` | 生成数量：1-4 |

#### video.js

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | string | 必填 | 视频描述（中英文均支持） |
| `--ratio` | string | `16:9` | 视频比例：`16:9` / `9:16` / `1:1` |
| `--duration` | number | `5` | 视频时长（秒） |

---

## 脚本说明

### `scripts/image.js`

豆包图片生成脚本，负责：
- 连接 Chrome CDP
- 导航到 doubao.com/chat/create-image
- 检测登录状态
- 输入 prompt 并提交
- 多策略轮询等待图片生成完成
- 提取图片 URL 列表，JSON 返回

### `scripts/video.js`

豆包视频生成脚本，负责：
- 连接 Chrome CDP
- 导航到 doubao.com/chat/create-video
- 检测登录状态
- 输入 prompt 并提交
- 轮询等待视频生成（3秒/次，最长 6 分钟）
- 提取视频 URL / 封面图 / 下载链接，JSON 返回

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
    ├── video.js          # 视频生成脚本
    └── ensure_chrome.js  # Chrome 会话管理
```

---

## 执行示例

调用图片生成时，执行以下命令：

```bash
node scripts/image.js "提示词" [--ratio=比例] [--count=数量]
```

调用视频生成时，执行以下命令：

```bash
node scripts/video.js "提示词" [--ratio=比例] [--duration=秒数]
```

解析 JSON 结果：

```javascript
const result = JSON.parse(output);
if (result.success) {
  // 图片
  console.log('图片URL:', result.imageUrls);
  // 视频
  console.log('视频URL:', result.videoUrl);
}
```
