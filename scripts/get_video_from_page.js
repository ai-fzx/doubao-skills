/**
 * 导航到 create-video 页面，等待视频出现并提取 URL
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0];
    
    // 先尝试找到视频生成对话（不新建）
    const currentUrl = page.url();
    console.error('当前URL:', currentUrl);
    
    // 如果不在 create-video 页，导航过去
    if (!currentUrl.includes('create-video')) {
      await page.goto('https://www.doubao.com/chat/create-video', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);
      console.error('已导航到 create-video, URL:', page.url());
    }
    
    // 等待并轮询视频出现（最多等 120 秒）
    let videoUrl = null;
    let thumbnailUrl = null;
    let downloadUrl = null;
    
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(5000);
      
      const found = await page.evaluate(() => {
        const result = {
          videos: [],
          downloadLinks: [],
          thumbnails: [],
          isGenerating: false,
          pageText: document.body.innerText.slice(0, 300)
        };
        
        // video 标签
        document.querySelectorAll('video').forEach(v => {
          if (v.src && v.src.startsWith('http')) result.videos.push(v.src);
          v.querySelectorAll('source').forEach(s => {
            if (s.src && s.src.startsWith('http')) result.videos.push(s.src);
          });
        });
        
        // 下载/链接
        document.querySelectorAll('a[href*=".mp4"], a[download], button[class*="download"], [class*="download"]').forEach(el => {
          const href = el.href || el.getAttribute('data-url') || '';
          if (href && href.includes('http')) result.downloadLinks.push(href);
        });
        
        // 缩略图
        document.querySelectorAll('img[src*="byteimg"], img[src*="video"]').forEach(img => {
          result.thumbnails.push(img.src);
        });
        
        // 生成中判断
        result.isGenerating = /生成中|正在生成|处理中|generating/i.test(document.body.innerText);
        
        // 特殊：检查有无 video 相关 data 属性
        document.querySelectorAll('[data-url], [data-src], [data-video]').forEach(el => {
          const url = el.getAttribute('data-url') || el.getAttribute('data-src') || el.getAttribute('data-video') || '';
          if (url && url.includes('http')) result.downloadLinks.push(url);
        });
        
        return result;
      });
      
      console.error(`轮询 ${(i+1)*5}s: videos=${found.videos.length}, generating=${found.isGenerating}`);
      
      if (found.videos.length > 0) {
        videoUrl = found.videos[0];
        thumbnailUrl = found.thumbnails[0] || null;
        downloadUrl = found.downloadLinks[0] || null;
        break;
      }
      
      if (!found.isGenerating && i > 3) {
        // 不在生成中也没视频，可能页面需要等用户滚动或点击
        // 尝试查找最新消息
        const msg = found.pageText;
        console.error('页面文本预览（base64 safe）:', Buffer.from(msg).toString('base64').slice(0, 100));
        
        // 尝试通过网络拦截获取视频
        console.error('尝试点击触发视频显示...');
        try {
          await page.mouse.move(700, 400);
          await page.mouse.move(700, 500);
          await page.waitForTimeout(1000);
        } catch(e) {}
      }
    }
    
    // 最后尝试通过 network 资源
    if (!videoUrl) {
      const frames = page.frames();
      for (const frame of frames) {
        const vids = await frame.evaluate(() => {
          return Array.from(document.querySelectorAll('video')).map(v => v.src).filter(s => s.startsWith('http'));
        });
        if (vids.length > 0) {
          videoUrl = vids[0];
          break;
        }
      }
    }
    
    const output = {
      success: !!videoUrl,
      videoUrl,
      thumbnailUrl,
      downloadUrl,
      pageUrl: page.url()
    };
    
    console.log(JSON.stringify(output, null, 2));
    await browser.close();
  } catch (e) {
    console.error('错误:', e.message);
    console.log(JSON.stringify({ success: false, error: e.message }));
    process.exit(1);
  }
})();
