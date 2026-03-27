/**
 * 观察豆包视频页面 UI 交互流程
 * 1. 导航到视频创作页
 * 2. 截图初始状态
 * 3. 找到输入框，填入提示词
 * 4. 截图填写后状态（不提交）
 * 5. 分析所有可点击元素和按钮
 */
const { chromium } = require('./node_modules/playwright');
const fs = require('fs');
const path = require('path');

const PROMPT = 'A chubby panda and tiger fighting, kung fu style, 5 seconds';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  
  // 找或创建目标页面
  let page;
  const pages = ctx.pages();
  
  // 先找已有的豆包视频页
  for (const p of pages) {
    const url = p.url();
    if (url.includes('doubao.com')) {
      page = p;
      console.error('复用已有豆包页面:', url);
      break;
    }
  }
  
  if (!page) {
    page = pages[0];
    console.error('使用第一个页面:', page.url());
  }
  
  // 导航到视频创作页
  console.error('导航到豆包视频创作页...');
  await page.goto('https://www.doubao.com/chat/create-video', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.error('当前URL:', page.url());
  
  // 截图初始状态
  await page.screenshot({ path: 'video_ui_01_initial.png', fullPage: false });
  console.error('截图01: 初始状态');
  
  // 分析初始页面 DOM
  const initial = await page.evaluate(() => {
    function safeClass(el) {
      try {
        const c = el.className;
        if (typeof c === 'string') return c.slice(0, 100);
        return String(c || '').slice(0, 100);
      } catch(e) { return ''; }
    }
    
    // 找所有输入框（textarea, contenteditable, input）
    const inputs = [];
    document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]').forEach(el => {
      if (el.offsetParent !== null) {
        inputs.push({
          tag: el.tagName,
          cls: safeClass(el),
          ph: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
          visible: el.offsetParent !== null
        });
      }
    });
    
    // 找所有按钮（可见的）
    const btns = [];
    document.querySelectorAll('button, [role="button"], [class*="btn"], [class*="submit"], [class*="send"]').forEach(el => {
      if (el.offsetParent !== null) {
        const text = (el.textContent || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (text || el.getAttribute('aria-label')) {
          btns.push({
            tag: el.tagName,
            text: text,
            aria: el.getAttribute('aria-label') || '',
            cls: safeClass(el),
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true'
          });
        }
      }
    });
    
    // 找选项/参数区域（时长、比例等）
    const selects = [];
    document.querySelectorAll('select, [role="combobox"], [role="listbox"], [class*="select"], [class*="option"], [class*="ratio"], [class*="duration"], [class*="size"]').forEach(el => {
      if (el.offsetParent !== null) {
        selects.push({
          tag: el.tagName,
          cls: safeClass(el),
          text: (el.textContent || '').trim().slice(0, 80)
        });
      }
    });
    
    // 找模式切换（文生视频 vs 图生视频）
    const tabs = [];
    document.querySelectorAll('[role="tab"], [class*="tab"], [class*="mode"], [class*="switch"]').forEach(el => {
      if (el.offsetParent !== null) {
        tabs.push({
          text: (el.textContent || '').trim().slice(0, 50),
          cls: safeClass(el),
          active: el.getAttribute('aria-selected') === 'true' || safeClass(el).includes('active') || safeClass(el).includes('selected')
        });
      }
    });
    
    // 页面主要文字（帮助理解页面内容）
    const bodyText = (document.body.innerText || '').slice(0, 2000);
    
    return { inputs, btns: btns.slice(0, 40), selects: selects.slice(0, 20), tabs: tabs.slice(0, 20), bodyText };
  });
  
  console.log(JSON.stringify({ step: 'initial_analysis', data: initial }, null, 2));
  
  await browser.close();
})().catch(e => {
  console.error('ERROR:', e.message);
  console.log(JSON.stringify({ error: e.message, stack: e.stack }));
  process.exit(1);
});
