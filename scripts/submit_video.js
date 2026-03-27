/**
 * 豆包视频生成 - 完整流程脚本
 * 1. 导航到视频创作页
 * 2. 填入提示词
 * 3. 点击发送按钮（等它变为可用状态）
 * 4. 监听页面变化，等待视频生成完成
 * 5. 提取视频URL
 */
const { chromium } = require('./node_modules/playwright');
const fs = require('fs');

const PROMPT = process.argv[2] || 'A chubby anthropomorphic panda wearing white kung fu uniform charges at a fierce anthropomorphic tiger in orange-black armor, both standing upright like warriors, panda throws powerful punch, tiger counters with claw swipe, explosion of dust and bamboo leaves, cinematic, bamboo forest background, 3D Pixar animation style, 5 seconds';

const TIMEOUT = 10 * 60 * 1000; // 10 minutes

(async () => {
  console.error('启动豆包视频生成...');
  console.error('提示词:', PROMPT.slice(0, 100) + '...');
  
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  
  // 优先使用已有豆包页面
  let page;
  for (const p of pages) {
    if (p.url().includes('doubao.com')) {
      page = p;
      break;
    }
  }
  if (!page) page = pages[0];
  
  // 设置网络响应监听（捕获视频URL）
  const capturedVideos = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/\.(mp4|m3u8)/i) || url.includes('video-play') || url.includes('tos-cn-v')) {
      console.error('网络捕获视频:', url.slice(0, 200));
      capturedVideos.push(url);
    }
    // 也监听API响应
    if (url.includes('/api/') && resp.headers()['content-type']?.includes('json')) {
      try {
        const text = await resp.text().catch(() => '');
        if (text.includes('video_url') || text.includes('mp4') || text.includes('"url"')) {
          console.error('API响应含视频:', url.slice(0, 100), text.slice(0, 200));
        }
      } catch(e) {}
    }
  });
  
  // 导航到视频创作页（每次新对话）
  console.error('导航到豆包视频创作页...');
  await page.goto('https://www.doubao.com/chat/create-video', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  await page.waitForTimeout(3000);
  console.error('当前URL:', page.url());
  
  await page.screenshot({ path: 'submit_01_initial.png' });
  
  // 找输入框
  console.error('查找输入框...');
  const inputSel = '[contenteditable="true"]';
  await page.waitForSelector(inputSel, { timeout: 10000 });
  
  // 点击输入框并填入提示词
  const inputEl = page.locator(inputSel).first();
  await inputEl.click();
  await page.waitForTimeout(500);
  
  // 清空并填入内容
  await inputEl.fill('');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  
  // 逐字输入（更可靠）
  await inputEl.type(PROMPT, { delay: 20 });
  await page.waitForTimeout(1000);
  
  console.error('已填入提示词，截图...');
  await page.screenshot({ path: 'submit_02_filled.png' });
  
  // 检查发送按钮状态
  const sendBtnInfo = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const aria = btn.getAttribute('aria-label') || '';
      const cls = (btn.className || '');
      if (aria.includes('发送') || aria.includes('send') || cls.includes('send-btn')) {
        return {
          text: btn.textContent?.trim().slice(0, 30),
          aria: aria,
          cls: cls.slice(0, 100),
          disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
          found: true
        };
      }
    }
    return { found: false };
  });
  console.error('发送按钮状态:', JSON.stringify(sendBtnInfo));
  
  // 等待发送按钮变为可用
  console.error('等待发送按钮变为可用...');
  try {
    await page.waitForFunction(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const aria = btn.getAttribute('aria-label') || '';
        const cls = (btn.className || '');
        if (aria.includes('发送') || cls.includes('send-btn')) {
          return !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && !cls.includes('disabled');
        }
      }
      return false;
    }, { timeout: 5000 });
    console.error('发送按钮已可用！');
  } catch(e) {
    console.error('发送按钮等待超时，尝试其他方式...');
  }
  
  // 尝试点击发送按钮
  const clicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const aria = btn.getAttribute('aria-label') || '';
      const cls = (btn.className || '');
      if (aria.includes('发送') || cls.includes('send-btn')) {
        if (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          btn.click();
          return { clicked: true, aria, cls: cls.slice(0, 60) };
        } else {
          return { clicked: false, reason: 'disabled', aria, cls: cls.slice(0, 60) };
        }
      }
    }
    return { clicked: false, reason: 'not_found' };
  });
  console.error('点击发送结果:', JSON.stringify(clicked));
  
  if (!clicked.clicked) {
    // 尝试按 Enter 键
    console.error('按钮未启用，尝试 Enter 键...');
    await inputEl.press('Enter');
  }
  
  await page.waitForTimeout(2000);
  console.error('提交后URL:', page.url());
  await page.screenshot({ path: 'submit_03_submitted.png' });
  
  // 等待视频生成（最多10分钟轮询）
  console.error('等待视频生成...');
  const startTime = Date.now();
  let videoResult = null;
  
  while (Date.now() - startTime < TIMEOUT) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    // 检查页面状态
    const state = await page.evaluate(() => {
      function safeClass(el) {
        try {
          const c = el.className;
          return typeof c === 'string' ? c : String(c || '');
        } catch(e) { return ''; }
      }
      
      // 找视频元素
      const videos = Array.from(document.querySelectorAll('video')).map(v => ({
        src: v.src || v.currentSrc || '',
        poster: v.poster || ''
      })).filter(v => v.src || v.poster);
      
      // 找 mp4 链接
      const mp4Links = Array.from(document.querySelectorAll('a[href*="mp4"], source[src*="mp4"]'))
        .map(el => el.href || el.src).filter(Boolean);
      
      // 找下载按钮
      const downloadBtns = Array.from(document.querySelectorAll('button, a'))
        .filter(el => {
          const t = (el.textContent || el.getAttribute('aria-label') || '').trim();
          return t.includes('下载') || t.includes('download') || t.includes('保存');
        })
        .map(el => ({
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
          href: el.href || ''
        }));
      
      // 找缩略图（可能是视频封面）
      const thumbs = Array.from(document.querySelectorAll('img'))
        .filter(img => {
          const src = img.src || '';
          return (src.includes('tos') || src.includes('video') || src.includes('.jpg') || src.includes('.png')) 
            && img.naturalWidth > 100 && img.naturalHeight > 60;
        })
        .map(img => ({ src: img.src.slice(0, 200), w: img.naturalWidth, h: img.naturalHeight }));
      
      // 检查是否在生成中（只找明确的生成状态指示器）
      const genIndicators = Array.from(document.querySelectorAll('[class*="generating"], [class*="progress"], [class*="loading-video"], [data-state="loading"]'))
        .filter(el => el.offsetParent !== null)
        .map(el => safeClass(el).slice(0, 60));
      
      // 错误信息
      const errors = Array.from(document.querySelectorAll('[class*="error"], [class*="fail"]'))
        .filter(el => el.offsetParent !== null && (el.textContent || '').trim().length > 0)
        .map(el => (el.textContent || '').trim().slice(0, 100));
      
      // 页面最新部分文字
      const recentText = (document.body.innerText || '').slice(-1500);
      
      return { videos, mp4Links, downloadBtns, thumbs, genIndicators, errors, recentText };
    });
    
    console.error(`[${elapsed}s] videos:${state.videos.length} mp4:${state.mp4Links.length} download:${state.downloadBtns.length} thumbs:${state.thumbs.length} gen:${state.genIndicators.length}`);
    
    if (state.errors.length > 0) {
      console.error('发现错误:', state.errors);
    }
    
    // 找到视频了！
    if (state.videos.length > 0 || state.mp4Links.length > 0) {
      videoResult = {
        success: true,
        videoSrc: state.videos[0]?.src || state.mp4Links[0] || '',
        poster: state.videos[0]?.poster || state.thumbs[0]?.src || '',
        downloadBtn: state.downloadBtns[0] || null
      };
      console.error('找到视频!', videoResult);
      break;
    }
    
    // 检查捕获的网络视频
    if (capturedVideos.length > 0) {
      videoResult = { success: true, videoSrc: capturedVideos[0], source: 'network' };
      console.error('通过网络捕获到视频!', videoResult);
      break;
    }
    
    // 每30秒截一次图
    if (elapsed % 30 === 0) {
      await page.screenshot({ path: `submit_wait_${elapsed}s.png` });
      // 输出最新页面文字片段
      console.error('页面最新内容:', state.recentText.slice(-300));
    }
    
    await page.waitForTimeout(5000);
  }
  
  // 最终截图
  await page.screenshot({ path: 'submit_final.png' });
  
  if (!videoResult) {
    // 最后一次尝试提取
    const finalState = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video')).map(v => ({
        src: v.src || v.currentSrc || '',
        poster: v.poster || ''
      }));
      const recentText = (document.body.innerText || '').slice(-3000);
      const allImgs = Array.from(document.querySelectorAll('img')).map(i => ({
        src: (i.src || '').slice(0, 200), w: i.naturalWidth, h: i.naturalHeight
      })).filter(i => i.w > 50);
      return { videos, recentText, allImgs: allImgs.slice(0, 10) };
    });
    
    console.log(JSON.stringify({
      success: false,
      reason: 'timeout_or_not_found',
      networkVideos: capturedVideos,
      finalState
    }, null, 2));
  } else {
    console.log(JSON.stringify(videoResult, null, 2));
  }
  
  await browser.close();
})().catch(e => {
  console.error('FATAL ERROR:', e.message);
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
