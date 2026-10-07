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
  const until=Date.now()+15000;let lastError;while(Date.now()<until){try{if(await evaluate(expression))return;}catch(error){lastError=error;}await new Promise(r=>setTimeout(r,80));}throw new Error(`Native panel condition timed out: ${expression}${lastError ? '\n'+lastError.message : ''}`);
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
 const choose=async family=>{
  await panel.click('#search');await panel.command('Input.insertText',{text:family});
  await panel.wait(`!!document.querySelector('#results .result[data-family="${family}"]')`);
  await panel.click(`#results .result[data-family="${family}"]`);
  await panel.wait(`document.getElementById('steps').hidden && document.getElementById('pairs').textContent.includes('${family}')`);
 };
 await panel.wait("!document.getElementById('picking').hidden");
 const visibleURL=await worker.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].url);assert.equal(visibleURL,page.url());
 passed('production manifest toolbar gesture opens native panel and grants activeTab');
 await page.locator('h1').click();await panel.wait("document.getElementById('source-name').textContent!=='Pick font' && !document.getElementById('search').disabled");
 await choose('Lora');assert.match(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 assert.equal(await panel.evaluate("!!document.getElementById('apply') || !!document.getElementById('compare')"),false);
 await panel.click('.pair-edit');await panel.wait("!document.getElementById('steps').hidden && !document.getElementById('search').disabled");await panel.click('#search');await panel.command('Input.insertText',{text:'Inter'});
 await panel.wait(`!!document.querySelector('#results .result[data-family="Inter"]')`);
 await panel.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await panel.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await panel.wait("document.getElementById('steps').hidden && document.getElementById('pairs').textContent.includes('Inter')");
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),1);
 await panel.click('#undo');await panel.wait("document.querySelectorAll('.pair').length===0");assert.doesNotMatch(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 passed('native panel searches, applies instantly, edits by keyboard and undoes on public iana.org');
 await page.goto(fixtureURL);await trigger();await panel.wait("!document.getElementById('picking').hidden");
 await page.locator('#body').click();await panel.wait("document.getElementById('source-name').textContent==='Arial'");
 assert.match(await panel.evaluate("document.getElementById('warning-list').textContent"),/frames.*not accessible/i);
 await choose('Inter');await panel.click('#another');await page.locator('#generic').click();await panel.wait("document.getElementById('source-name').textContent==='monospace'");await choose('Lora');
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),2);
 assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.match(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 assert.doesNotMatch(await page.frameLocator('#cross').locator('#frame-text').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 passed('native panel adds simultaneous pairs while production permissions protect cross-origin frames');
 await panel.command('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
 assert.equal(await panel.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'320px panel overflow');
 await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});await panel.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const light=await panel.evaluate('getComputedStyle(document.body).backgroundColor');await panel.screenshot('panel-light.png');await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await panel.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.notEqual(await panel.evaluate('getComputedStyle(document.body).backgroundColor'),light);await panel.screenshot('panel-dark.png');
 passed('minimal two-pair panel fits 320px and renders light and dark themes');
 await panel.click('.pair-remove');await panel.wait("document.querySelectorAll('.pair').length===1");assert.doesNotMatch(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.match(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 await panel.click('#undo');await panel.wait("document.querySelectorAll('.pair').length===0");assert.equal(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),'monospace');
 passed('native panel removes one pair independently and Undo all restores the rest');
 await panel.click('#pick-source');await page.locator('#body').click();await panel.wait("!document.getElementById('pick-dest').hidden");await panel.click('#pick-dest');await page.locator('#generic').click();
 await panel.wait("document.getElementById('steps').hidden && document.getElementById('pairs').textContent.includes('monospace')");assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/^monospace,/);await panel.click('#undo');
 passed('native panel page-picked destination applies immediately and collapses to pair');
 await page.reload();await panel.wait("document.querySelectorAll('.pair').length===0 && !document.getElementById('steps').hidden");await panel.click('#pick-source');await page.keyboard.press('Escape');await panel.wait("document.getElementById('picking').hidden");passed('native panel reconnects after navigation and Escape cancels picker');
 await page.close();await browserCDP.detach();
}
