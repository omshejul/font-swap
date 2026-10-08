import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

export async function attachPanel(browserCDP,targetId) {
 const {sessionId}=await browserCDP.send('Target.attachToTarget',{targetId,flatten:false});
 let nextId=0;const waiting=new Map();
 browserCDP.on('Target.receivedMessageFromTarget',event=>{
  if(event.sessionId!==sessionId)return;const result=JSON.parse(event.message);const waiter=waiting.get(result.id);if(!waiter)return;
  waiting.delete(result.id);clearTimeout(waiter.timer);result.error?waiter.reject(new Error(result.error.message)):waiter.resolve(result.result);
 });
 const command=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++nextId;const timer=setTimeout(()=>{waiting.delete(id);reject(new Error(`Native panel ${method} timed out`));},20000);
  waiting.set(id,{resolve,reject,timer});browserCDP.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);
 });
 const evaluate=async expression=>{
  const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);return result.result.value;
 };
 const click=async selector=>{
  const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e || e.disabled || e.hidden)throw new Error('Missing or disabled control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
 };
 const wait=async expression=>{
  const until=Date.now()+15000;let lastError;while(Date.now()<until){try{if(await evaluate(expression))return;}catch(error){lastError=error;}await new Promise(r=>setTimeout(r,80));}
  const details=await evaluate("JSON.stringify({text:document.body.innerText,search:document.getElementById('search')?.value,focus:document.activeElement?.id,trace:window.__fontTrace})").catch(()=>'');
  await screenshot('native-panel-failure.png').catch(()=>{});
  throw new Error(`Native panel condition timed out: ${expression}${lastError ? '\n'+lastError.message : ''}\n${details}`);
 };
 const screenshot=async filename=>{
  const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await mkdir('test-results',{recursive:true});await writeFile(`test-results/${filename}`,Buffer.from(data,'base64'));
 };
 return {command,evaluate,click,wait,screenshot};
}
export async function testNativePanel(context,worker,fixtureURL,passed) {
 const page=await context.newPage();await page.goto('https://www.iana.org/domains/reserved');await page.bringToFront();
 const id=new URL(worker.url()).host;const browserCDP=await context.browser().newBrowserCDPSession();
 const trigger=async()=>{
  const targets=await browserCDP.send('Target.getTargets',{filter:[{}]});const tab=targets.targetInfos.find(t=>t.type==='tab'&&t.url===page.url());
  await browserCDP.send('Extensions.triggerAction',{id,targetId:tab.targetId});
 };
 await trigger();
 let panelTarget;
 for(let i=0;i<50;i++){panelTarget=(await browserCDP.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/sidepanel.html`);if(panelTarget)break;await page.waitForTimeout(80);}
 assert(panelTarget,'Native Chrome side panel did not open');
 const panel=await attachPanel(browserCDP,panelTarget.targetId);
 await panel.evaluate(`(()=>{window.__fontTrace=[];const brief=s=>s&&({source:s.source,destination:s.destination?.family,picking:s.picking,status:s.status,rules:s.rules?.length});const log=(kind,action,s)=>{window.__fontTrace.push({at:Math.round(performance.now()),kind,action,state:brief(s)});window.__fontTrace=window.__fontTrace.slice(-35);};chrome.runtime.onMessage.addListener(m=>{if(m.type==='STATE_CHANGED')log('event','changed',m.state);});const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async m=>{log('send',m.action);const r=await send(m);log('response',m.action,r?.state);return r;};})()`);
 const choose=async (family,refreshDuringClick=false)=>{
  await panel.click('#search');await panel.command('Input.insertText',{text:family});
  await panel.wait(`!!document.querySelector('#results .result[data-family="${family}"]')`);
  if(refreshDuringClick) {
   const current=await panel.evaluate("(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return (await chrome.runtime.sendMessage({type:'PANEL',action:'state',tabId:tab.id})).state;})()");
   const point=await panel.evaluate(`(()=>{window.__pressedResult=document.querySelector('#results .result[data-family="${family}"]');const r=window.__pressedResult.getBoundingClientRect();chrome.runtime.onMessage.addListener(m=>{if(m.testRefresh)window.__refreshSeen=true;});return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   await panel.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
   await worker.evaluate(message=>chrome.runtime.sendMessage(message).catch(()=>{}),{type:'STATE_CHANGED',tabId:current.tabId,state:current,testRefresh:true});
   await panel.wait('window.__refreshSeen');
   assert.equal(await panel.evaluate(`window.__pressedResult===document.querySelector('#results .result[data-family="${family}"]')`),true,'Page refresh replaced the pressed result');
   await panel.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  } else await panel.click(`#results .result[data-family="${family}"]`);
  await panel.wait(`document.getElementById('steps').hidden && document.getElementById('pairs').textContent.includes('${family}')`);
 };
 await panel.wait("!document.getElementById('picking').hidden");
 const visibleURL=await worker.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].url);assert.equal(visibleURL,page.url());
 passed('production manifest toolbar gesture opens native panel and grants activeTab');
 await page.locator('h1').click();await panel.wait("document.querySelector('.pair-pending') && !document.getElementById('search').disabled");
 assert.equal(await panel.evaluate("document.querySelector('.pair-pending .pair-to').textContent"),'Choose font');
 await panel.click('.pair-pending .pair-edit');await panel.wait("document.getElementById('steps').hidden");
 await panel.click('.pair-pending .pair-edit');await panel.wait("!document.getElementById('steps').hidden");
 await choose('Lora',true);assert.match(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 passed('a page state update between native pointer press and release preserves the result and applies the font');
 assert.equal(await panel.evaluate("!!document.getElementById('apply') || !!document.getElementById('compare')"),false);
 const appliedFont=await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily);
 await panel.click('.pair-edit');await panel.wait("!!document.querySelector('.pair-body:not([hidden]) #steps') && !document.getElementById('search').disabled");
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),1);
 assert.equal(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),appliedFont);
 await panel.click('.pair-edit');await panel.wait("document.getElementById('steps').hidden && document.querySelector('.pair-edit').getAttribute('aria-expanded')==='false'");
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),1);
 assert.equal(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),appliedFont);
 await panel.click('.pair-edit');await panel.wait("!!document.querySelector('.pair-body:not([hidden]) #steps') && !document.getElementById('search').disabled");
 passed('saved pair opens and closes inline without removing the pair or changing the applied font');
 await panel.click('#search');await panel.command('Input.insertText',{text:'Inter'});
 await panel.wait(`!!document.querySelector('#results .result[data-family="Inter"]')`);
 await panel.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await panel.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await panel.wait("document.getElementById('steps').hidden && document.getElementById('pairs').textContent.includes('Inter')");
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),1);
 await panel.click('#undo');await panel.wait("!!document.querySelector('.pair-source:not(.pair-awaiting)')");assert.doesNotMatch(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 passed('native panel searches, applies instantly, edits by keyboard and undoes on public iana.org');
 assert.equal(await panel.evaluate("!!document.getElementById('intro') || !!document.getElementById('pick-source')"),false);
 assert.equal(await panel.evaluate("document.querySelector('.pair-source .pair-remove').hidden"),true);
 assert.equal(await panel.evaluate("getComputedStyle(document.querySelector('.pair-source .pair-from'),'::after').animationName"),'none');
 await panel.click('.pair-source .pair-edit');await panel.wait("!!document.querySelector('.pair-awaiting')");
 assert.equal(await page.locator('[data-font-swap-picker]').count(),1);
 await panel.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await panel.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await panel.wait("!!document.querySelector('.pair-source:not(.pair-awaiting)') && document.getElementById('picking').hidden");
 assert.equal(await page.locator('[data-font-swap-picker]').count(),0);
 passed('empty panel reuses the Pick from page row; clicking starts picking and Escape leaves it idle without an intro screen');
 await page.goto(fixtureURL);await trigger();await panel.wait("!document.getElementById('picking').hidden");
 await page.locator('#body').click();await panel.wait("document.querySelector('.pair-pending .pair-from')?.textContent==='Arial'");
 assert.match(await panel.evaluate("document.getElementById('warning-list').textContent"),/frames.*not accessible/i);
 await choose('Inter');await panel.click('#another');await panel.wait("!!document.querySelector('.pair-awaiting .pair-body #picking')");
 assert.equal(await panel.evaluate("getComputedStyle(document.querySelector('.pair-awaiting .pair-from')).borderStyle"),'dashed');
 assert.equal(await panel.evaluate("document.querySelector('.pair-awaiting .pair-from').textContent"),'Pick from page');
 await panel.click('.pair-awaiting .pair-from');assert.equal(await panel.evaluate("document.getElementById('picking').hidden"),false);
 await panel.command('Emulation.setDeviceMetricsOverride',{width:240,height:800,deviceScaleFactor:1,mobile:false});
 assert.equal(await panel.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
 assert.equal(await panel.evaluate("document.querySelector('.pair-awaiting .pair-to').scrollWidth<=document.querySelector('.pair-awaiting .pair-to').clientWidth"),true);
 assert.notEqual(await panel.evaluate("getComputedStyle(document.querySelector('.pair-awaiting .pair-from'),'::after').animationName"),'none');
 await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 assert.equal(await panel.evaluate("getComputedStyle(document.querySelector('.pair-awaiting .pair-from'),'::after').animationName"),'none');
 await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await panel.command('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),2);
 await panel.click('#cancel');await panel.wait("!document.querySelector('.pair-awaiting')");
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),1);
 assert.equal(await panel.evaluate("document.querySelector('.pair-edit').getAttribute('aria-expanded')"),'false');
 passed('adding a font opens a blinking dashed source placeholder that wraps at 240px with picking controls inside its accordion; Cancel preserves swaps');
 await panel.click('#another');await page.locator('#generic').click();await panel.wait("!!document.querySelector('.pair-pending')");
 const beforeDiscard=await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily);
 await panel.click('.pair-pending .pair-remove');await panel.wait("!document.querySelector('.pair-pending')");
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),1);
 assert.equal(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),beforeDiscard);
 passed('pending row opens, closes and discards without affecting an applied swap');
 await panel.click('#another');await page.locator('#generic').click();await panel.wait("document.querySelector('.pair-pending .pair-from')?.textContent==='monospace'");await choose('Lora');
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),2);
 assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.match(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 assert.doesNotMatch(await page.frameLocator('#cross').locator('#frame-text').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 passed('native panel adds simultaneous pairs while production permissions protect cross-origin frames');
 const bodyFont=await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily);const genericFont=await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily);
 await panel.click('.pair:nth-child(1) .pair-edit');await panel.wait("!!document.querySelector('.pair:nth-child(1) .pair-body:not([hidden]) #steps')");
 await panel.click('.pair:nth-child(2) .pair-edit');await panel.wait("!!document.querySelector('.pair:nth-child(2) .pair-body:not([hidden]) #steps')");
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair-edit[aria-expanded=true]').length"),1);
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),2);
 assert.equal(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),bodyFont);assert.equal(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),genericFont);
 passed('switching accordion rows keeps both swaps applied and expands one editor at a time');
 await panel.command('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
 assert.equal(await panel.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'320px panel overflow');
 await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});await panel.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const light=await panel.evaluate('getComputedStyle(document.body).backgroundColor');await panel.screenshot('panel-light.png');await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await panel.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.notEqual(await panel.evaluate('getComputedStyle(document.body).backgroundColor'),light);await panel.screenshot('panel-dark.png');
 await panel.click('#warnings summary');assert.equal(await panel.evaluate("document.getElementById('warnings').open"),true);
 await panel.command('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await panel.command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
 await panel.wait("!document.getElementById('warnings').open");
 passed('expanded two-pair accordion fits 320px and renders light and dark themes');
 await panel.click('.pair-remove');await panel.wait("document.querySelectorAll('.pair').length===1");assert.doesNotMatch(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.match(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 await panel.click('#undo');await panel.wait("!!document.querySelector('.pair-source:not(.pair-awaiting)')");assert.equal(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),'monospace');
 passed('native panel removes one pair independently and Undo all restores the rest');
 await panel.click('.pair-source .pair-edit');await page.locator('#body').click();await panel.wait("!document.getElementById('pick-dest').hidden");await panel.click('#pick-dest');await page.locator('#generic').click();
 await panel.wait("document.getElementById('steps').hidden && document.getElementById('pairs').textContent.includes('monospace')");assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/^monospace,/);await panel.click('#undo');
 passed('native panel page-picked destination applies immediately and collapses to pair');
 await page.reload();await panel.wait("!!document.querySelector('.pair-source:not(.pair-awaiting)')");await panel.click('.pair-source .pair-edit');await page.keyboard.press('Escape');await panel.wait("document.getElementById('picking').hidden");passed('native panel reconnects after navigation and Escape cancels picker');
 await page.close();await browserCDP.detach();
}
