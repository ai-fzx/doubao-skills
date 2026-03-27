/**
 * 调试脚本：检查豆包视频页面的真实 DOM 结构
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0];

    // 导航到视频生成页面
    console.error('导航到视频生成页面...');
    await page.goto('https://www.doubao.com/chat/create-video', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(4000);

    const url = page.url();
    console.error('当前URL:', url);

    // 检查输入框
    const inputs = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('textarea, [contenteditable], input'));
      return els.slice(0, 10).map(e => ({
        tag: e.tagName,
        type: e.type || '',
        placeholder: e.placeholder || e.getAttribute('placeholder') || '',
        visible: e.offsetParent !== null,
        cls: e.className.slice(0, 100)
      }));
    });
    console.error('输入框:', JSON.stringify(inputs, null, 2));

    // 检查按钮
    const btns = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button'));
      return els.slice(0, 25).map(e => ({
        text: e.textContent.trim().slice(0, 40),
        type: e.type,
        ariaLabel: e.getAttribute('aria-label') || '',
        cls: e.className.slice(0, 80)
      }));
    });
    console.error('按钮:', JSON.stringify(btns, null, 2));

    // 检查页面关键元素
    const body = await page.evaluate(() => {
      return document.body.innerText.slice(0, 500);
    });
    console.error('页面文字:', body);

    await browser.close();
  } catch (e) {
    console.error('错误:', e.message);
  }
})();
