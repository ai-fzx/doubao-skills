/**
 * 直接检查当前页面 - 看看视频是否已经生成好了
 * 同时输出详细的 DOM 结构帮助调试
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  
  console.error('URL:', page.url());
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    // 1. 查找视频
    const videos = Array.from(document.querySelectorAll('video')).map(v => ({
      src: v.src || v.currentSrc || '',
      poster: v.poster || ''
    })).filter(v => v.src || v.poster);
    
    // 2. 查找所有含 URL 的属性（找 mp4/m3u8）
    const mediaUrls = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      for (const attr of el.attributes) {
        if (attr.value && (attr.value.includes('.mp4') || attr.value.includes('m3u8') || attr.value.includes('video-play'))) {
          mediaUrls.push({ tag: el.tagName, attr: attr.name, val: attr.value.slice(0, 200) });
        }
      }
    }
    
    // 3. 检查最新消息气泡
    const bubbles = Array.from(document.querySelectorAll('[class*="bot"], [class*="assistant"], [class*="answer"], [class*="message-content"], [class*="chat-msg"]'));
    const lastBubble = bubbles[bubbles.length - 1];
    const lastBubbleHTML = lastBubble ? lastBubble.outerHTML.slice(0, 1000) : 'none';
    
    // 4. 找所有含 byteimg 的图片（可能是视频缩略图）
    const byteImgs = Array.from(document.querySelectorAll('img')).filter(i => 
      i.src.includes('byteimg') || i.src.includes('flow-imagex')
    ).map(i => i.src.slice(0, 150));
    
    // 5. 检查生成状态
    const bodyText = document.body.innerText;
    const isGenerating = /生成中|正在生成|处理中/.test(bodyText);
    const hasError = /失败|错误|error/i.test(bodyText);
    
    // 6. 检查是否有"下载"按钮
    const downloadBtns = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(el => 
      el.textContent.includes('下载') || el.getAttribute('aria-label')?.includes('下载') ||
      el.className.includes('download')
    ).map(el => ({ text: el.textContent.trim().slice(0, 30), href: el.href || '', class: el.className.slice(0, 60) }));
    
    return {
      videos,
      mediaUrls: mediaUrls.slice(0, 10),
      lastBubbleHTML,
      byteImgs: byteImgs.slice(0, 5),
      isGenerating,
      hasError,
      downloadBtns
    };
  });
  
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(e => {
  console.error('Error:', e.message);
  console.log(JSON.stringify({ error: e.message }));
});
