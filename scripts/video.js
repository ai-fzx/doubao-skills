/**
 * 豆包视频生成自动化脚本 v2
 * 通过 Playwright CDP 连接已登录的 Chrome，
 * 在豆包 AI 视频页面提交 prompt，等待视频生成完成，返回视频 URL。
 *
 * 使用方式：
 *   node video.js "一只熊猫在竹林中漫步，镜头缓缓推进，治愈风格"
 *   node video.js "panda in bamboo forest" --duration=5 --ratio=16:9
 */

const { chromium } = require('playwright');

const CDP_URL = process.env.DOUBAO_CDP_URL || 'http://127.0.0.1:9222';
const DOUBAO_VIDEO_URL = 'https://www.doubao.com/chat/create-video';

/**
 * 检查登录状态（通过检测登录按钮，不依赖 URL）
 */
async function checkLogin(page) {
  return page.evaluate(() => {
    // 如果页面上有"登录"按钮 class 含 login-btn，说明未登录
    const loginBtn = document.querySelector('.login-btn-head, button.login-btn, [class*="login-btn"]');
    if (loginBtn && loginBtn.offsetParent !== null) return false;
    // 如果有用户头像或昵称区域，说明已登录
    const userArea = document.querySelector('[class*="user-avatar"], [class*="avatar"], [class*="user-info"]');
    if (userArea && userArea.offsetParent !== null) return true;
    // 兜底：检查 cookie
    return document.cookie.length > 100;
  });
}

/**
 * 找到并填写输入框（豆包用 contenteditable div）
 */
async function fillInput(page, text) {
  // 豆包视频/图片输入框是 DIV[contenteditable="true"]，class 含 editor-wdKsIA
  const selectors = [
    '[contenteditable="true"][class*="editor"]',
    'div[contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea',
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const visible = await el.isVisible().catch(() => false);
      if (visible) {
        await el.click();
        await page.waitForTimeout(300);
        // 清空已有内容
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(100);
        // 输入文字（type 更兼容 contenteditable）
        await el.fill('');
        await page.keyboard.type(text, { delay: 5 });
        await page.waitForTimeout(300);
        return true;
      }
    } catch (_) { /* 继续下一个 */ }
  }
  return false;
}

/**
 * 点击发送/生成按钮
 */
async function clickSubmit(page) {
  // 先试 Enter
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);

  // 检查是否触发生成（有消息气泡或 loading）
  const triggered = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const hasGenerating = /生成中|generating|正在生成/i.test(bodyText);
    const hasLoading = document.querySelectorAll('[class*="loading"], [class*="pending"]').length > 0;
    return hasGenerating || hasLoading;
  });

  if (triggered) return true;

  // Enter 没触发，找提交按钮
  const btnSelectors = [
    // 豆包发送按钮：第一个 type=submit 的按钮（空文本，页面右下角）
    'button[type="submit"]:not([class*="参考图"]):not([class*="模型"])',
    'button[type="submit"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="send"]',
    '[class*="send-btn"]',
  ];

  for (const sel of btnSelectors) {
    try {
      const btn = page.locator(sel).first();
      const visible = await btn.isVisible().catch(() => false);
      const disabled = await btn.isDisabled().catch(() => true);
      if (visible && !disabled) {
        await btn.click();
        await page.waitForTimeout(800);
        return true;
      }
    } catch (_) { /* 继续 */ }
  }
  return false;
}

/**
 * 等待视频生成完成
 * 豆包视频生成时：提交后显示进度消息/loading；完成后出现 video 元素或下载按钮
 */
async function waitForVideoDone(page, timeout = 360000) {
  const start = Date.now();
  let stableCount = 0;
  let lastSrc = null;
  let checkCount = 0;

  while (Date.now() - start < timeout) {
    await page.waitForTimeout(3000);
    checkCount++;

    const state = await page.evaluate(() => {
      // 1. 检测是否还在生成中
      const bodyText = document.body.innerText || '';
      const isGeneratingText = /生成中|generating|正在生成|(\d+%)/i.test(bodyText.slice(-1000));

      const loadingEls = document.querySelectorAll(
        '[class*="loading"], [class*="generating"], [class*="progress"], [class*="pending"], [class*="skeleton"]'
      );
      let isGeneratingEl = false;
      for (const el of loadingEls) {
        if (el.offsetParent !== null && el.offsetWidth > 20) {
          isGeneratingEl = true;
          break;
        }
      }

      const isGenerating = isGeneratingText || isGeneratingEl;

      // 2. 检测 video 元素
      let videoSrc = null;
      const videoEls = document.querySelectorAll('video');
      for (const v of videoEls) {
        const src = v.src || v.currentSrc || v.getAttribute('data-src') || '';
        if (src && src.startsWith('http')) {
          videoSrc = src;
          break;
        }
        // 检查 source 子元素
        const source = v.querySelector('source');
        if (source && source.src && source.src.startsWith('http')) {
          videoSrc = source.src;
          break;
        }
      }

      // 3. 检测下载按钮（视频生成完会出现）
      let downloadSrc = null;
      const downloadEls = document.querySelectorAll('a[download], a[href*=".mp4"], [class*="download"] a');
      for (const el of downloadEls) {
        const href = el.href || el.getAttribute('data-url') || '';
        if (href && href.startsWith('http')) {
          downloadSrc = href;
          break;
        }
      }

      // 4. 检测 blob 或 tos 图片链接（视频封面）
      let thumbSrc = null;
      const thumbSelectors = [
        '[class*="video"] img[src*="http"]',
        '[class*="cover"] img[src*="http"]',
        '[class*="thumb"] img[src*="http"]',
        '[class*="result"] img[src*="http"]',
      ];
      for (const sel of thumbSelectors) {
        const el = document.querySelector(sel);
        if (el && el.src && el.src.startsWith('http') && !el.src.includes('avatar')) {
          thumbSrc = el.src;
          break;
        }
      }

      return { isGenerating, videoSrc, downloadSrc, thumbSrc };
    });

    // 每 10 次（30秒）输出一次心跳日志
    if (checkCount % 10 === 0) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      process.stderr.write(`等待中... 已过 ${elapsed}s，isGenerating=${state.isGenerating}\n`);
    }

    const foundSrc = state.videoSrc || state.downloadSrc;
    if (!state.isGenerating && foundSrc) {
      if (foundSrc === lastSrc) {
        stableCount++;
        if (stableCount >= 2) {
          return {
            done: true,
            reason: 'stable',
            videoSrc: state.videoSrc,
            downloadSrc: state.downloadSrc,
            thumbSrc: state.thumbSrc,
          };
        }
      } else {
        stableCount = 1;
        lastSrc = foundSrc;
      }
    } else if (!state.isGenerating && state.thumbSrc) {
      // 只有封面图，可能视频 src 在 blob 里，稳定 3 次后返回
      if (state.thumbSrc === lastSrc) {
        stableCount++;
        if (stableCount >= 3) {
          return {
            done: true,
            reason: 'thumb_only',
            videoSrc: null,
            downloadSrc: null,
            thumbSrc: state.thumbSrc,
          };
        }
      } else {
        stableCount = 1;
        lastSrc = state.thumbSrc;
      }
    } else {
      stableCount = 0;
    }
  }

  return { done: false, reason: 'timeout', videoSrc: null, downloadSrc: null, thumbSrc: null };
}

/**
 * 提取最终视频结果（更全面的提取策略）
 */
async function extractVideoResult(page) {
  return page.evaluate(() => {
    const result = { videoUrl: null, thumbnailUrl: null, downloadUrl: null };

    // 提取视频 URL
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const src = v.src || v.currentSrc || v.getAttribute('data-src') || '';
      if (src && src.startsWith('http')) { result.videoUrl = src; break; }
      const source = v.querySelector('source');
      if (source && source.src) { result.videoUrl = source.src; break; }
    }

    // 提取封面
    const thumbSelectors = [
      'video[poster]',
      '[class*="video"] img',
      '[class*="cover"] img',
      '[class*="thumb"] img',
      '[class*="result"] img',
      '[class*="preview"] img',
    ];
    for (const sel of thumbSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const src = el.poster || el.src || '';
        if (src && src.startsWith('http') && !src.includes('avatar') && !src.includes('icon')) {
          result.thumbnailUrl = src;
          break;
        }
      }
    }

    // 提取下载链接
    const dlSelectors = [
      'a[download][href*="http"]',
      'a[href*=".mp4"]',
      '[class*="download"] a[href]',
      '[aria-label*="下载"]',
    ];
    for (const sel of dlSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const href = el.href || el.getAttribute('data-url') || '';
        if (href && href.startsWith('http')) { result.downloadUrl = href; break; }
      }
    }

    return result;
  });
}

/**
 * 豆包视频生成主函数
 */
async function generateVideo(prompt, options = {}) {
  const {
    ratio = '16:9',
    duration = 5,
    timeout = 360000,
    retries = 1,
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let browser = null;
    try {
      browser = await chromium.connectOverCDP(CDP_URL);
      const ctx = browser.contexts()[0];
      const page = ctx.pages()[0];

      // 1. 导航到豆包视频生成页面
      const currentUrl = page.url();
      if (!currentUrl.includes('create-video')) {
        await page.goto(DOUBAO_VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(3000);
      }

      // 2. 检查登录状态
      const loggedIn = await checkLogin(page);
      if (!loggedIn) {
        await browser.close();
        return {
          success: false,
          error: 'NOT_LOGGED_IN',
          message: '请先在 Chrome 中登录豆包，然后重试',
        };
      }

      // 3. 填写 prompt
      const inputOk = await fillInput(page, prompt);
      if (!inputOk) {
        await browser.close();
        return {
          success: false,
          error: 'INPUT_NOT_FOUND',
          message: '未找到输入框，请确认已导航到豆包视频生成页面',
        };
      }

      // 4. 提交生成
      await clickSubmit(page);

      // 5. 等待视频生成完成
      process.stderr.write(`视频生成中，等待最多 ${Math.round(timeout / 1000)} 秒...\n`);
      const waitResult = await waitForVideoDone(page, timeout);

      // 6. 提取视频结果
      const videoResult = await extractVideoResult(page);

      // 合并等待过程中采集到的 src
      if (!videoResult.videoUrl && waitResult.videoSrc) videoResult.videoUrl = waitResult.videoSrc;
      if (!videoResult.downloadUrl && waitResult.downloadSrc) videoResult.downloadUrl = waitResult.downloadSrc;
      if (!videoResult.thumbnailUrl && waitResult.thumbSrc) videoResult.thumbnailUrl = waitResult.thumbSrc;

      await browser.close();

      return {
        success: true,
        prompt,
        options: { ratio, duration },
        videoUrl: videoResult.videoUrl,
        thumbnailUrl: videoResult.thumbnailUrl,
        downloadUrl: videoResult.downloadUrl,
        timestamp: new Date().toISOString(),
        meta: {
          generationDone: waitResult.done,
          doneReason: waitResult.reason,
          attempt: attempt + 1,
        },
      };

    } catch (e) {
      lastError = e;
      if (browser) { try { await browser.close(); } catch (_) {} }
      if (attempt < retries) {
        process.stderr.write(`Attempt ${attempt + 1} failed: ${e.message}, retrying...\n`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  return {
    success: false,
    error: 'MAX_RETRIES_EXCEEDED',
    message: lastError?.message || '未知错误',
  };
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const arg = args.find(a => a.startsWith(`--${name}=`) || a === `--${name}`);
    if (!arg) return null;
    if (arg.includes('=')) return arg.split('=')[1];
    const idx = args.indexOf(arg);
    return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-') ? args[idx + 1] : null;
  };

  const prompt = args.find(a => !a.startsWith('-')) || '';
  const ratio = getArg('ratio') || '16:9';
  const duration = parseInt(getArg('duration') || '5', 10);

  if (!prompt) {
    console.log(JSON.stringify({
      success: false,
      error: 'MISSING_PROMPT',
      message: 'Usage: node video.js "视频描述" [--ratio=16:9] [--duration=5]',
    }, null, 2));
    process.exit(1);
  }

  generateVideo(prompt, { ratio, duration }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  }).catch(e => {
    console.log(JSON.stringify({ success: false, error: 'EXCEPTION', message: e.message }, null, 2));
    process.exit(1);
  });
}

module.exports = { generateVideo };
