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
const DOUBAO_CHAT_URL = 'https://www.doubao.com/chat';

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
 * 选择视频生成模式（豆包 UI 中需要切换到视频模式）
 */
async function selectVideoMode(page) {
  try {
    // 尝试找到模式切换按钮（通常在输入框附近有"图片"、"视频"等选项卡）
    const modeSelectors = [
      // 视频模式按钮
      '[class*="mode"]:has-text("视频")',
      '[class*="tab"]:has-text("视频")',
      'button:has-text("视频")',
      '[role="tab"]:has-text("视频")',
      '[data-mode="video"]',
      // 也可能是一个下拉菜单
      '[class*="select"]:has-text("视频")',
      '[class*="dropdown"]:has-text("视频")',
    ];

    for (const sel of modeSelectors) {
      const btn = page.locator(sel).first();
      const visible = await btn.isVisible().catch(() => false);
      if (visible) {
        await btn.click();
        await page.waitForTimeout(500);
        // 检查是否切换成功（可能需要选择子选项）
        const activeVideo = await page.locator('[class*="active"]:has-text("视频"), [aria-selected="true"]:has-text("视频")').isVisible().catch(() => false);
        if (activeVideo) return true;
      }
    }
    
    // 如果找不到显式的视频按钮，尝试在输入框上方找到模式选择器
    const toolbarSelectors = [
      '[class*="toolbar"]',
      '[class*="mode-switch"]',
      '[class*="input-tool"]',
    ];
    
    for (const sel of toolbarSelectors) {
      const toolbar = page.locator(sel).first();
      const visible = await toolbar.isVisible().catch(() => false);
      if (visible) {
        // 在工具栏中查找视频图标/按钮
        const videoBtn = toolbar.locator('[class*="video"], [data-type="video"], svg[class*="video"]').first();
        const btnVisible = await videoBtn.isVisible().catch(() => false);
        if (btnVisible) {
          await videoBtn.click();
          await page.waitForTimeout(500);
          return true;
        }
      }
    }
  } catch (e) {
    // 模式选择失败，继续尝试直接输入（豆包可能已自动识别视频意图）
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
  const polling = opts.polling != null ? opts.polling : 20000;
  const start = Date.now();
  let iv = null;
  if (VERBOSE) {
    iv = setInterval(() => {
      const elapsed = Math.round((Date.now() - start) / 1000);
      process.stderr.write(`[doubao] 等待视频生成中… ${elapsed}s\n`);
    }, 60000);
  }

  // 简化的检测逻辑：找到缩略图或视频元素，且 loading 消失或只有进度条
  try {
    await page.waitForFunction(
      () => {
        // 检查是否有视频缩略图（生成中或已完成都会有）
        const thumbSelectors = [
          'img[src*="video"]',
          'img[src*="cover"]',
          '[class*="video"] img[src]',
          '[class*="cover"] img[src]',
          '[class*="result"] img[src]'
        ];
        
        let hasThumb = false;
        for (const sel of thumbSelectors) {
          const imgs = document.querySelectorAll(sel);
          for (const img of imgs) {
            const src = img.src || img.getAttribute('data-src') || '';
            if (src && src.startsWith('http') && !src.includes('avatar') && !src.includes('icon')) {
              hasThumb = true;
              break;
            }
          }
          if (hasThumb) break;
        }
        
        // 检查是否有视频元素
        let hasVideo = false;
        const videoEls = document.querySelectorAll('video');
        for (const v of videoEls) {
          if (v.src || v.currentSrc || v.querySelector('source[src]')) {
            hasVideo = true;
            break;
          }
        }
        
        // 检查是否有视频下载链接
        let hasDownloadLink = false;
        const linkSelectors = [
          'a[href*=".mp4"]',
          'a[href*=".webm"]',
          'a[download]',
          '[class*="video-result"] a',
          '[class*="download"] a'
        ];
        for (const sel of linkSelectors) {
          const links = document.querySelectorAll(sel);
          for (const a of links) {
            const href = a.href || a.getAttribute('data-url') || '';
            if (href && (href.includes('.mp4') || href.includes('.webm') || a.hasAttribute('download'))) {
              hasDownloadLink = true;
              break;
            }
          }
          if (hasDownloadLink) break;
        }
        
        // 只要有缩略图或视频或下载链接，就认为开始生成/生成完成
        return hasThumb || hasVideo || hasDownloadLink;
      },
      { timeout, polling }
    );

    // 等待一小段时间确保视频完全加载
    await page.waitForTimeout(2000);

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
 * 点击视频播放按钮获取视频URL
 * 豆包的视频需要点击播放才会加载到页面的 video 元素中
 */
async function hoverAndClickDownloadButton(page) {
  try {
    // 查找可点击的视频容器（包含播放按钮/图标）
    const videoSelectors = [
      '[class*="play-icon"]',
      '[class*="video-player"]',
      '[class*="block-video"]',
      '[class*="video-wrapper"]',
    ];

    let clicked = false;
    let videoUrl = null;

    // 尝试点击视频区域来加载视频
    for (const sel of videoSelectors) {
      const elements = await page.locator(sel).all();
      for (const el of elements) {
        try {
          const visible = await el.isVisible().catch(() => false);
          const box = await el.boundingBox().catch(() => null);
          if (visible && box && box.width > 50 && box.height > 50) {
            await el.click();
            await page.waitForTimeout(2000);
            clicked = true;
            break;
          }
        } catch (_) {}
      }
      if (clicked) break;
    }

    // 等待视频加载
    await page.waitForTimeout(2000);

    // 提取视频URL
    videoUrl = await page.evaluate(() => {
      // 查找 video 元素
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        const src = v.src || v.currentSrc || v.getAttribute('data-src') || '';
        if (src && src.startsWith('http') && (src.includes('.mp4') || src.includes('video'))) {
          return src;
        }
      }
      return null;
    });

    if (videoUrl) {
      return { clicked: true, videoUrl, downloadUrl: videoUrl };
    }

    return null;
  } catch (e) {
    console.error('点击播放按钮失败:', e.message);
    return null;
  }
}

/**
 * 旧版本：悬停缩略图并点击下载按钮获取视频URL（保留作为备用）
 */
async function hoverAndClickDownloadButtonOld(page) {
  // 先获取当前页面数量
  const initialPages = page.context().pages().length;

  let result = null;

  try {
    result = await page.evaluate(async (initialPageCount) => {
      // 查找视频容器/缩略图元素
      const containerSelectors = [
        '[class*="video-container"]',
        '[class*="video-item"]',
        '[class*="result-item"]',
        '[class*="video-card"]',
        '[class*="video-wrapper"]',
        '[class*="media-item"]',
        'div[class*="video"]',
      ];

      let targetContainer = null;
      for (const sel of containerSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          // 查找包含图片的容器
          const img = el.querySelector('img[src*="http"]');
          if (img && !img.src.includes('avatar') && !img.src.includes('icon')) {
            targetContainer = el;
            break;
          }
        }
        if (targetContainer) break;
      }

      // 如果没找到，尝试更宽泛的选择器
      if (!targetContainer) {
        const allDivs = document.querySelectorAll('div');
        for (const el of allDivs) {
          const img = el.querySelector('img[src*="video"], img[src*="cover"]');
          if (img) {
            targetContainer = el;
            break;
          }
        }
      }

      if (!targetContainer) return { needNewPage: true, initialPageCount };

      // 查找下载按钮（通常在悬停时出现）
      const downloadBtnSelectors = [
        '[class*="download"] button',
        '[class*="download"] svg',
        'button[class*="download"]',
        '[aria-label*="下载"]',
        '[class*="action"] button',
        '[class*="video-action"]',
        'button:has(svg[class*="download"])',
        'button:has-text("下载")',
        'button:has-text("下载视频")',
        '[class*="video"]:has-text("下载")',
        '[class*="result"]:has-text("下载")',
      ];

      let downloadBtn = null;
      for (const sel of downloadBtnSelectors) {
        const btns = targetContainer.querySelectorAll(sel);
        for (const btn of btns) {
          if (btn.offsetParent !== null || btn.getBoundingClientRect().width > 0) {
            downloadBtn = btn;
            break;
          }
        }
        if (downloadBtn) break;
      }

      // 如果按钮在容器外部不可见，尝试整个页面查找
      if (!downloadBtn) {
        for (const sel of downloadBtnSelectors) {
          const btns = document.querySelectorAll(sel);
          for (const btn of btns) {
            if (btn.offsetParent !== null && btn.getBoundingClientRect().width > 0) {
              // 检查这个按钮是否在视频相关区域附近
              const rect = btn.getBoundingClientRect();
              if (rect.top > 100) { // 排除顶部导航栏的按钮
                downloadBtn = btn;
                break;
              }
            }
          }
          if (downloadBtn) break;
        }
      }

      if (!downloadBtn) return { needNewPage: true, initialPageCount };

      // 点击下载按钮
      downloadBtn.click();

      return { clicked: true, needNewPage: false, initialPageCount };
    }, initialPages);
  } catch (e) {
    return null;
  }

  if (!result || !result.clicked) return null;

  // 等待可能打开的新标签页
  await page.waitForTimeout(2000);

  const allPages = page.context().pages();
  let newVideoUrl = null;
  let newDownloadUrl = null;

  // 检查是否有新打开的标签页
  if (allPages.length > initialPages) {
    // 遍历新打开的标签页查找视频URL
    for (let i = initialPages; i < allPages.length; i++) {
      const newPage = allPages[i];
      try {
        const pageResult = await newPage.evaluate(() => {
          // 检查页面中的视频URL
          let videoUrl = null;
          let downloadUrl = null;

          // 查找 video 元素
          const videos = document.querySelectorAll('video');
          for (const v of videos) {
            const src = v.src || v.currentSrc || v.getAttribute('data-src') || '';
            if (src && src.startsWith('http')) { videoUrl = src; break; }
          }

          // 查找下载链接
          const dlSelectors = ['a[href*=".mp4"]', 'a[download]'];
          for (const sel of dlSelectors) {
            const links = document.querySelectorAll(sel);
            for (const a of links) {
              const href = a.href || a.getAttribute('data-url') || '';
              if (href && href.startsWith('http')) { downloadUrl = href; break; }
            }
            if (downloadUrl) break;
          }

          // 也检查当前页面URL是否包含视频
          const currentUrl = window.location.href;
          if (currentUrl.includes('.mp4') || currentUrl.includes('video')) {
            downloadUrl = currentUrl;
          }

          return { videoUrl, downloadUrl, url: currentUrl };
        });

        if (pageResult.videoUrl) newVideoUrl = pageResult.videoUrl;
        if (pageResult.downloadUrl) newDownloadUrl = pageResult.downloadUrl;

        // 如果找到视频URL，关闭新标签页
        if (newVideoUrl || newDownloadUrl) {
          await newPage.close();
          break;
        }
      } catch (e) {
        // 忽略新页面错误
      }
    }
  }

  // 如果没有从新页面获取到URL，再检查当前页面
  if (!newVideoUrl && !newDownloadUrl) {
    const currentPageResult = await page.evaluate(() => {
      let videoUrl = null;
      let downloadUrl = null;

      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        const src = v.src || v.currentSrc || v.getAttribute('data-src') || '';
        if (src && src.startsWith('http')) { videoUrl = src; break; }
      }

      const dlSelectors = ['a[href*=".mp4"]', 'a[download][href*="http"]'];
      for (const sel of dlSelectors) {
        const links = document.querySelectorAll(sel);
        for (const a of links) {
          const href = a.href || a.getAttribute('data-url') || '';
          if (href && href.startsWith('http')) { downloadUrl = href; break; }
        }
        if (downloadUrl) break;
      }

      return { videoUrl, downloadUrl };
    });

    if (currentPageResult.videoUrl) newVideoUrl = currentPageResult.videoUrl;
    if (currentPageResult.downloadUrl) newDownloadUrl = currentPageResult.downloadUrl;
  }

  return {
    clicked: true,
    videoUrl: newVideoUrl,
    downloadUrl: newDownloadUrl,
  };
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

      // 1. 导航到豆包视频生成页（先尝试 create-video，失败则尝试 chat 主页）
      const currentUrl = page.url();
      let navigated = false;
      
      // 尝试 create-video 页面
      if (!currentUrl.includes('create-video')) {
        try {
          await page.goto(DOUBAO_VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(2000);
          // 检查页面是否正确加载（检查是否有输入框）
          const hasInput = await page.locator('[contenteditable="true"]').first().isVisible().catch(() => false);
          if (hasInput) {
            navigated = true;
          }
        } catch (_) {}
      }
      
      // 如果 create-video 页面没有成功加载，尝试 chat 主页
      if (!navigated && !currentUrl.includes('doubao.com/chat')) {
        await page.goto(DOUBAO_CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
      } else if (!navigated) {
        // 如果已经在 chat 页面，刷新一下
        await page.reload({ waitUntil: 'domcontentloaded' });
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

      // 3. 选择视频生成模式
      await selectVideoMode(page);
      await page.waitForTimeout(500);

      // 4. 填写 prompt 并提交
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

      const waitResult = await waitForVideoDone(page, timeout, { polling: 20000 });

      // 6. 提取视频结果
      const videoResult = await extractVideoResult(page);

      // 如果没有视频URL，尝试悬停缩略图并点击下载按钮
      if (!videoResult.videoUrl && !videoResult.downloadUrl) {
        const clickResult = await hoverAndClickDownloadButton(page);
        if (clickResult && clickResult.clicked) {
          if (clickResult.videoUrl) videoResult.videoUrl = clickResult.videoUrl;
          if (clickResult.downloadUrl) videoResult.downloadUrl = clickResult.downloadUrl;
        }
      }

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
  const timeout = parseInt(getArg('timeout') || '360000', 10);
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
      message: 'Usage: node video.js "视频描述" [--ratio=16:9] [--duration=5] [--timeout=360000] [--output-dir=路径] [--no-download]',
    }, null, 2));
    process.exit(1);
  }

  generateVideo(prompt, {
    ratio,
    duration,
    timeout,
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
