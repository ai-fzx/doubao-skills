/**
 * 找到发送按钮，截图分析，然后用新提示词提交
 */
const { chromium } = require('./node_modules/playwright');

// 新提示词：避开版权限制，用通用武侠/动作风格
const PROMPT = "两位武术高手在竹林中激烈对决，一人身穿白色武术服，一人身穿虎纹铠甲，双方拳脚相交，烟尘四起，竹叶飞散，慢动作特写，金色阳光，3D卡通动画风格，史诗级战斗场面，5秒短片";

const timer = setTimeout(() => {
  process.stdout.write(JSON.stringify({ error: 'timeout 20s' }) + '\n');
  process.exit(0);
}, 20000);

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    let page = pages.find(p => p.url().includes('doubao.com')) || pages[0];
    
    process.stderr.write('URL: ' + page.url() + '\n');
    
    // 截图当前状态
    await page.screenshot({ path: 'current_state.png' });
    
    // 分析所有可见的可交互元素
    const uiState = await page.evaluate(() => {
      // 找输入区域
      const inputEl = document.querySelector('[contenteditable="true"][class*="editor"]');
      
      // 找输入框的父容器
      let inputContainer = null;
      if (inputEl) {
        let el = inputEl;
        for (let i = 0; i < 5; i++) {
          el = el.parentElement;
          if (!el) break;
          const rect = el.getBoundingClientRect();
          if (rect.width > 400 && rect.height > 60) {
            inputContainer = {
              class: el.className.slice(0, 150),
              rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
            };
            break;
          }
        }
      }
      
      // 找输入框附近的所有按钮（通过坐标关系）
      const inputRect = inputEl ? inputEl.getBoundingClientRect() : null;
      const nearbyBtns = [];
      
      if (inputRect) {
        document.querySelectorAll('button, [role="button"], svg[class*="send"], svg[class*="submit"]').forEach(el => {
          if (!el.offsetParent) return;
          const rect = el.getBoundingClientRect();
          // 只要在输入框附近500px内的
          const dist = Math.sqrt(
            Math.pow(rect.x - inputRect.x, 2) + Math.pow(rect.y - inputRect.y, 2)
          );
          if (dist < 500) {
            nearbyBtns.push({
              tag: el.tagName,
              class: el.className.slice(0, 100),
              text: el.textContent.trim().slice(0, 30),
              aria: el.getAttribute('aria-label') || '',
              disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
              dist: Math.round(dist)
            });
          }
        });
      }
      
      nearbyBtns.sort((a, b) => a.dist - b.dist);
      
      return {
        inputFound: !!inputEl,
        inputRect: inputRect ? { x: Math.round(inputRect.x), y: Math.round(inputRect.y), w: Math.round(inputRect.width), h: Math.round(inputRect.height) } : null,
        inputContainer,
        nearbyBtns: nearbyBtns.slice(0, 15)
      };
    });
    
    clearTimeout(timer);
    process.stdout.write(JSON.stringify(uiState, null, 2) + '\n');
    await browser.close().catch(() => {});
    process.exit(0);
  } catch (e) {
    clearTimeout(timer);
    process.stdout.write(JSON.stringify({ error: e.message }) + '\n');
    process.exit(0);
  }
})();
