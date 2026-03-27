/**
 * 快速检查 create-video 页面当前状态
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    
    // 找到或打开 create-video 页面
    let page = null;
    for (const p of ctx.pages()) {
      if (p.url().includes('create-video') || p.url().includes('doubao')) {
        page = p;
        break;
      }
    }
    if (!page) page = ctx.pages()[0];
    
    console.error('当前URL:', page.url());
    
    // 导航到 create-video
    await page.goto('https://www.doubao.com/chat/create-video', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);
    console.error('导航后URL:', page.url());

    // 截图看一下
    await page.screenshot({ path: 'page_screenshot.png', fullPage: false });
    console.error('截图已保存');
    
    // 检查 DOM 中所有媒体元素
    const dom = await page.evaluate(() => {
      // 找视频
      const videos = Array.from(document.querySelectorAll('video')).map(v => ({
        src: v.src,
        currentSrc: v.currentSrc,
        poster: v.poster,
        sources: Array.from(v.querySelectorAll('source')).map(s => s.src)
      }));
      
      // 找所有含 mp4 的链接
      const mp4Links = [];
      document.querySelectorAll('*').forEach(el => {
        for (const attr of el.attributes) {
          if (attr.value && (attr.value.includes('.mp4') || attr.value.includes('video-play'))) {
            mp4Links.push({ tag: el.tagName, attr: attr.name, val: attr.value.slice(0, 150) });
          }
        }
      });
      
      // 消息列表
      const msgs = Array.from(document.querySelectorAll('[class*="message"], [class*="chat-item"], [class*="answer"]'));
      const lastMsg = msgs[msgs.length - 1];
      const lastMsgHTML = lastMsg ? lastMsg.innerHTML.slice(0, 500) : 'none';
      
      // 生成中？
      const isGenerating = /生成中|正在生成|处理中/.test(document.body.innerText);
      const pageTextSample = document.body.innerText.slice(0, 400);
      
      return { videos, mp4Links: mp4Links.slice(0, 10), lastMsgHTML, isGenerating, pageTextSample };
    });
    
    console.log(JSON.stringify(dom, null, 2));
    await browser.close();
  } catch(e) {
    console.error('错误:', e.message);
    console.log(JSON.stringify({ error: e.message }));
  }
})();
