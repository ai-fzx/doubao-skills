/**
 * 调试：检查豆包视频页面真实 DOM 结构（登录后）
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0];

    // 导航到视频生成页面
    process.stderr.write('导航到视频生成页面...\n');
    await page.goto('https://www.doubao.com/chat/create-video', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(4000);

    const url = page.url();
    process.stderr.write('当前URL: ' + url + '\n');

    // 检查登录状态
    const isLoggedIn = await page.evaluate(() => {
      const text = document.body.innerText;
      return !text.includes('登录') || document.cookie.includes('session') || document.cookie.includes('token');
    });
    process.stderr.write('疑似登录: ' + isLoggedIn + '\n');

    // 查找所有可编辑元素
    const editables = await page.evaluate(() => {
      const results = [];
      // contenteditable
      document.querySelectorAll('[contenteditable]').forEach(el => {
        results.push({
          type: 'contenteditable',
          tag: el.tagName,
          contenteditable: el.getAttribute('contenteditable'),
          placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
          visible: el.offsetParent !== null,
          cls: el.className.slice(0, 120),
          id: el.id || ''
        });
      });
      // textarea
      document.querySelectorAll('textarea').forEach(el => {
        results.push({
          type: 'textarea',
          tag: el.tagName,
          placeholder: el.placeholder || '',
          visible: el.offsetParent !== null,
          cls: el.className.slice(0, 120),
          id: el.id || ''
        });
      });
      return results;
    });
    console.log('=== 可编辑元素 ===');
    console.log(JSON.stringify(editables, null, 2));

    // 查找提交/发送按钮
    const sendBtns = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('button').forEach(el => {
        const text = el.textContent.trim();
        const ariaLabel = el.getAttribute('aria-label') || '';
        const cls = el.className || '';
        // 只取可能是发送的按钮
        if (text || ariaLabel || cls.includes('send') || cls.includes('submit') || el.type === 'submit') {
          results.push({
            text: text.slice(0, 30),
            type: el.type,
            ariaLabel,
            visible: el.offsetParent !== null,
            disabled: el.disabled,
            cls: cls.slice(0, 100),
            id: el.id || ''
          });
        }
      });
      return results;
    });
    console.log('\n=== 按钮列表 ===');
    console.log(JSON.stringify(sendBtns, null, 2));

    // 检查页面是否有 video 相关结构
    const videoInfo = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video'));
      return {
        videoCount: videos.length,
        videos: videos.map(v => ({ src: v.src, poster: v.poster, cls: v.className.slice(0, 80) }))
      };
    });
    console.log('\n=== 视频元素 ===');
    console.log(JSON.stringify(videoInfo, null, 2));

    // 页面主要文字
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 800));
    console.log('\n=== 页面文字（前800字）===');
    console.log(bodyText);

    await browser.close();
  } catch (e) {
    console.error('错误:', e.message);
    process.exit(1);
  }
})();
