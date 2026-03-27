/**
 * 豆包 Chrome 会话管理脚本
 * 检查 Chrome CDP 是否就绪、豆包登录状态，必要时自动启动 Chrome
 *
 * 使用方式：
 *   node ensure_chrome.js
 */

const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CDP_URL = process.env.DOUBAO_CDP_URL || 'http://127.0.0.1:9222';
const DOUBAO_URL = 'https://www.doubao.com/chat/';

// Windows Chrome 常见路径
const CHROME_PATHS_WIN = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe')
    : null,
  process.env.PROGRAMFILES
    ? path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe')
    : null,
].filter(Boolean);

// macOS Chrome 路径
const CHROME_PATHS_MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

/**
 * 检查 Chrome CDP 是否就绪
 */
async function isCDPReady(url = CDP_URL) {
  try {
    const browser = await chromium.connectOverCDP(url);
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查豆包登录状态
 */
async function checkDoubaoLogin() {
  let browser = null;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0];

    await page.goto(DOUBAO_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    const isLoggedIn = !currentUrl.includes('login')
      && !currentUrl.includes('sign_in')
      && !currentUrl.includes('passport');

    await browser.close();
    return isLoggedIn;
  } catch (e) {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    return false;
  }
}

/**
 * 查找 Chrome 可执行文件路径
 */
function findChromePath() {
  const platform = process.platform;

  if (platform === 'win32') {
    for (const p of CHROME_PATHS_WIN) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    for (const p of CHROME_PATHS_MAC) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    // Linux
    try {
      const result = execSync('which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null').toString().trim();
      if (result) return result;
    } catch (_) {}
  }

  return null;
}

/**
 * 自动启动 Chrome（调试模式）
 */
function launchChrome() {
  const chromePath = findChromePath();
  if (!chromePath) {
    console.error('❌ 未找到 Chrome，请手动启动');
    return false;
  }

  const userDataDir = process.env.CHROME_USER_DATA_DIR
    || (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\User Data')
      : path.join(process.env.HOME || '', '.config/google-chrome'));

  const args = [
    '--remote-debugging-port=9222',
    `--user-data-dir=${userDataDir}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    DOUBAO_URL,
  ];

  console.log('🚀 正在启动 Chrome...');
  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return true;
}

/**
 * 主检查流程
 */
async function ensureChrome() {
  console.log('🔍 检查 Chrome CDP 连接...');

  const cdpReady = await isCDPReady();

  if (!cdpReady) {
    console.log('⚠️  Chrome 未以调试模式运行，尝试自动启动...');
    const launched = launchChrome();

    if (!launched) {
      console.log('\n📋 请手动运行以下命令启动 Chrome：\n');
      if (process.platform === 'win32') {
        console.log(
          `Start-Process -FilePath "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ` +
          `-ArgumentList "--remote-debugging-port=9222","--user-data-dir=C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Google\\Chrome\\User Data","--profile-directory=Default" ` +
          `-PassThru -WindowStyle Normal`
        );
      } else {
        console.log(
          `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
  --remote-debugging-port=9222 \\
  --user-data-dir="$HOME/.config/google-chrome-doubao" \\
  --profile-directory=Default &`
        );
      }
      process.exit(1);
    }

    // 等待 Chrome 启动
    console.log('⏳ 等待 Chrome 启动（10秒）...');
    await new Promise(r => setTimeout(r, 10000));

    const ready2 = await isCDPReady();
    if (!ready2) {
      console.log('❌ Chrome 启动超时，请手动检查');
      process.exit(1);
    }
  }

  console.log('✅ Chrome CDP 已就绪');

  // 检查豆包登录状态
  console.log('🔍 检查豆包登录状态...');
  const loggedIn = await checkDoubaoLogin();

  if (!loggedIn) {
    console.log('⚠️  豆包未登录！');
    console.log('📖 请在打开的 Chrome 中手动登录豆包（https://www.doubao.com），登录成功后无需重复操作。');
    process.exit(1);
  }

  console.log('✅ 豆包已登录，一切就绪！');
  console.log('');
  console.log('🎨 图片生成：node image.js "图片描述" [--ratio=1:1] [--count=1]');
  console.log('🎬 视频生成：node video.js "视频描述" [--ratio=16:9] [--duration=5]');
}

ensureChrome().catch(e => {
  console.error('异常:', e.message);
  process.exit(1);
});
