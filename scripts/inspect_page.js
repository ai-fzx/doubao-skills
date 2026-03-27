/**
 * 检查指定 chat URL 页面内容
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  
  const page = pages[0];
  console.error('当前URL:', page.url());
  
  // 截图
  await page.screenshot({ path: 'current_page.png', fullPage: true });
  console.error('截图已保存: current_page.png');
  
  // 分析 DOM
  const dom = await page.evaluate(() => {
    // 找所有消息气泡
    const msgs = [];
    const allDivs = document.querySelectorAll('[class*="message"], [class*="chat"], [class*="bubble"], [class*="answer"], [class*="content"]');
    allDivs.forEach((el, i) => {
      if (i < 30 && el.offsetParent !== null) {
        msgs.push({
          class: el.className.slice(0, 80),
          text: el.innerText.slice(0, 200),
          hasVideo: !!el.querySelector('video'),
          hasImg: el.querySelectorAll('img').length
        });
      }
    });
    
    // 页面全文（最后部分）
    const fullText = document.body.innerText;
    const lastPart = fullText.slice(-2000);
    
    // 所有图片
    const imgs = Array.from(document.querySelectorAll('img')).map(i => ({
      src: i.src.slice(0, 150),
      alt: i.alt,
      w: i.width, h: i.height
    })).filter(i => i.w > 50 || i.h > 50);
    
    // videos
    const videos = Array.from(document.querySelectorAll('video')).map(v => ({
      src: v.src || v.currentSrc,
      poster: v.poster
    }));
    
    // 按钮
    const btns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => b.offsetParent !== null).map(b => ({
      text: b.textContent.trim().slice(0, 40),
      aria: b.getAttribute('aria-label') || ''
    }));
    
    return { msgs: msgs.slice(0, 20), lastPart, imgs: imgs.slice(0, 10), videos, btns: btns.slice(0, 20) };
  });
  
  console.log(JSON.stringify(dom, null, 2));
  await browser.close();
})().catch(e => {
  console.error(e.message);
  console.log(JSON.stringify({ error: e.message }));
});
