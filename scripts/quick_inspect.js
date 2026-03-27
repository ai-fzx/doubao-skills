/**
 * 快速检查页面状态 - 5秒超时
 */
const { chromium } = require('./node_modules/playwright');

const timeout = setTimeout(() => {
  console.log(JSON.stringify({ error: 'timeout after 5s' }));
  process.exit(0);
}, 5000);

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    
    const results = [];
    for (const page of pages) {
      results.push({ url: page.url(), title: await page.title().catch(() => '') });
    }
    
    clearTimeout(timeout);
    console.log(JSON.stringify({ pages: results }));
    process.exit(0);
  } catch (e) {
    clearTimeout(timeout);
    console.log(JSON.stringify({ error: e.message }));
    process.exit(0);
  }
})();
