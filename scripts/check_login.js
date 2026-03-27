/**
 * 快速验证：检查登录状态 + 输入框是否可用
 */
const { chromium } = require('./node_modules/playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];

  await page.goto('https://www.doubao.com/chat/create-video', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(3000);

  // 检查登录状态
  const loginCheck = await page.evaluate(() => {
    const loginBtn = document.querySelector('.login-btn-head, [class*="login-btn"]');
    const hasLoginBtn = loginBtn && loginBtn.offsetParent !== null;
    const cookieLen = document.cookie.length;
    const pageText = document.body.innerText.slice(0, 200);
    return { hasLoginBtn, cookieLen, pageText, url: location.href };
  });

  console.log(JSON.stringify({ loginCheck }, null, 2));

  // 找输入框
  const inputSelectors = [
    '[contenteditable="true"][class*="editor"]',
    'div[contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea',
  ];

  for (const sel of inputSelectors) {
    const el = page.locator(sel).first();
    const visible = await el.isVisible().catch(() => false);
    if (visible) {
      console.log(JSON.stringify({ foundInput: sel }));
      break;
    }
  }

  await browser.close();
})().catch(e => {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
