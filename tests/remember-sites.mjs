import assert from 'node:assert/strict';

export async function testSavedSites(context,worker,page,panel,fixtureURL,passed) {
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
 const send=(action,payload={})=>panel.evaluate(message=>chrome.runtime.sendMessage(message),{type:'PANEL',action,tabId,...payload});
 const ok=async(action,payload)=>{const response=await send(action,payload);assert(response.ok,response.error);return response.state;};
 const font=selector=>page.locator(selector).evaluate(e=>getComputedStyle(e).fontFamily);
 const restored=()=>page.waitForFunction(()=>getComputedStyle(document.querySelector('#body')).fontFamily.includes('FontSwap_') && getComputedStyle(document.querySelector('#generic')).fontFamily.includes('FontSwap_'));
 const key=`site:${new URL(fixtureURL).origin}`;
 const bindPanel=async()=>{await page.bringToFront();await panel.reload();await panel.waitForFunction(()=>!document.getElementById('view-main').hidden && !document.getElementById('remember-row').hidden);};
 await page.goto(fixtureURL);await ok('connect');await ok('undo');
 await ok('source',{family:'Arial'});await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'all'});
 await ok('source',{family:'monospace'});await ok('preview',{destination:{kind:'google',family:'Lora'},scope:'all'});
 await worker.evaluate(()=>{const request=chrome.permissions.request.bind(chrome.permissions);globalThis.__sitePermissionRequest=request;chrome.permissions.request=options=>{globalThis.__requestedSite=options;return request(options);};});
 await bindPanel();await panel.locator('#remember-site').check();
 await panel.waitForFunction(()=>document.getElementById('remember-site').checked && !document.getElementById('remember-site').disabled);
 assert.deepEqual(await worker.evaluate(()=>globalThis.__requestedSite),{origins:['http://127.0.0.1/*']});
 await worker.evaluate(()=>{chrome.permissions.request=globalThis.__sitePermissionRequest;});
 let saved=await worker.evaluate(async key=>(await chrome.storage.local.get(key))[key],key);
 assert.deepEqual(saved.rules,[{source:'Arial',destination:{kind:'google',family:'Inter'}},{source:'monospace',destination:{kind:'google',family:'Lora'}}]);
 assert(!JSON.stringify(saved).includes('Stories are better'));
 const taggedRule=(await ok('state')).rules.find(rule=>rule.source==='Arial');
 await ok('tags',{ruleId:taggedRule.id,frameId:0,tags:['p']});
 saved=await worker.evaluate(async key=>(await chrome.storage.local.get(key))[key],key);
 assert.deepEqual(saved.rules.find(rule=>rule.source==='Arial').tags,['p']);
 await page.reload();await restored();assert.equal(await page.locator('[data-font-swap-panel],[data-font-swap-picker]').count(),0);
 assert.doesNotMatch(await font('#heading'),/FontSwap_/);
 passed('remember checkbox stores only font pairs; reload restores multiple swaps without opening controls');
 await page.evaluate(()=>window.addNew());await page.waitForFunction(()=>getComputedStyle(document.querySelector('#new')).fontFamily.includes('FontSwap_'));
 await page.goto(`${fixtureURL}/another`);await restored();
 const other=await context.newPage();await other.goto(fixtureURL);await other.waitForFunction(()=>getComputedStyle(document.querySelector('#body')).fontFamily.includes('FontSwap_'));await other.close();
 await page.goto(fixtureURL.replace('127.0.0.1','localhost'));assert.doesNotMatch(await font('#body'),/FontSwap_/);
 await page.goto(fixtureURL);await restored();
 passed('saved pairs cover other paths, new tabs and dynamic text while a different host stays unchanged');
 await ok('connect');let state=await ok('state');assert(state.remembered);
 const rule=state.rules.find(rule=>rule.source==='Arial');await ok('select',{ruleId:rule.id,frameId:0});
 await ok('preview',{destination:{kind:'google',family:'Lora'},scope:'all'});
 saved=await worker.evaluate(async key=>(await chrome.storage.local.get(key))[key],key);assert.equal(saved.rules.find(rule=>rule.source==='Arial').destination.family,'Lora');
 assert.deepEqual(saved.rules.find(rule=>rule.source==='Arial').tags,['p']);
 passed('saved tag choices survive navigation and destination edits without broadening the swap');
 await bindPanel();await panel.locator('#remember-site').uncheck();await panel.waitForFunction(()=>!document.getElementById('remember-site').disabled);
 assert.equal(await worker.evaluate(async key=>(await chrome.storage.local.get(key))[key],key),undefined);
 assert.match(await font('#body'),/FontSwap_/);await page.reload();assert.doesNotMatch(await font('#body'),/FontSwap_/);
 passed('edits update saved pairs; turning remembering off forgets them and keeps the current preview until reload');
 await ok('connect');await ok('source',{family:'Arial'});await ok('preview',{destination:{kind:'page',family:'monospace'},scope:'all'});
 await bindPanel();await panel.locator('#remember-site').check();await panel.waitForFunction(()=>!document.getElementById('remember-site').disabled);
 await page.reload();await page.waitForFunction(()=>getComputedStyle(document.querySelector('#body')).fontFamily.startsWith('monospace'));
 await ok('connect');await ok('undo');await page.reload();assert.doesNotMatch(await font('#body'),/^monospace/);
 assert.equal(await worker.evaluate(async key=>(await chrome.storage.local.get(key))[key],key),undefined);
 passed('page-picked fonts also restore; Undo all clears saved pairs and future automatic swaps');
 // A denied optional permission must leave the preview and unsaved state intact.
 await ok('connect');await ok('source',{family:'Arial'});await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'all'});
 await worker.evaluate(()=>{globalThis.__sitePermissionRequest=chrome.permissions.request;chrome.permissions.request=async()=>false;});
 await bindPanel();await panel.locator('#remember-site').click();await panel.waitForFunction(()=>document.getElementById('error').textContent.includes('Chrome needs permission'));
 assert.equal(await panel.locator('#remember-site').isChecked(),false);assert.match(await font('#body'),/FontSwap_/);
 assert.equal(await worker.evaluate(async key=>(await chrome.storage.local.get(key))[key],key),undefined);
 await worker.evaluate(()=>{chrome.permissions.request=globalThis.__sitePermissionRequest;});
 passed('denied site permission leaves remembering off, shows an error and preserves the current preview');
 // Leave a Google pair saved for the browser restart check.
 await ok('connect');await ok('source',{family:'Arial'});await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'all'});
 await bindPanel();await panel.locator('#remember-site').check();await panel.waitForFunction(()=>!document.getElementById('remember-site').disabled);
 await panel.screenshot({path:'test-results/remember-site.png'});
}

export async function testSavedSiteRestart(context,worker,fixtureURL,passed) {
 const page=await context.newPage();await page.goto(fixtureURL);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#body')).fontFamily.includes('FontSwap_'));
 const id=new URL(worker.url()).host,panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
 const response=await panel.evaluate(async tabId=>chrome.runtime.sendMessage({type:'PANEL',action:'connect',tabId}),tabId);
 assert(response.state.remembered);
 await worker.evaluate(async origin=>chrome.storage.local.remove(`site:${origin}`),new URL(fixtureURL).origin);
 await panel.close();await page.close();
 passed('saved font pairs and automatic restoration survive a full browser restart');
}
