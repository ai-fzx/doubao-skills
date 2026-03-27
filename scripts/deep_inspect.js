/**
 * 深度检查豆包视频页面 DOM - 带超时
 */
const { chromium } = require('./node_modules/playwright');

const timer = setTimeout(() => {
  process.stdout.write(JSON.stringify({ error: 'hard timeout 12s' }) + '\n');
  process.exit(0);
}, 12000);

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    
    // 找豆包页面
    let page = null;
    for (const p of pages) {
      const url = p.url();
      if (url.includes('doubao.com')) { page = p; break; }
    }
    if (!page) page = pages[0];

    const url = page.url();
    
    // 截图保存
    await page.screenshot({ path: 'deep_screenshot.png', fullPage: false }).catch(() => {});
    
    const dom = await page.evaluate(() => {
      // 1. 获取页面主要文字 (最后3000字符)
      const fullText = document.body ? document.body.innerText : '';
      const tail = fullText.slice(-3000);
      
      // 2. 所有视频元素
      const videos = Array.from(document.querySelectorAll('video')).map(v => ({
        src: v.src || v.currentSrc || '',
        poster: v.poster || '',
        w: v.videoWidth, h: v.videoHeight,
        readyState: v.readyState,
        classes: v.className.slice(0, 100)
      }));
      
      // 3. 所有图片 (宽>100px)
      const imgs = Array.from(document.querySelectorAll('img'))
        .filter(i => i.offsetWidth > 100 || i.offsetHeight > 100)
        .map(i => ({ src: i.src.slice(0, 200), alt: i.alt, w: i.offsetWidth, h: i.offsetHeight }))
        .slice(0, 15);
      
      // 4. 可见按钮
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(b => b.offsetParent !== null)
        .map(b => ({
          text: b.textContent.trim().slice(0, 60),
          aria: b.getAttribute('aria-label') || '',
          classes: b.className.slice(0, 80)
        }))
        .slice(0, 30);
      
      // 5. 消息列表
      const msgs = [];
      const msgSelectors = [
        '[class*="message"]', '[class*="chat-item"]', '[class*="answer"]',
        '[class*="bubble"]', '[class*="reply"]'
      ];
      const seen = new Set();
      for (const sel of msgSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          if (el.offsetParent !== null && !seen.has(el)) {
            seen.add(el);
            const txt = el.innerText.slice(0, 300);
            if (txt.length > 5) {
              msgs.push({
                sel,
                class: el.className.slice(0, 100),
                text: txt,
                hasVideo: !!el.querySelector('video'),
                hasImg: el.querySelectorAll('img').length,
                hasCanvas: !!el.querySelector('canvas')
              });
            }
          }
        });
      }
      
      // 6. 输入框状态
      const input = document.querySelector('[contenteditable="true"]');
      const inputInfo = input ? {
        found: true,
        text: input.innerText.slice(0, 100),
        classes: input.className.slice(0, 100),
        placeholder: input.getAttribute('placeholder') || ''
      } : { found: false };
      
      // 7. 查找特殊元素 (loading, skeleton, generating等)
      const special = {};
      const specialSelectors = {
        loading: '[class*="loading"]',
        skeleton: '[class*="skeleton"]',
        generating: '[class*="generating"]',
        progress: '[class*="progress"]',
        spinner: '[class*="spinner"]',
        pending: '[class*="pending"]',
        task: '[class*="task"]',
        videoCard: '[class*="video-card"], [class*="videoCard"]',
        mediaCard: '[class*="media-card"], [class*="mediaCard"]'
      };
      for (const [key, sel] of Object.entries(specialSelectors)) {
        const els = Array.from(document.querySelectorAll(sel))
          .filter(e => e.offsetParent !== null);
        if (els.length > 0) {
          special[key] = els.slice(0, 3).map(e => ({
            class: e.className.slice(0, 100),
            text: e.innerText.slice(0, 100)
          }));
        }
      }
      
      // 8. data-* 属性中包含 video/task/status 的元素
      const dataEls = [];
      document.querySelectorAll('[data-task-id], [data-video], [data-status], [data-type="video"]').forEach(el => {
        dataEls.push({
          tag: el.tagName,
          data: JSON.stringify(el.dataset).slice(0, 200),
          class: el.className.slice(0, 80)
        });
      });
      
      // 9. a标签 href包含mp4/video
      const videoLinks = Array.from(document.querySelectorAll('a[href*=".mp4"], a[href*="video"]'))
        .map(a => ({ href: a.href, text: a.textContent.slice(0, 40) }));
      
      return {
        tail,
        videos,
        imgs,
        btns,
        msgs: msgs.slice(0, 15),
        inputInfo,
        special,
        dataEls,
        videoLinks
      };
    });
    
    clearTimeout(timer);
    process.stdout.write(JSON.stringify({ url, ...dom }, null, 2) + '\n');
    await browser.close().catch(() => {});
    process.exit(0);
  } catch (e) {
    clearTimeout(timer);
    process.stdout.write(JSON.stringify({ error: e.message, stack: e.stack }) + '\n');
    process.exit(0);
  }
})();
