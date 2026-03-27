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
const { resolveOutputDir, downloadVideoAssets } = require('./utils_output');

const CDP_URL = process.env.DOUBAO_CDP_URL || 'http://127.0.0.1:9222';
const VERBOSE = process.env.DOUBAO_VERBOSE === '1' || process.env.DOUBAO_VERBOSE === 'true';
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
 * 等待视频生成完成（waitForFunction + 较大 polling，避免 while 密集轮询与频繁日志）
 */
async function waitForVideoDone(page, timeout = 360000, opts = {}) {
  const polling = opts.polling != null ? opts.polling : 5000;
  const start = Date.now();
  let iv = null;
  if (VERBOSE) {
    iv = setInterval(() => {
      const elapsed = Math.round((Date.now() - start) / 1000);
      process.stderr.write(`[doubao] 等待视频生成中… ${elapsed}s\n`);
    }, 60000);
  }

  try {
    await page.evaluate(() => {
      window.__doubaoVidWait = { last: null, stable: 0, mode: null };
    });

    await page.waitForFunction(
      () => {
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

        let videoSrc = null;
        const videoEls = document.querySelectorAll('video');
        for (const v of videoEls) {
          const src = v.src || v.currentSrc || v.getAttribute('data-src') || '';
          if (src && src.startsWith('http')) {
            videoSrc = src;
            break;
          }
          const source = v.querySelector('source');
          if (source && source.src && source.src.startsWith('http')) {
            videoSrc = source.src;
            break;
          }
        }

        let downloadSrc = null;
        const downloadEls = document.querySelectorAll('a[download], a[href*=".mp4"], [class*="download"] a');
        for (const el of downloadEls) {
          const href = el.href || el.getAttribute('data-url') || '';
          if (href && href.startsWith('http')) {
            downloadSrc = href;
            break;
          }
        }

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

        const w = window.__doubaoVidWait;
        const foundSrc = videoSrc || downloadSrc;
        const key = foundSrc || thumbSrc || '';
        // 提交后豆包常把当前会话切到 /thread/<id>；在会话页且不再「生成中」时，结果区更可信，可少等一轮 stable
        const onThread =
          (window.location.pathname || '').includes('/thread/') ||
          (window.location.href || '').indexOf('/thread/') !== -1;

        if (isGenerating) {
          w.last = null;
          w.stable = 0;
          w.mode = null;
          return false;
        }

        if (foundSrc) {
          w.mode = 'video';
          if (key === w.last) w.stable++;
          else {
            w.last = key;
            w.stable = 1;
          }
          const need = onThread ? 1 : 2;
          return w.stable >= need;
        }

        if (thumbSrc) {
          w.mode = 'thumb_only';
          const keyT = thumbSrc;
          if (keyT === w.last) w.stable++;
          else {
            w.last = keyT;
            w.stable = 1;
          }
          const need = onThread ? 2 : 3;
          return w.stable >= need;
        }

        return false;
      },
      { timeout, polling }
    );

    const state = await page.evaluate(() => {
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

      let videoSrc = null;
      for (const v of document.querySelectorAll('video')) {
        const src = v.src || v.currentSrc || v.getAttribute('data-src') || '';
        if (src && src.startsWith('http')) {
          videoSrc = src;
          break;
        }
        const source = v.querySelector('source');
        if (source && source.src && source.src.startsWith('http')) {
          videoSrc = source.src;
          break;
        }
      }

      let downloadSrc = null;
      for (const el of document.querySelectorAll('a[download], a[href*=".mp4"], [class*="download"] a')) {
        const href = el.href || el.getAttribute('data-url') || '';
        if (href && href.startsWith('http')) {
          downloadSrc = href;
          break;
        }
      }

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

      const mode = window.__doubaoVidWait && window.__doubaoVidWait.mode;
      return { isGenerating, videoSrc, downloadSrc, thumbSrc, mode };
    });

    const mode = state.mode;
    const onThreadPage = await page.evaluate(() => {
      const p = window.location.pathname || '';
      return p.includes('/thread/') || (window.location.href || '').includes('/thread/');
    });
    if (mode === 'thumb_only') {
      return {
        done: true,
        reason: 'thumb_only',
        videoSrc: null,
        downloadSrc: null,
        thumbSrc: state.thumbSrc,
        onThreadPage,
      };
    }
    return {
      done: true,
      reason: 'stable',
      videoSrc: state.videoSrc,
      downloadSrc: state.downloadSrc,
      thumbSrc: state.thumbSrc,
      onThreadPage,
    };
  } catch (_) {
    return {
      done: false,
      reason: 'timeout',
      videoSrc: null,
      downloadSrc: null,
      thumbSrc: null,
      onThreadPage: false,
    };
  } finally {
    if (iv) clearInterval(iv);
  }
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
    outputDir: outputDirOpt = null,
    saveToDisk = true,
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let browser = null;
    try {
      browser = await chromium.connectOverCDP(CDP_URL);
      const ctx = browser.contexts()[0];
      const page = ctx.pages()[0];

      // 1. 导航到豆包视频生成页
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

      // 3–4. 填写 prompt 并提交
      const inputOk = await fillInput(page, prompt);
      if (!inputOk) {
        await browser.close();
        return {
          success: false,
          error: 'INPUT_NOT_FOUND',
          message: '未找到输入框，请确认已导航到豆包视频生成页面',
        };
      }
      await clickSubmit(page);
      process.stderr.write(`视频生成中，最多等待 ${Math.round(timeout / 1000)} 秒（完成后自动保存到本地）…\n`);

      const waitResult = await waitForVideoDone(page, timeout, { polling: 5000 });

      // 6. 提取视频结果
      const videoResult = await extractVideoResult(page);

      // 合并等待过程中采集到的 src
      if (!videoResult.videoUrl && waitResult.videoSrc) videoResult.videoUrl = waitResult.videoSrc;
      if (!videoResult.downloadUrl && waitResult.downloadSrc) videoResult.downloadUrl = waitResult.downloadSrc;
      if (!videoResult.thumbnailUrl && waitResult.thumbSrc) videoResult.thumbnailUrl = waitResult.thumbSrc;

      const outDir = resolveOutputDir(outputDirOpt);
      let localPaths = {};
      if (saveToDisk && (videoResult.videoUrl || videoResult.downloadUrl || videoResult.thumbnailUrl)) {
        try {
          localPaths = await downloadVideoAssets(page, {
            videoUrl: videoResult.videoUrl,
            thumbnailUrl: videoResult.thumbnailUrl,
            downloadUrl: videoResult.downloadUrl,
            outputDir: outDir,
            prompt,
          });
        } catch (e) {
          process.stderr.write(`下载到本地失败: ${e.message}\n`);
        }
      }

      await browser.close();

      return {
        success: true,
        prompt,
        options: { ratio, duration, outputDir: outDir, saveToDisk },
        videoUrl: videoResult.videoUrl,
        thumbnailUrl: videoResult.thumbnailUrl,
        downloadUrl: videoResult.downloadUrl,
        localPaths,
        timestamp: new Date().toISOString(),
        meta: {
          generationDone: waitResult.done,
          doneReason: waitResult.reason,
          /** 提交后若地址栏进入 /thread/<id>，说明已落在会话页，与 DOM 一起用于判定「已出结果」 */
          threadPageReached: !!waitResult.onThreadPage,
          pageUrl: page.url(),
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
  const outArg = args.find(a => a.startsWith('--output-dir=') || a.startsWith('--out='));
  const noDownload = args.includes('--no-download');
  let outputDirCli = null;
  if (outArg) {
    outputDirCli = outArg.includes('=') ? outArg.split('=').slice(1).join('=') : (args[args.indexOf(outArg) + 1] || null);
  }

  if (!prompt) {
    console.log(JSON.stringify({
      success: false,
      error: 'MISSING_PROMPT',
      message: 'Usage: node video.js "视频描述" [--ratio=16:9] [--duration=5] [--output-dir=路径] [--no-download]',
    }, null, 2));
    process.exit(1);
  }

  generateVideo(prompt, {
    ratio,
    duration,
    outputDir: outputDirCli,
    saveToDisk: !noDownload,
  }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  }).catch(e => {
    console.log(JSON.stringify({ success: false, error: 'EXCEPTION', message: e.message }, null, 2));
    process.exit(1);
  });
}

module.exports = { generateVideo };
