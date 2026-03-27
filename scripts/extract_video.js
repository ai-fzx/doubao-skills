/**
 * 从豆包当前页面提取最新生成的视频 URL
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0];
    
    console.error('当前URL:', page.url());
    await page.waitForTimeout(2000);

    // 提取页面所有视频
    const result = await page.evaluate(() => {
      const videos = [];
      
      // 方式1: video 标签
      document.querySelectorAll('video').forEach(v => {
        if (v.src) videos.push({ type: 'video_src', url: v.src });
        v.querySelectorAll('source').forEach(s => {
          if (s.src) videos.push({ type: 'source', url: s.src });
        });
      });
      
      // 方式2: 下载链接
      document.querySelectorAll('a[href*=".mp4"], a[href*="video"], a[download]').forEach(a => {
        videos.push({ type: 'download_link', url: a.href, text: a.textContent.trim().slice(0, 30) });
      });
      
      // 方式3: 图片（缩略图）
      const imgs = [];
      document.querySelectorAll('img[src*="byteimg"], img[src*="video"]').forEach(img => {
        imgs.push(img.src.slice(0, 100));
      });
      
      // 方式4: 检查是否还在生成中
      const pageText = document.body.innerText.slice(0, 500);
      const isGenerating = /生成中|generating|正在生成|处理中/i.test(pageText);
      
      // 方式5: 通过网络请求记录
      const allLinks = [];
      document.querySelectorAll('[class*="video"], [class*="Video"]').forEach(el => {
        const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
        if (src) allLinks.push({ class: el.className.slice(0, 50), src });
      });
      
      return { videos, imgs: imgs.slice(0, 5), isGenerating, allLinks, pageTextPreview: pageText.slice(0, 200) };
    });
    
    console.log(JSON.stringify(result, null, 2));
    
    // 如果没找到视频，等待10秒再试
    if (result.videos.length === 0 && result.isGenerating) {
      console.error('视频仍在生成中，等待10秒...');
      await page.waitForTimeout(10000);
      
      const result2 = await page.evaluate(() => {
        const videos = [];
        document.querySelectorAll('video').forEach(v => {
          if (v.src) videos.push({ type: 'video_src', url: v.src });
        });
        return { videos, isGenerating: /生成中|generating/.test(document.body.innerText) };
      });
      console.log('10秒后结果:', JSON.stringify(result2, null, 2));
    }
    
    await browser.close();
  } catch (e) {
    console.error('错误:', e.message);
    process.exit(1);
  }
})();
