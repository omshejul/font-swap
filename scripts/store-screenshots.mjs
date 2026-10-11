// Capture the real packaged extension in a temporary browser, not a simulated UI.
import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'store/assets');await mkdir(output,{recursive:true});
const source=await readFile(path.join(root,'website/demo.html'),'utf8');
const demo=source.replaceAll('Georgia','Lora').replaceAll('Arial','DM Sans').replace('</head>',`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=Lora:wght@400&display=swap"><style>body{padding-top:148px}header{padding-top:24px;padding-bottom:24px}main{margin-top:42px}.store-caption{position:absolute;inset:0 0 auto;background:#202124;color:#fff;height:148px;padding:34px 48px;font:600 54px/1.15 system-ui,sans-serif;letter-spacing:-1.5px}.art{margin-top:28px;height:152px}footer{margin-top:18px}.comparison{display:grid;grid-template-columns:368px 368px;gap:24px}.comparison-label{font:500 16px/1.4 system-ui,sans-serif;color:#5b6259;margin:0 0 18px}.comparison img{display:block;width:368px}.comparison h1{font-size:53px!important;width:368px;margin-bottom:0}</style></head>`).replace('<body>','<body><div class="store-caption">Click text to pick its font</div>');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(demo);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const temp=await mkdtemp(path.join(os.tmpdir(),'swapfont-store-'));
let context;const watchdog=setTimeout(()=>process.exit(1),280000);
try{
 const executablePath=process.env.CHROME_PATH || '/Users/omshejul/.cache/puppeteer/chrome/mac_arm-152.0.7977.75/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath,headless:true,viewport:{width:1280,height:800},deviceScaleFactor:1,colorScheme:'light',args:['--enable-unsafe-extension-debugging',`--disable-extensions-except=${path.join(root,'extension')}`,`--load-extension=${path.join(root,'extension')}`]});
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({panelMode:'floating'}));
 await worker.evaluate(()=>new Promise((resolve,reject)=>{const until=Date.now()+5000;function ready(){if(chrome.action.onClicked.hasListeners())resolve();else if(Date.now()>until)reject(new Error('Toolbar not ready'));else setTimeout(ready,20);}ready();}));
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/demo`);await page.bringToFront();
 const cdp=await context.browser().newBrowserCDPSession();
 const targets=await cdp.send('Target.getTargets',{filter:[{}]});
 const target=targets.targetInfos.find(t=>t.type==='tab' && t.url===page.url());
 await cdp.send('Extensions.triggerAction',{id:new URL(worker.url()).host,targetId:target.targetId});
 await page.evaluate(()=>document.fonts.ready);
 await page.locator('#heading').evaluate(e=>{e.style.fontSize='53px';e.style.width='368px';});
 const beforeHeading=await page.locator('#heading').screenshot();
 await page.locator('#heading').evaluate(e=>{e.style.removeProperty('font-size');e.style.removeProperty('width');});
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url());
 const inspect=(selector='',point=false)=>worker.evaluate(async args=>(await chrome.scripting.executeScript({target:{tabId:args.tabId},func:({selector,point})=>{
  const root=globalThis.__fontSwapPanelRoot;if(!root)return null;
  if(selector){const e=root.querySelector(selector);if(!e)return null;if(point){const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}return e.textContent;}
  return{picking:root.getElementById('view-main').dataset.picking,editing:!root.getElementById('steps').hidden,source:root.querySelector('.pair-from')?.textContent,dest:root.querySelector('.pair-to')?.textContent,rows:root.querySelectorAll('.pair').length,loading:root.getElementById('note').classList.contains('is-loading'),error:root.getElementById('error').textContent};
 },args:[args]}))[0].result,{tabId,selector,point});
 const wait=async check=>{const until=Date.now()+25000;let s;while(Date.now()<until){s=await inspect();if(check(s))return s;await page.waitForTimeout(60);}throw new Error('Screenshot state failed: '+JSON.stringify(s));};
 const click=async selector=>{const p=await inspect(selector,true);assert(p,selector);await page.mouse.click(p.x,p.y);};
 const shot=async(name,caption)=>{if(caption)await page.locator('.store-caption').evaluate((e,text)=>e.textContent=text,caption);await page.screenshot({path:path.join(output,name),fullPage:false});console.log('Captured',name);};
 const choose=async family=>{await click('#search');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type(family);for(let i=0;i<60;i++){if(await inspect(`.result[data-family="${family}"]`))break;await page.waitForTimeout(50);}await click(`.result[data-family="${family}"]`);await wait(s=>s&&!s.editing&&!s.loading);await page.mouse.move(850,730);};
 await wait(s=>s?.picking==='source');
 const grip=await inspect('#move-panel',true);await page.mouse.move(grip.x,grip.y);await page.mouse.down();await page.mouse.move(grip.x,grip.y+164,{steps:8});await page.mouse.up();
 await page.locator('#heading').hover();
 assert.equal(await page.locator('[data-font-swap-tooltip]').textContent(),'Lora');await shot('02-pick-a-font.png','Click text to pick its font');
 await page.locator('#heading').click();await wait(s=>s?.source==='Lora'&&s.editing);
 await click('#search');await page.keyboard.type('Space Grotesk');for(let i=0;i<60;i++){if(await inspect('.result[data-family="Space Grotesk"]'))break;await page.waitForTimeout(50);}await page.mouse.move(850,730);await shot('03-choose-a-font.png','Choose a Google Font');
 await choose('Space Grotesk');assert.match(await page.locator('#heading').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 await page.evaluate(data=>{const heading=document.getElementById('heading'),comparison=document.createElement('div');comparison.className='comparison';comparison.innerHTML=`<div><p class="comparison-label">Before</p><img alt="The same heading in Lora" src="data:image/png;base64,${data}"></div><div class="after"><p class="comparison-label">After</p></div>`;heading.before(comparison);comparison.querySelector('.after').append(heading);},beforeHeading.toString('base64'));
 await shot('01-before-after.png','Same page, new font');
 await page.evaluate(()=>{const comparison=document.querySelector('.comparison');comparison.before(document.getElementById('heading'));comparison.remove();});
 await shot('04-remember-this-site.png','Remember this site, if you want');
 await click('#another');await wait(s=>s?.picking==='source');await page.locator('#body').click();await wait(s=>s?.rows===2&&s.editing);await choose('Lora');assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);await shot('05-multiple-swaps.png','Add more fonts. Undo in one click.');
 await writeFile(path.join(output,'capture.json'),JSON.stringify({version:JSON.parse(await readFile(path.join(root,'extension/manifest.json'),'utf8')).version,browser:await context.browser().version(),size:{width:1280,height:800},source:'Real production extension on website/demo.html, using Google Fonts Lora and DM Sans. Before heading is an unmodified capture of the same text.',capturedAt:new Date().toISOString()},null,2));
}finally{clearTimeout(watchdog);if(context)await context.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
