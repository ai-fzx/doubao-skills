/**
 * 豆包图片生成自动化脚本
 * 通过 Playwright CDP 连接已登录的 Chrome，
 * 在豆包 AI 图像页面提交 prompt，等待图片生成完成，返回图片 URL 列表。
 *
 * 使用方式：
 *   node image.js "一只在竹林里喝茶的熊猫，水彩风格"
 *   node image.js "a panda in bamboo forest" --ratio 1:1 --count 4
 */

const { chromium } = require('playwright');
const path = require('path');

const CDP_URL = process.env.DOUBAO_CDP_URL || 'http://127.0.0.1:9222';
const DOUBAO_IMAGE_URL = 'https://www.doubao.com/chat/create-image';

/**
 * 等待图片生成完成
 * 判断依据：生成中的 loading 动画消失 + 图片元素出现并稳定
 */
async function waitForImageDone(page, timeout = 180000) {
  const start = Date.now();
  let lastCount = 0;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    await page.waitForTimeout(1500);

    // 检测是否还在生成中（loading 状态）
    const isGenerating = await page.evaluate(() => {
      // 豆包图片生成时通常有进度条或 loading 指示器
      const loadingSelectors = [
        '[class*="loading"]',
        '[class*="generating"]',
        '[class*="progress"]',
        '.skeleton',
        '[class*="skeleton"]',
      ];
      for (const sel of loadingSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.offsetParent !== null && el.offsetWidth > 0) return true;
        }
      }
      // 检查是否有 SVG 动画（loading spinner）
      const spinners = document.querySelectorAll('svg[class*="spin"], [class*="spin"] svg, [class*="rotate"]');
      for (const s of spinners) {
        if (s.offsetParent !== null) return true;
      }
      return false;
    });

    // 统计当前已生成的图片数量
    const imgCount = await page.evaluate(() => {
      // 豆包生成的图片通常在结果区域，img 标签带特定属性
      const imgSelectors = [
        '[class*="image-result"] img',
        '[class*="result-image"] img',
        '[class*="generated"] img',
        '.image-item img',
        '[class*="img-wrapper"] img',
        // 兜底：找所有大尺寸图片（排除头像/图标）
      ];
      let maxCount = 0;
      for (const sel of imgSelectors) {
        const imgs = document.querySelectorAll(sel);
        const valid = Array.from(imgs).filter(img => {
          const src = img.src || img.getAttribute('data-src') || '';
          return src && !src.includes('avatar') && !src.includes('icon') && !src.includes('logo');
        });
        if (valid.length > maxCount) maxCount = valid.length;
      }
      return maxCount;
    });

    if (!isGenerating && imgCount > 0) {
      if (imgCount === lastCount) {
        stableCount++;
        if (stableCount >= 2) {
          return { done: true, reason: 'stable', imgCount };
        }
      } else {
        stableCount = 0;
        lastCount = imgCount;
      }
    } else {
      stableCount = 0;
      lastCount = imgCount;
    }
  }

  return { done: false, reason: 'timeout', imgCount: lastCount };
}

/**
 * 提取生成的图片 URL 列表
 */
async function extractImageUrls(page) {
  return page.evaluate(() => {
    const results = [];

    // 优先级从高到低的选择器策略
    const strategies = [
      // 策略1：result/generated 区域内的 img
      () => {
        const containers = document.querySelectorAll(
          '[class*="image-result"], [class*="result-image"], [class*="generated-image"], [class*="image-grid"]'
        );
        const urls = [];
        containers.forEach(c => {
          c.querySelectorAll('img').forEach(img => {
            const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
            if (src && src.startsWith('http') && !src.includes('avatar') && !src.includes('icon')) {
              urls.push(src);
            }
          });
        });
        return urls.length > 0 ? urls : null;
      },
      // 策略2：消息列表里最后一组图片
      () => {
        const allImgs = document.querySelectorAll('img[src*="tos-cn"], img[src*="bytedance"], img[src*="doubao"]');
        const urls = Array.from(allImgs)
          .map(img => img.src)
          .filter(src => src && src.startsWith('http'));
        return urls.length > 0 ? [...new Set(urls)] : null;
      },
      // 策略3：页面内所有较大的图片（宽度>200px 的，排除 UI 图标）
      () => {
        const allImgs = document.querySelectorAll('img');
        const urls = Array.from(allImgs)
          .filter(img => {
            const src = img.src || '';
            const w = img.naturalWidth || img.width || 0;
            return src.startsWith('http') && w > 200
              && !src.includes('avatar') && !src.includes('icon')
              && !src.includes('logo') && !src.includes('emoji');
          })
          .map(img => img.src);
        return urls.length > 0 ? [...new Set(urls)] : null;
      },
    ];

    for (const strategy of strategies) {
      const result = strategy();
      if (result && result.length > 0) return result;
    }
    return [];
  });
}

/**
 * 豆包图片生成主函数
 * @param {string} prompt - 图片描述
 * @param {Object} options
 * @param {string} options.ratio - 比例，如 '1:1', '16:9', '9:16'，默认 '1:1'
 * @param {number} options.count - 生成数量 1-4，默认 1
 * @param {number} options.timeout - 超时 ms，默认 180000
 * @param {number} options.retries - 重试次数，默认 2
 */
async function generateImage(prompt, options = {}) {
  const {
    ratio = '1:1',
    count = 1,
    timeout = 180000,
    retries = 2,
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let browser = null;
    try {
      browser = await chromium.connectOverCDP(CDP_URL);
      const ctx = browser.contexts()[0];
      const page = ctx.pages()[0];

      // 1. 导航到豆包图片生成页面
      const currentUrl = page.url();
      if (!currentUrl.includes('doubao.com/chat')) {
        await page.goto(DOUBAO_IMAGE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);
      } else if (!currentUrl.includes('create-image')) {
        await page.goto(DOUBAO_IMAGE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);
      }

      // 2. 检查登录状态（通过检测登录按钮，不依赖 URL 跳转）
      const loggedIn = await page.evaluate(() => {
        const loginBtn = document.querySelector('.login-btn-head, [class*="login-btn"]');
        if (loginBtn && loginBtn.offsetParent !== null) return false;
        return document.cookie.length > 100;
      });
      if (!loggedIn) {
        await browser.close();
        return {
          success: false,
          error: 'NOT_LOGGED_IN',
          message: '请先在 Chrome 中登录豆包，然后重试',
        };
      }

      // 3. 找输入框（豆包用 DIV[contenteditable="true"]）
      const inputSelectors = [
        '[contenteditable="true"][class*="editor"]',
        'div[contenteditable="true"]',
        '[contenteditable="true"]',
        'textarea',
      ];

      let inputSel = null;
      for (const sel of inputSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible().catch(() => false)) {
          inputSel = sel;
          break;
        }
      }

      if (!inputSel) {
        await browser.close();
        return {
          success: false,
          error: 'INPUT_NOT_FOUND',
          message: '未找到输入框，请确认已导航到豆包图片生成页面',
        };
      }

      // 4. 填写 prompt（type 方法兼容 contenteditable）
      const input = page.locator(inputSel).first();
      await input.click();
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.keyboard.type(prompt, { delay: 5 });
      await page.waitForTimeout(300);

      // 5. 尝试设置比例（如有选项）
      try {
        const ratioMap = { '1:1': '1:1', '16:9': '16:9', '9:16': '9:16', '4:3': '4:3', '3:4': '3:4' };
        if (ratio !== '1:1' && ratioMap[ratio]) {
          // 查找比例选择器
          const ratioBtn = page.locator(`[data-ratio="${ratio}"], button:has-text("${ratio}")`).first();
          if (await ratioBtn.isVisible().catch(() => false)) {
            await ratioBtn.click();
            await page.waitForTimeout(300);
          }
        }
      } catch (_) { /* 比例设置失败不影响主流程 */ }

      // 6. 提交
      // 方式一：Enter 键
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // 如果 Enter 没触发，尝试点击发送按钮
      const sent = await page.evaluate(() => {
        // 检查是否开始生成（loading 出现说明发送成功）
        return document.querySelectorAll('[class*="loading"], [class*="generating"]').length > 0;
      });

      if (!sent) {
        const submitBtns = [
          'button[type="submit"]',
          'button[aria-label*="发送"]',
          'button[aria-label*="send"]',
          'button[aria-label*="生成"]',
          'button[aria-label*="generate"]',
          '[class*="send-btn"]',
        ];
        for (const sel of submitBtns) {
          const btn = page.locator(sel).first();
          const visible = await btn.isVisible().catch(() => false);
          const disabled = await btn.isDisabled().catch(() => true);
          if (visible && !disabled) {
            await btn.click();
            break;
          }
        }
      }

      // 7. 等待生成完成
      const { done, reason, imgCount } = await waitForImageDone(page, timeout);

      // 8. 提取图片 URL
      const imageUrls = await extractImageUrls(page);

      await browser.close();

      return {
        success: true,
        prompt,
        options: { ratio, count },
        imageUrls,
        imageCount: imageUrls.length,
        timestamp: new Date().toISOString(),
        meta: {
          generationDone: done,
          doneReason: reason,
          detectedCount: imgCount,
          attempt: attempt + 1,
        },
      };

    } catch (e) {
      lastError = e;
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
      if (attempt < retries) {
        process.stderr.write(`Attempt ${attempt + 1} failed: ${e.message}, retrying...\n`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  return {
    success: false,
    error: 'MAX_RETRIES_EXCEEDED',
    message: lastError?.message || '未知错误',
  };
}

// CLI 入口 —— 始终输出 JSON
if (require.main === module) {
  const args = process.argv.slice(2);
  const ratioArg = args.find(a => a.startsWith('--ratio=') || a.startsWith('--ratio'));
  const countArg = args.find(a => a.startsWith('--count=') || a.startsWith('--count'));
  const prompt = args.find(a => !a.startsWith('-')) || '';

  let ratio = '1:1';
  if (ratioArg) {
    ratio = ratioArg.includes('=') ? ratioArg.split('=')[1] : (args[args.indexOf(ratioArg) + 1] || '1:1');
  }

  let count = 1;
  if (countArg) {
    const raw = countArg.includes('=') ? countArg.split('=')[1] : (args[args.indexOf(countArg) + 1] || '1');
    count = Math.min(4, Math.max(1, parseInt(raw) || 1));
  }

  if (!prompt) {
    const usage = {
      success: false,
      error: 'MISSING_PROMPT',
      message: 'Usage: node image.js "图片描述" [--ratio=1:1] [--count=1]',
    };
    console.log(JSON.stringify(usage, null, 2));
    process.exit(1);
  }

  generateImage(prompt, { ratio, count }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  }).catch(e => {
    const err = { success: false, error: 'EXCEPTION', message: e.message };
    console.log(JSON.stringify(err, null, 2));
    process.exit(1);
  });
}

module.exports = { generateImage };
