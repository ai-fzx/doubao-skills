/**
 * inspect_video_ui.js
 * 检查豆包视频生成页面的完整UI结构
 * 修复：不调用 browser.close()，保持Chrome不关闭
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function inspectVideoUI() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  
  let page;
  // 找到豆包页面或新建一个
  for (const p of pages) {
    const url = p.url();
    if (url.includes('doubao.com')) {
      page = p;
      break;
    }
  }
  
  if (!page) {
    page = await context.newPage();
  }

  const scriptDir = path.dirname(require.resolve('./inspect_video_ui.js') || __filename);
  const outDir = path.join(__dirname);

  try {
    // 导航到视频创建页面
    console.log('Navigating to create-video page...');
    await page.goto('https://www.doubao.com/chat/create-video', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    await page.waitForTimeout(3000);
    
    // 截图1：初始状态
    await page.screenshot({ path: path.join(outDir, 'ui_01_initial.png'), fullPage: false });
    console.log('Screenshot 1 taken');
    
    // 收集页面完整UI信息
    const uiInfo = await page.evaluate(() => {
      const safeClass = (el) => {
        try {
          if (!el.className) return '';
          if (typeof el.className === 'string') return el.className;
          if (el.className.baseVal !== undefined) return el.className.baseVal;
          return String(el.className);
        } catch(e) { return ''; }
      };
      
      const safeText = (el) => {
        try { return (el.textContent || '').trim().slice(0, 80); } catch(e) { return ''; }
      };
      
      // 所有按钮
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).map(el => ({
        tag: el.tagName,
        text: safeText(el),
        aria: el.getAttribute('aria-label') || '',
        cls: safeClass(el).slice(0, 100),
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        visible: el.offsetParent !== null || el.getBoundingClientRect().width > 0
      })).filter(b => b.visible);
      
      // 所有输入框（包括contenteditable）
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).map(el => ({
        tag: el.tagName,
        type: el.type || '',
        placeholder: el.getAttribute('placeholder') || '',
        cls: safeClass(el).slice(0, 100),
        contenteditable: el.getAttribute('contenteditable') || '',
        visible: el.offsetParent !== null
      }));
      
      // 查找所有下拉/选择器/标签页元素
      const selects = Array.from(document.querySelectorAll('select, [role="listbox"], [role="combobox"], [role="option"], [role="tab"], [role="tablist"]')).map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        text: safeText(el),
        cls: safeClass(el).slice(0, 80),
        visible: el.offsetParent !== null
      })).filter(s => s.visible);
      
      // 查找时长/比例相关文本
      const allDivs = Array.from(document.querySelectorAll('div, span, label')).filter(el => {
        const text = safeText(el);
        return text.match(/\d秒|比例|时长|duration|ratio|seconds|16:9|9:16|1:1|4:3|fast|standard|高质|快速|生成|创作/i) && 
               el.offsetParent !== null;
      }).map(el => ({
        tag: el.tagName,
        text: safeText(el),
        cls: safeClass(el).slice(0, 80),
        children: el.children.length
      })).slice(0, 30);
      
      // 查找下拉/选择器相关class名
      const dropdowns = Array.from(document.querySelectorAll('[class*="select"], [class*="dropdown"], [class*="picker"], [class*="ratio"], [class*="duration"], [class*="model"]')).filter(el => el.offsetParent !== null).map(el => ({
        tag: el.tagName,
        cls: safeClass(el).slice(0, 100),
        text: safeText(el),
        ariaLabel: el.getAttribute('aria-label') || ''
      })).slice(0, 20);
      
      // 底部工具栏分析
      const toolbars = Array.from(document.querySelectorAll('[class*="toolbar"], [class*="bottom"], [class*="footer"], [class*="action"], [class*="tool"]'))
        .filter(el => el.offsetParent !== null)
        .map(el => ({
          cls: safeClass(el).slice(0, 100),
          text: safeText(el).slice(0, 100),
          children: el.children.length
        })).slice(0, 15);

      // 当前URL
      const currentUrl = window.location.href;
      
      return { buttons, inputs, selects, allDivs, dropdowns, toolbars, currentUrl };
    });
    
    fs.writeFileSync(path.join(outDir, 'ui_info.json'), JSON.stringify(uiInfo, null, 2));
    console.log('UI info saved');
    console.log('URL:', uiInfo.currentUrl);
    console.log('Buttons count:', uiInfo.buttons.length);
    console.log('Inputs count:', uiInfo.inputs.length);
    console.log('Selects/Tabs count:', uiInfo.selects.length);
    console.log('Duration/Ratio divs:', uiInfo.allDivs.length);
    console.log('Dropdowns:', uiInfo.dropdowns.length);
    
    // 打印时长/比例相关元素
    if (uiInfo.allDivs.length > 0) {
      console.log('\n=== Duration/Ratio Elements ===');
      uiInfo.allDivs.forEach(d => console.log(JSON.stringify(d)));
    }
    
    // 打印下拉元素
    if (uiInfo.dropdowns.length > 0) {
      console.log('\n=== Dropdown Elements ===');
      uiInfo.dropdowns.forEach(d => console.log(JSON.stringify(d)));
    }
    
    // 打印按钮
    console.log('\n=== Visible Buttons ===');
    uiInfo.buttons.forEach(b => console.log(JSON.stringify(b)));
    
    // 打印输入框
    console.log('\n=== Inputs ===');
    uiInfo.inputs.forEach(i => console.log(JSON.stringify(i)));
    
  } catch (err) {
    console.error('Error:', err.message);
    const errFile = path.join(outDir, 'ui_error.txt');
    fs.writeFileSync(errFile, err.stack || err.message);
  }
  
  // 关键：不调用 browser.close()，保持Chrome活跃
  console.log('\nDone. Chrome session kept alive.');
}

inspectVideoUI().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
