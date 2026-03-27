/**
 * 扫描所有标签页，找到有视频/正在生成的页面
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  
  console.error('共有页面数:', pages.length);
  
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const url = p.url();
    console.error(`页面[${i}]: ${url}`);
    
    if (!url.includes('doubao.com')) continue;
    
    try {
      const info = await p.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc).filter(Boolean);
        const isGenerating = /生成中|正在生成/.test(document.body.innerText);
        const hasThumbnail = document.querySelectorAll('img[src*="byteimg"]').length > 0;
        const text = document.body.innerText.slice(0, 200);
        const mp4 = [];
        document.querySelectorAll('*').forEach(el => {
          for (const a of el.attributes) {
            if (a.value && a.value.includes('.mp4')) mp4.push(a.value.slice(0, 100));
          }
        });
        return { videos, isGenerating, hasThumbnail, text: text.replace(/\s+/g, ' ').slice(0, 100), mp4: mp4.slice(0,3) };
      });
      console.error(`  videos:${info.videos.length}, generating:${info.isGenerating}, thumb:${info.hasThumbnail}, mp4:${info.mp4.length}`);
      if (info.videos.length > 0 || info.mp4.length > 0) {
        console.log(JSON.stringify({ found: true, url, ...info }));
      }
    } catch(e) {
      console.error(`  错误: ${e.message.slice(0, 50)}`);
    }
  }
  
  // 如果没找到，尝试打开历史对话列表
  console.log(JSON.stringify({ found: false, pages: pages.map(p => p.url()) }));
  await browser.close();
})().catch(e => {
  console.error(e.message);
  console.log(JSON.stringify({ error: e.message }));
});
