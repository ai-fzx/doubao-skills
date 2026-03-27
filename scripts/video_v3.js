/**
 * 豆包视频生成 v3
 * 通过监听网络请求（response）来捕获视频 URL，而不是轮询 DOM
 */
const { chromium } = require('./node_modules/playwright');

const CDP_URL = 'http://127.0.0.1:9222';
const DOUBAO_VIDEO_URL = 'https://www.doubao.com/chat/create-video';

async function run() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];

  // === 1. 导航到视频生成页 ===
  const curUrl = page.url();
  if (!curUrl.includes('create-video')) {
    await page.goto(DOUBAO_VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  }
  console.error('当前URL:', page.url());

  // === 2. 捕获网络响应中的视频 URL ===
  const capturedVideoUrls = [];
  const capturedApiResponses = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    
    // 捕获视频文件
    if (url.includes('.mp4') || url.includes('m3u8') || url.includes('video-play')) {
      capturedVideoUrls.push(url);
      console.error('🎬 捕获视频URL:', url.slice(0, 120));
    }
    
    // 捕获豆包 API 响应（可能包含视频信息）
    if (url.includes('doubao.com') && (url.includes('/api/') || url.includes('/v2/')) && status === 200) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const body = await response.json().catch(() => null);
          if (body && JSON.stringify(body).includes('video')) {
            capturedApiResponses.push({ url: url.slice(0, 100), body });
            console.error('📦 API响应含video关键词:', url.slice(0, 80));
          }
        }
      } catch(e) {}
    }
  });

  // === 3. 找输入框并输入 prompt ===
  const prompt = process.argv[2] || '一只熊猫和老虎在竹林中打架，功夫动作，3D动画';
  
  const selectors = [
    '[contenteditable="true"][class*="editor"]',
    'div[contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea',
  ];
  
  let inputFound = false;
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(300);
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await page.keyboard.type(prompt, { delay: 5 });
        await page.waitForTimeout(500);
        inputFound = true;
        console.error('✅ 已输入 prompt，selector:', sel);
        break;
      }
    } catch(e) {}
  }
  
  if (!inputFound) {
    console.log(JSON.stringify({ success: false, error: 'INPUT_NOT_FOUND' }));
    await browser.close();
    return;
  }

  // === 4. 提交 ===
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  
  // 检查是否有提交反应
  const urlAfterSubmit = page.url();
  console.error('提交后URL:', urlAfterSubmit);
  
  // === 5. 等待视频（最多 10 分钟）===
  const MAX_WAIT = 600000; // 10分钟
  const start = Date.now();
  let finalVideoUrl = null;
  let thumbnailUrl = null;
  let downloadUrl = null;
  
  console.error('开始等待视频生成，最多等待 10 分钟...');
  
  while (Date.now() - start < MAX_WAIT) {
    await page.waitForTimeout(5000);
    const elapsed = Math.round((Date.now() - start) / 1000);
    
    // 先检查网络捕获
    if (capturedVideoUrls.length > 0) {
      finalVideoUrl = capturedVideoUrls[capturedVideoUrls.length - 1];
      console.error(`✅ 从网络响应获取视频URL (${elapsed}s)`);
      break;
    }
    
    // 检查 DOM
    const domResult = await page.evaluate(() => {
      // video 标签
      for (const v of document.querySelectorAll('video')) {
        const src = v.src || v.currentSrc || '';
        if (src.startsWith('http')) return { type: 'video', url: src };
        for (const s of v.querySelectorAll('source')) {
          if (s.src.startsWith('http')) return { type: 'video', url: s.src };
        }
      }
      
      // mp4 链接
      for (const el of document.querySelectorAll('*')) {
        for (const attr of el.attributes) {
          if (attr.value && attr.value.includes('.mp4') && attr.value.startsWith('http')) {
            return { type: 'attr_mp4', url: attr.value };
          }
        }
      }
      
      // 下载按钮
      for (const el of document.querySelectorAll('a[download], a[href*=".mp4"]')) {
        if (el.href.startsWith('http')) return { type: 'download', url: el.href };
      }
      
      // 封面图
      for (const img of document.querySelectorAll('img[src*="byteimg"]')) {
        if (img.src.includes('video') || img.src.includes('tplv')) {
          return { type: 'thumbnail', url: img.src };
        }
      }
      
      // 检查生成状态
      const text = document.body.innerText;
      const hasVideo = text.includes('下载') || text.includes('保存');
      return { type: 'none', hasVideo, isGenerating: /生成中|正在生成/.test(text.slice(-2000)) };
    });
    
    if (domResult.url) {
      if (domResult.type === 'video' || domResult.type === 'attr_mp4' || domResult.type === 'download') {
        finalVideoUrl = domResult.url;
        console.error(`✅ 从DOM获取视频URL (${elapsed}s, type=${domResult.type})`);
        break;
      } else if (domResult.type === 'thumbnail') {
        thumbnailUrl = domResult.url;
      }
    }
    
    // 心跳日志
    if (elapsed % 30 < 5) {
      const info = domResult.type === 'none' ? `hasVideo=${domResult.hasVideo}, generating=${domResult.isGenerating}` : domResult.type;
      console.error(`⏳ 等待中 ${elapsed}s: ${info}, 网络捕获视频=${capturedVideoUrls.length}`);
    }
    
    // 如果页面有"下载"文字，做更仔细的检查
    if (domResult.hasVideo) {
      console.error('页面有"下载"按钮，做深度检查...');
      const deepCheck = await page.evaluate(() => {
        const results = [];
        // 找所有按钮文字
        document.querySelectorAll('button, a, [role="button"]').forEach(el => {
          const text = el.textContent.trim();
          if (text.includes('下载') || text.includes('保存')) {
            results.push({ text, href: el.href || '', onclick: !!el.onclick });
          }
        });
        return results;
      });
      console.error('下载元素:', JSON.stringify(deepCheck));
      
      // 尝试悬停在视频区域触发控件
      try {
        const videoEl = page.locator('video').first();
        if (await videoEl.isVisible().catch(() => false)) {
          await videoEl.hover();
          await page.waitForTimeout(1000);
        }
      } catch(e) {}
    }
  }
  
  // 最终截图
  await page.screenshot({ path: 'final_screenshot.png' });
  console.error('截图已保存: final_screenshot.png');
  
  const finalUrl = page.url();
  
  const output = {
    success: !!finalVideoUrl,
    videoUrl: finalVideoUrl,
    thumbnailUrl,
    downloadUrl,
    capturedNetworkVideos: capturedVideoUrls,
    apiResponses: capturedApiResponses.length,
    finalPageUrl: finalUrl,
    elapsed: Math.round((Date.now() - start) / 1000),
  };
  
  console.log(JSON.stringify(output, null, 2));
  await browser.close();
}

run().catch(e => {
  console.error('FATAL:', e.message);
  console.log(JSON.stringify({ success: false, error: e.message }));
});
