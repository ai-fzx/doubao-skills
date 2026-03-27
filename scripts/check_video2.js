/**
 * 检查上次视频生成的对话页，提取视频 URL
 * 视频任务提交时页面已跳转到某个 chat URL
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    
    console.error('所有页面:', pages.map(p => p.url()));
    
    // 用当前第一个页面
    const page = pages[0];
    
    // 导航到 create-video，用 load 而非 networkidle
    await page.goto('https://www.doubao.com/chat/create-video', { 
      waitUntil: 'load', 
      timeout: 30000 
    });
    await page.waitForTimeout(5000);
    
    console.error('导航后URL:', page.url());
    
    // 截图
    await page.screenshot({ path: 'video_page.png' });
    console.error('截图已保存为 video_page.png');
    
    // 检查是否有视频
    const result = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video')).map(v => ({
        src: v.src || v.currentSrc,
        poster: v.poster
      })).filter(v => v.src);
      
      const mp4 = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node;
      while (node = walker.nextNode()) {
        for (const attr of node.attributes) {
          const val = attr.value || '';
          if (val.includes('mp4') || val.includes('m3u8')) {
            mp4.push({ tag: node.tagName, attr: attr.name, val: val.slice(0, 200) });
          }
        }
      }
      
      const generating = /生成中|正在生成/.test(document.body.innerText);
      const textSample = document.body.innerText.slice(0, 500);
      const imgs = Array.from(document.querySelectorAll('img[src*="byteimg"]')).map(i => i.src.slice(0, 120));
      
      return { videos, mp4: mp4.slice(0, 5), generating, textSample, imgs: imgs.slice(0, 3) };
    });
    
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
  } catch(e) {
    console.error('错误:', e.message);
    console.log(JSON.stringify({ error: e.message }));
  }
})();
