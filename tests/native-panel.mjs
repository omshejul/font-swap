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
 const targets=await browserCDP.send('Target.getTargets',{filter:[{}]});const tab=targets.targetInfos.find(t=>t.type==='tab'&&t.url===page.url());
 await browserCDP.send('Extensions.triggerAction',{id,targetId:tab.targetId});
 let panelTarget;
 for(let i=0;i<50;i++){panelTarget=(await browserCDP.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/sidepanel.html`);if(panelTarget)break;await page.waitForTimeout(80);}
 assert(panelTarget,'Native Chrome side panel did not open');
 const panel=await attachPanel(browserCDP,panelTarget.targetId);
 await panel.wait("!document.getElementById('picking').hidden");
 const visibleURL=await worker.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].url);assert.equal(visibleURL,page.url());
 passed('production manifest toolbar gesture opens native panel and grants activeTab');
 await page.locator('h1').click();await panel.wait("document.getElementById('source-input').value.length>0 && !document.getElementById('view-editor').hidden");
 await panel.click('#dest-input');await panel.command('Input.insertText',{text:'Lora'});
 await panel.wait("!!document.querySelector('#dest-results button[data-family=\"Lora\"]')");await panel.click('#dest-results button[data-family="Lora"]');
 await panel.wait("document.getElementById('dest-input').value==='Lora' && !document.getElementById('apply').disabled");
 assert.match(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 await panel.command('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
 assert.equal(await panel.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'320px panel overflow');
 await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});await panel.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const light=await panel.evaluate('getComputedStyle(document.body).backgroundColor');await panel.screenshot('panel-light.png');await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await panel.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.notEqual(await panel.evaluate('getComputedStyle(document.body).backgroundColor'),light);await panel.screenshot('panel-dark.png');
 await panel.click('#apply');await panel.wait("document.getElementById('status').textContent==='Applied'");
 await panel.click('#compare');await panel.wait("document.getElementById('compare').getAttribute('aria-pressed')==='true'");assert.doesNotMatch(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 await panel.click('#compare');await panel.wait("document.getElementById('compare').getAttribute('aria-pressed')==='false'");await panel.click('#undo');await panel.wait("document.getElementById('status').textContent==='Original fonts restored'");assert.doesNotMatch(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 passed('native panel search, preview, Apply, Compare and Undo on public iana.org');passed('native panel fits 320px and renders light and dark themes');
 await page.goto(fixtureURL);const nextTab=(await browserCDP.send('Target.getTargets',{filter:[{}]})).targetInfos.find(t=>t.type==='tab'&&t.url===page.url());await browserCDP.send('Extensions.triggerAction',{id,targetId:nextTab.targetId});
 await panel.wait("!document.getElementById('picking').hidden");
 await page.locator('#body').click();await panel.wait("document.getElementById('source-input').value==='Arial'");
 assert.match(await panel.evaluate("document.getElementById('warnings').textContent"),/frames.*not accessible/i);
 // The production grant permits the selected origin, not localhost's other origin.
 const crossFamily=await page.frameLocator('#cross').locator('#frame-text').evaluate(e=>getComputedStyle(e).fontFamily);assert.doesNotMatch(crossFamily,/FontSwap_/);
 await panel.click('#dest-input');await panel.command('Input.insertText',{text:'Inter'});await panel.wait("!!document.querySelector('#dest-results button[data-family=\"Inter\"]')");await panel.click('#dest-results button[data-family="Inter"]');await panel.wait("document.getElementById('dest-input').value==='Inter' && !document.getElementById('undo').disabled");
 assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.doesNotMatch(await page.frameLocator('#cross').locator('#frame-text').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);await panel.click('#undo');
 passed('production activeTab grant leaves unpermitted cross-origin frame unchanged and warns');
 await page.reload();await panel.wait("!document.getElementById('view-empty').hidden");await panel.click('#empty-pick');await page.keyboard.press('Escape');await panel.wait("document.getElementById('picking').hidden");passed('native panel reconnects after navigation and Escape cancels picker');
 await page.close();await browserCDP.detach();
}
