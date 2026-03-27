/**
 * 检查豆包视频页面 DOM 结构（修复版）
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  
  const page = pages[0];
  console.error('当前URL:', page.url());
  
  // 截图
  await page.screenshot({ path: 'current_page2.png', fullPage: true });
  console.error('截图已保存: current_page2.png');
  
  // 分析 DOM
  const dom = await page.evaluate(() => {
    function safeClass(el) {
      try {
        const c = el.className;
        if (typeof c === 'string') return c.slice(0, 80);
        return String(c || '').slice(0, 80);
      } catch(e) {
        return '';
      }
    }
    
    // 找所有消息气泡
    const msgs = [];
    const allDivs = document.querySelectorAll('[class*="message"], [class*="chat"], [class*="bubble"], [class*="answer"], [class*="content"]');
    allDivs.forEach((el, i) => {
      if (i < 30 && el.offsetParent !== null) {
        msgs.push({
          class: safeClass(el),
          text: (el.innerText || '').slice(0, 200),
          hasVideo: !!el.querySelector('video'),
          hasImg: el.querySelectorAll('img').length
        });
      }
    });
    
    // 页面全文（最后部分）
    const fullText = document.body.innerText || '';
    const lastPart = fullText.slice(-3000);
    
    // 所有图片（含小图）
    const imgs = Array.from(document.querySelectorAll('img')).map(i => ({
      src: (i.src || '').slice(0, 200),
      alt: i.alt || '',
      w: i.naturalWidth || i.width, 
      h: i.naturalHeight || i.height
    }));
    
    // videos
    const videos = Array.from(document.querySelectorAll('video')).map(v => ({
      src: v.src || v.currentSrc || '',
      poster: v.poster || '',
      sources: Array.from(v.querySelectorAll('source')).map(s => s.src)
    }));
    
    // 按钮
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(b => b.offsetParent !== null)
      .map(b => ({
        text: (b.textContent || '').trim().slice(0, 50),
        aria: b.getAttribute('aria-label') || '',
        cls: safeClass(b)
      }));
    
    // 下载链接
    const links = Array.from(document.querySelectorAll('a[href*="mp4"], a[href*="video"], a[download]'))
      .map(a => ({ href: (a.href || '').slice(0, 200), text: (a.textContent || '').trim().slice(0, 50) }));
    
    // 找特定图片（可能是视频缩略图）
    const thumbnails = Array.from(document.querySelectorAll('img')).filter(i => {
      const src = i.src || '';
      return src.includes('tos') || src.includes('video') || src.includes('img') || (i.width > 100 && i.height > 60);
    }).map(i => ({
      src: (i.src || '').slice(0, 300),
      w: i.width, h: i.height
    }));
    
    return { msgs: msgs.slice(0, 20), lastPart, imgs: imgs.slice(0, 20), videos, btns: btns.slice(0, 30), links, thumbnails: thumbnails.slice(0, 10) };
  });
  
  console.log(JSON.stringify(dom, null, 2));
  await browser.close();
})().catch(e => {
  console.error(e.message);
  console.log(JSON.stringify({ error: e.message }));
});
