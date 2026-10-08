import assert from 'node:assert/strict';
import {attachPanel} from './native-panel.mjs';

export async function testFloatingPanel(context,worker,fixtureURL,passed) {
 await worker.evaluate(()=>new Promise((resolve,reject)=>{const deadline=Date.now()+5000;function ready(){if(chrome.action.onClicked.hasListeners())resolve();else if(Date.now()>deadline)reject(new Error('Toolbar listener not ready'));else setTimeout(ready,20);}ready();}));
 const page=await context.newPage();await page.goto(fixtureURL);await page.bringToFront();
 const id=new URL(worker.url()).host,cdp=await context.browser().newBrowserCDPSession();
 let tabId;
 const trigger=async()=>{
  const targets=await cdp.send('Target.getTargets',{filter:[{}]});const tab=targets.targetInfos.find(t=>t.type==='tab'&&t.url===page.url());
  await cdp.send('Extensions.triggerAction',{id,targetId:tab.targetId});
 };
 const nativePanel=async()=>{
  const end=Date.now()+10000;
  while(Date.now()<end){const target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/sidepanel.html`);if(target)return attachPanel(cdp,target.targetId);await page.waitForTimeout(50);}
  throw new Error('Docked panel did not open');
 };
 const inspect=async(selector='',property='')=>worker.evaluate(async args=>(await chrome.scripting.executeScript({target:{tabId:args.tabId},func:({selector,property})=>{
  const root=globalThis.__fontSwapPanelRoot;if(!root)return null;
  const host=root.host,element=selector?root.querySelector(selector):host;
  if(property==='point'){const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}
  if(property==='text')return element.textContent;
  if(property==='font')return getComputedStyle(element).fontFamily;
  if(property==='overflow')return element.scrollWidth>element.clientWidth;
  const rect=host.getBoundingClientRect();
  return {hidden:!rect.width,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,background:getComputedStyle(host).backgroundColor,rows:root.querySelectorAll('.pair').length,source:root.querySelector('.pair-from')?.textContent,destination:root.querySelector('.pair-to')?.textContent,editing:!root.getElementById('steps').hidden,picking:!root.getElementById('picking').hidden,loading:root.getElementById('note').classList.contains('is-loading'),note:root.getElementById('note').textContent,error:root.getElementById('error').textContent,spinner:getComputedStyle(root.getElementById('note'),'::before').animationName};
 },args:[args]}))[0].result,{tabId,selector,property});
 const wait=async predicate=>{const end=Date.now()+20000;let info;while(Date.now()<end){info=await inspect();if(predicate(info))return info;await page.waitForTimeout(40);}await page.screenshot({path:'test-results/floating-failure.png'});const title=await worker.evaluate(tabId=>chrome.action.getTitle({tabId}),tabId);throw new Error('Floating panel did not settle: '+JSON.stringify({info,title}));};
 const click=async selector=>page.mouse.click(...Object.values(await inspect(selector,'point')));
 const waitMode=mode=>worker.evaluate(async expected=>{const end=Date.now()+5000;while(Date.now()<end){if((await chrome.storage.local.get('panelMode')).panelMode===expected)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Panel mode was not saved: '+expected);},mode);
 const choose=async family=>{await click('#search');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type(family);await click(`.result[data-family="${family}"]`);await wait(info=>info && !info.editing && !info.loading);};
 const width=await page.evaluate(()=>innerWidth);
 await trigger();
 tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
 let docked=await nativePanel();await docked.wait("!document.getElementById('view-main').hidden");
 await docked.click('#mode-toggle');await wait(info=>info && !info.hidden && !info.picking);
 await waitMode('floating');
 assert.equal(await inspect('.panel','text').then(text=>text.includes('Notes') || text.includes('Origin is the first CSS family')),false);
 await click('.pair-source .pair-edit');
 await wait(info=>info?.picking);
 assert.equal(await page.evaluate(()=>innerWidth),width);
 assert.equal(await page.locator('[data-font-swap-panel]').count(),1);
 assert.equal(await page.locator('[data-font-swap-panel]').evaluate(e=>e.shadowRoot),null);
 assert.match(await inspect('.panel','font'),/system-ui/);
 passed('floating production build opens an isolated page panel without changing viewport width');
 await page.locator('#body').hover();assert.equal(await page.locator('[data-font-swap-tooltip]').textContent(),'Arial');
 await page.locator('#body').click();await wait(info=>info?.source==='Arial' && info.editing);
 await worker.evaluate(()=>{const original=fetch;let release;const gate=new Promise(resolve=>release=resolve);globalThis.__restoreFloatingFetch=()=>{globalThis.fetch=original;release();};globalThis.fetch=async(...args)=>{if(String(args[0]).startsWith('https://fonts.'))await gate;return original(...args);};});
 const choosing=choose('Inter');await wait(info=>info?.loading && info.note==='Loading Inter');
 assert.equal((await inspect()).spinner,'spin');await page.screenshot({path:'test-results/floating-loading.png'});
 await worker.evaluate(()=>globalThis.__restoreFloatingFetch());await choosing;
 assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 assert.equal((await inspect()).destination,'Inter');
 const uiFont=await inspect('.pair-to','font');assert.doesNotMatch(uiFont,/FontSwap_/);
 await click('.pair-edit');await wait(info=>info?.editing);await click('.pair-edit');await wait(info=>!info.editing);
 assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 passed('floating panel loads fonts with a spinner and keeps saved swaps when its accordion opens or closes');
 await click('#another');await wait(info=>info?.picking);await page.locator('#generic').click();await wait(info=>info?.rows===2 && info.editing);await choose('Lora');
 assert.equal((await inspect()).rows,2);assert.match(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 await click('.pair:nth-child(2) .pair-edit');await wait(info=>info?.editing);await click('#pick-dest');await wait(info=>info?.picking);
 await page.locator('#body').hover();assert.equal(await page.locator('[data-font-swap-tooltip]').textContent(),'Inter');assert.equal(await page.locator('#body').evaluate(e=>getComputedStyle(e).cursor),'pointer');
 await page.locator('#body').click();await wait(info=>info && !info.picking && !info.editing);
 assert.equal(await inspect('.pair:nth-child(2) .pair-to','text'),'Inter');
 passed('floating replacement picker uses page hover detection and applies the picked font instantly');
 const before=await inspect(),grip=await inspect('#move-panel','point');
 await page.mouse.move(grip.x,grip.y);await page.mouse.down();await page.mouse.move(grip.x-150,grip.y+80,{steps:5});await page.mouse.up();
 let after=await inspect();assert(after.left<before.left-100);assert(after.top>before.top+50);
 await click('#move-panel');await page.keyboard.press('ArrowRight');assert.equal(Math.round((await inspect()).left-after.left),10);
 await page.setViewportSize({width:360,height:640});after=await wait(info=>info && info.left>=8 && info.right<=352 && info.bottom<=632);assert.equal(await inspect('.panel','overflow'),false);
 await page.screenshot({path:'test-results/floating-narrow.png'});await page.setViewportSize({width:1280,height:900});
 passed('floating panel supports multiple swaps, pointer dragging, keyboard movement and viewport clamping');
 const fontBeforeDock=await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),genericBeforeDock=await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily);
 await click('#another');await wait(info=>info?.picking);await click('#mode-toggle');
 docked=await nativePanel();await docked.wait("document.querySelectorAll('.pair').length===2 && document.getElementById('picking').hidden");
 await wait(info=>info?.hidden);assert.equal(await page.locator('[data-font-swap-picker]').count(),0);
 assert.equal(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),fontBeforeDock);
 assert.equal(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),genericBeforeDock);
 await waitMode('sidepanel');
 assert.equal(await docked.evaluate("!!document.getElementById('warnings') || document.body.textContent.includes('Origin is the first CSS family')"),false);
 // Exercise the pre-Chrome 141 close fallback too.
 await worker.evaluate(()=>{globalThis.__sidePanelClose=chrome.sidePanel.close;chrome.sidePanel.close=undefined;});
 await docked.click('#mode-toggle');await wait(info=>info && !info.hidden && info.rows===2 && !info.picking);
 await worker.evaluate(()=>{chrome.sidePanel.close=globalThis.__sidePanelClose;});
 assert.equal(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),fontBeforeDock);
 assert.equal(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),genericBeforeDock);
 await waitMode('floating');
 assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(t=>t.url===`chrome-extension://${id}/sidepanel.html`),false);
 passed('one extension switches both ways, preserves multiple swaps, cancels picking and removes Notes; older close fallback works');
 await click('#another');await wait(info=>info?.picking);
 const uiPoint=await inspect('h1','point');await page.mouse.move(uiPoint.x,uiPoint.y);
 assert.equal(await page.locator('[data-font-swap-tooltip]').count(),0);
 await click('#cancel');await wait(info=>!info.picking);assert.equal((await inspect()).rows,2);
 await click('#another');await wait(info=>info?.picking);await page.keyboard.press('Escape');await wait(info=>!info.picking);assert.equal(await page.locator('[data-font-swap-picker]').count(),0);
 await click('#another');await wait(info=>info?.picking);await click('#close-panel');await wait(info=>info?.hidden);
 await page.waitForFunction(()=>!document.querySelector('[data-font-swap-picker]'));
 assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 await trigger();await wait(info=>info && !info.hidden && !info.picking);assert.equal((await inspect()).rows,2);assert.equal(await page.locator('[data-font-swap-panel]').count(),1);
 await click('#undo');await wait(info=>info?.source.includes('Pick from page'));assert.equal(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),'monospace');
 passed('floating controls are excluded from picking; close cancels picking and reopening preserves swaps');
 await page.goto(fixtureURL+'/strict-ui');await trigger();await wait(info=>info?.picking);
 assert.notEqual((await inspect()).background,'rgba(0, 0, 0, 0)');
 await page.locator('#body').click();await wait(info=>info?.editing);await choose('Inter');
 assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 await page.screenshot({path:'test-results/floating-strict.png'});
 const light=(await inspect()).background;await page.emulateMedia({colorScheme:'dark'});assert.notEqual((await inspect()).background,light);await page.screenshot({path:'test-results/floating-dark.png'});
 await click('#undo');await click('#close-panel');
 passed('floating controls and real font swaps work with frame-src none, style-src none and Trusted Types restrictions');
 await page.close();await cdp.detach();
}

export async function testRememberedMode(context,fixtureURL,passed) {
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host,cdp=await context.browser().newBrowserCDPSession();
 assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('panelMode')).panelMode),'floating');
 const page=await context.newPage();await page.goto(fixtureURL);await page.bringToFront();
 const targets=await cdp.send('Target.getTargets',{filter:[{}]});
 await cdp.send('Extensions.triggerAction',{id,targetId:targets.targetInfos.find(t=>t.type==='tab'&&t.url===page.url()).targetId});
 await page.waitForFunction(()=>document.querySelector('[data-font-swap-panel]')?.getBoundingClientRect().width>0);
 assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(t=>t.url===`chrome-extension://${id}/sidepanel.html`),false);
 passed('toolbar remembers floating mode after a browser restart in the same extension profile');
 await page.close();await cdp.detach();
}
