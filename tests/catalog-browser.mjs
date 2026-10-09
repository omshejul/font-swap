import assert from 'node:assert/strict';
import {attachPanel} from './native-panel.mjs';

const ENDPOINT='https://omshejul.com/api/swapfont/catalog';
const WEEK=7*24*60*60*1000,HOUR=60*60*1000;

// Use the existing remembered-site profile. These operations must never activate a refresh.
export async function testCatalogIdle(context,worker,fixtureURL,passed) {
 const page=await context.newPage();
 const timestamps=await worker.evaluate(async({endpoint,week,hour})=>{
  const keys=['googleFontCatalogFetchedAt','googleFontCatalogLastAttemptAt'];
  const stored=await chrome.storage.local.get(keys),original=fetch;
  globalThis.__catalogIdle={original,calls:0};
  globalThis.fetch=(input,options)=>{if((input.url||String(input))===endpoint)globalThis.__catalogIdle.calls++;return original(input,options);};
  await chrome.storage.local.set({googleFontCatalogFetchedAt:Date.now()-week,googleFontCatalogLastAttemptAt:Date.now()-hour-1});
  return stored;
 },{endpoint:ENDPOINT,week:WEEK,hour:HOUR});
 try {
  await page.goto(fixtureURL);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#body')).fontFamily.includes('FontSwap_'));
  assert.equal(await page.locator('[data-font-swap-panel],[data-font-swap-picker]').count(),0);
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
  const results=await worker.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:async()=>{
   const results=[];
   for(const action of ['catalog','connect','state','connect','catalog'])results.push((await chrome.runtime.sendMessage({type:'PANEL',action})).ok);
   return results;
  }}))[0].result,tabId);
  assert(results.every(Boolean));
  await page.locator('#body').hover();
  await page.goto(`${fixtureURL}/catalog-idle`);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#body')).fontFamily.includes('FontSwap_'));
  assert.equal(await worker.evaluate(()=>globalThis.__catalogIdle.calls),0);
  passed('stale catalog reads, connect retries, hover, navigation and remembered-font restoration make no backend request');
 } finally {
  await worker.evaluate(async stored=>{
   globalThis.fetch=globalThis.__catalogIdle.original;
   await chrome.storage.local.remove(['googleFontCatalogFetchedAt','googleFontCatalogLastAttemptAt']);
   await chrome.storage.local.set(stored);
  },timestamps);
  await page.close();
 }
}

export async function testCatalogBrowser(context,worker,fixtureURL,passed) {
 const page=await context.newPage();await page.goto(fixtureURL);await page.bringToFront();
 const id=new URL(worker.url()).host,cdp=await context.browser().newBrowserCDPSession();
 let tabId;
 const trigger=async()=>{
  const targets=await cdp.send('Target.getTargets',{filter:[{}]});
  const tab=targets.targetInfos.find(target=>target.type==='tab'&&target.url===page.url());
  await cdp.send('Extensions.triggerAction',{id,targetId:tab.targetId});
 };
 const nativePanel=async()=>{
  for(let i=0;i<100;i++){
   const target=(await cdp.send('Target.getTargets')).targetInfos.find(target=>target.url===`chrome-extension://${id}/sidepanel.html`);
   if(target)return attachPanel(cdp,target.targetId);
   await page.waitForTimeout(50);
  }
  throw new Error('Catalog test native panel did not open');
 };
 const waitWorker=predicate=>worker.evaluate(async source=>{
  const until=Date.now()+25000;
  while(Date.now()<until){const stored=await chrome.storage.local.get(null);if(source==='live' ? Boolean(stored.googleFontCatalogFetchedAt) : stored.googleFontCatalog?.families.some(font=>font.family===source))return;await new Promise(resolve=>setTimeout(resolve,40));}
  throw new Error(`Catalog refresh did not settle: ${source}`);
 },predicate);
 const count=()=>worker.evaluate(()=>globalThis.__catalogBrowser.requests.length);
 const delayRefresh=async family=>worker.evaluate(async({family,week,hour})=>{
  const payload=(await chrome.storage.local.get('googleFontCatalog')).googleFontCatalog;
  const families=payload.families.concat({family,category:'sans-serif',variants:['regular','700'],popularity:0});
  globalThis.__catalogBrowser.payload={...payload,families};
  globalThis.__catalogBrowser.gate=new Promise(resolve=>globalThis.__catalogBrowser.release=resolve);
  await chrome.storage.local.set({googleFontCatalogFetchedAt:Date.now()-week,googleFontCatalogLastAttemptAt:Date.now()-hour-1});
 },{family,week:WEEK,hour:HOUR});
 const waitRequest=expected=>worker.evaluate(async expected=>{
  const until=Date.now()+5000;while(Date.now()<until){if(globalThis.__catalogBrowser.requests.length===expected)return;await new Promise(resolve=>setTimeout(resolve,20));}
  throw new Error('Expected catalog request was not started');
 },expected);
 const release=()=>worker.evaluate(()=>{globalThis.__catalogBrowser.release();globalThis.__catalogBrowser.payload=null;});
 const nativeSearch=async(panel,text)=>{
  await panel.wait("!document.getElementById('steps').hidden && !document.getElementById('search').disabled");
  await panel.click('#search');await panel.evaluate("document.getElementById('search').select()");
  await panel.command('Input.insertText',{text});
  await panel.wait(`!!document.querySelector('.result[data-family="Inter"]')`);
 };
 const nativeKey=(panel,key,code)=>panel.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code}).then(()=>panel.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code}));
 const nativeSnapshot=panel=>panel.evaluate(`(()=>{const search=document.getElementById('search');return {query:search.value,focus:document.activeElement.id,active:document.querySelector('.result[aria-selected=true]')?.dataset.family,expanded:[...document.querySelectorAll('.pair-edit[aria-expanded=true]')].map(button=>button.id),destinations:[...document.querySelectorAll('.pair-to')].map(element=>element.textContent)};})()`);
 const floating=async(selector='')=>worker.evaluate(async({tabId,selector})=>(await chrome.scripting.executeScript({target:{tabId},func:selector=>{
  const root=globalThis.__fontSwapPanelRoot;if(!root)return null;
  const element=selector?root.querySelector(selector):root.host,r=element?.getBoundingClientRect();
  return {visible:!!root.host.getBoundingClientRect().width,query:root.getElementById('search').value,focus:root.activeElement?.id,active:root.querySelector('.result[aria-selected=true]')?.dataset.family,expanded:[...root.querySelectorAll('.pair-edit[aria-expanded=true]')].map(button=>button.id),destinations:[...root.querySelectorAll('.pair-to')].map(element=>element.textContent),editing:!root.getElementById('steps').hidden,picking:!!root.getElementById('view-main').dataset.picking,loading:root.getElementById('note').classList.contains('is-loading'),result:selector?.startsWith('.result')?element?.dataset.family:null,point:r?{x:r.x+r.width/2,y:r.y+r.height/2}:null};
 },args:[selector]}))[0].result,{tabId,selector});
 const waitFloating=async predicate=>{const until=Date.now()+15000;let result;while(Date.now()<until){result=await floating();if(predicate(result))return result;await page.waitForTimeout(40);}throw new Error('Catalog floating panel did not settle: '+JSON.stringify(result));};
 const floatingClick=async selector=>{const info=await floating(selector);assert(info?.point,`Missing floating ${selector}`);await page.mouse.click(info.point.x,info.point.y);};
 const floatingSearch=async text=>{await floatingClick('#search');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type(text);};
 const waitFloatingResult=async family=>{for(let i=0;i<100;i++){if((await floating(`.result[data-family="${family}"]`))?.result===family)return;await page.waitForTimeout(40);}throw new Error(`Floating panel did not adopt ${family}`);};
 try {
  await worker.evaluate(async endpoint=>{
   const original=fetch,permission=chrome.permissions.request.bind(chrome.permissions);
   globalThis.__catalogBrowser={original,permission,requests:[],responses:[],permissions:[],payload:null};
   chrome.permissions.request=options=>{globalThis.__catalogBrowser.permissions.push(options);return permission(options);};
   globalThis.fetch=async(input,options)=>{
    if((input.url||String(input))!==endpoint)return original(input,options);
    const request=new Request(input,options),test=globalThis.__catalogBrowser;
    test.requests.push({url:request.url,method:request.method,mode:request.mode,credentials:request.credentials,referrerPolicy:request.referrerPolicy,headers:[...request.headers],body:!!request.body});
    if(test.payload){const payload=test.payload;await test.gate;return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});}
    const response=await original(input,options);test.responses.push({status:response.status,type:response.type});return response;
   };
   if(await chrome.permissions.contains({origins:['https://omshejul.com/*']}))throw new Error('Catalog profile already has optional backend permission');
   if((await chrome.storage.local.get('googleFontCatalog')).googleFontCatalog)throw new Error('Catalog profile was not clean');
   await new Promise(resolve=>{const ready=()=>chrome.action.onClicked.hasListeners()?resolve():setTimeout(ready,20);ready();});
  },ENDPOINT);
  assert.deepEqual(await context.cookies('https://omshejul.com'),[]);
  await trigger();let docked=await nativePanel();
  tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
  await docked.wait("document.getElementById('view-main').dataset.picking==='source'");
  await waitWorker('live');
  const live=await worker.evaluate(async()=>({requests:globalThis.__catalogBrowser.requests,responses:globalThis.__catalogBrowser.responses,permissions:globalThis.__catalogBrowser.permissions,allowed:await chrome.permissions.contains({origins:['https://omshejul.com/*']}),hosts:chrome.runtime.getManifest().host_permissions,count:(await chrome.storage.local.get('googleFontCatalog')).googleFontCatalog.families.length}));
  assert.equal(live.requests.length,1);assert.deepEqual(live.responses,[{status:200,type:'cors'}]);
  assert.deepEqual(live.requests[0],{url:ENDPOINT,method:'GET',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',headers:[],body:false});
  assert.equal(live.allowed,false);assert.deepEqual(live.permissions,[]);assert(live.count>0);
  assert.deepEqual(live.hosts,['https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']);
  assert.deepEqual(await context.cookies('https://omshejul.com'),[]);
  passed('clean production profile downloads the live catalog with real service-worker CORS, no backend permission, credentials, referrer, key or user payload');
  await page.locator('#body').click();await docked.wait("document.querySelector('.pair-pending') && !document.getElementById('search').disabled");
  await nativeSearch(docked,'Inter');await docked.click('.result[data-family="Inter"]');
  await docked.wait("document.getElementById('steps').hidden && !document.getElementById('view-main').inert");
  const savedKey='site:https://catalog-browser.invalid',saved={rules:[{source:'Arial',destination:{kind:'google',family:'Inter'},tags:['p']}]};
  await worker.evaluate(({key,saved})=>chrome.storage.local.set({[key]:saved}),{key:savedKey,saved});
  await delayRefresh('Inter Catalog Native');await trigger();await waitRequest(2);
  await docked.click('#undo');await docked.wait("!!document.querySelector('.pair-source')");
  await docked.click('.pair-source .pair-edit');await page.locator('#body').hover();
  assert.equal(await page.locator('[data-font-swap-tooltip]').textContent(),'Arial');
  await page.locator('#body').click();await docked.wait("document.querySelector('.pair-pending') && !document.getElementById('search').disabled");
  await nativeSearch(docked,'Inter');await docked.click('.result[data-family="Inter"]');
  await docked.wait("document.getElementById('steps').hidden && !document.getElementById('view-main').inert");
  assert.match(await page.locator('#body').evaluate(element=>getComputedStyle(element).fontFamily),/FontSwap_/);
  await docked.click('.pair-edit');await nativeSearch(docked,'inter');await nativeKey(docked,'End',35);
  const nativeBefore=await nativeSnapshot(docked);
  assert(nativeBefore.active && nativeBefore.focus==='search' && nativeBefore.expanded.length===1);
  assert.equal(await count(),2);await release();await waitWorker('Inter Catalog Native');
  await docked.wait(`!!document.querySelector('.result[data-family="Inter Catalog Native"]')`);
  assert.deepEqual(await nativeSnapshot(docked),nativeBefore);
  assert.equal(await docked.evaluate("(async()=>{const response=await chrome.runtime.sendMessage({type:'PANEL',action:'catalog'});return response.catalog.some(font=>font.family==='Inter Catalog Native');})()"),true);
  passed('native picking, cached search and swapping work during delayed refresh; worker and visible results adopt it without losing query, focus, accordion or active font');
  await worker.evaluate(async tabId=>chrome.sidePanel.close({windowId:(await chrome.tabs.get(tabId)).windowId}),tabId);
  for(let i=0;i<100;i++){if(!(await cdp.send('Target.getTargets')).targetInfos.some(target=>target.url===`chrome-extension://${id}/sidepanel.html`))break;await page.waitForTimeout(40);}
  await trigger();docked=await nativePanel();await docked.wait("document.querySelector('.pair-to')?.textContent==='Inter'");
  await docked.click('#mode-toggle');await waitFloating(info=>info?.visible);
  await floatingClick('.pair-edit');await floatingSearch('inter');await waitFloatingResult('Inter Catalog Native');
  assert.equal(await count(),2);
  await delayRefresh('Inter Catalog Floating');await floatingClick('#close-panel');await trigger();await waitRequest(3);
  await waitFloating(info=>info?.visible);
  await floatingClick('#undo');await waitFloating(info=>!info.destinations.includes('Inter'));
  await floatingClick('.pair-source .pair-edit');await waitFloating(info=>info?.picking);
  await page.locator('#body').click();await waitFloating(info=>info?.editing&&!info.picking);
  await floatingSearch('Inter');await waitFloatingResult('Inter');await floatingClick('.result[data-family="Inter"]');
  await waitFloating(info=>!info.editing&&!info.loading&&info.destinations.includes('Inter'));
  assert.match(await page.locator('#body').evaluate(element=>getComputedStyle(element).fontFamily),/FontSwap_/);
  await floatingClick('.pair-edit');await floatingSearch('inter');await page.keyboard.press('End');
  const {point:_,visible:__,result:___,...floatingBefore}=await floating();
  assert(floatingBefore.active && floatingBefore.focus==='search' && floatingBefore.expanded.length===1);
  assert.equal(await count(),3);await release();await waitWorker('Inter Catalog Floating');await waitFloatingResult('Inter Catalog Floating');
  const {point:____,visible:_____,result:______,...floatingAfter}=await floating();
  assert.deepEqual(floatingAfter,floatingBefore);
  await floatingClick('#close-panel');await trigger();await waitFloating(info=>info?.visible);
  await floatingClick('#mode-toggle');docked=await nativePanel();await docked.wait("document.querySelector('.pair-to')?.textContent==='Inter'");
  await docked.click('.pair-edit');await nativeSearch(docked,'inter');
  await docked.wait(`!!document.querySelector('.result[data-family="Inter Catalog Floating"]')`);
  assert.equal(await count(),3);
  assert.equal(await worker.evaluate(()=>globalThis.__catalogBrowser.permissions.length),0);
  assert.deepEqual(await worker.evaluate(async key=>(await chrome.storage.local.get(key))[key],savedKey),saved);
  passed('floating picking and swapping work during delayed refresh; results retain editor state, and fresh catalog survives reopen and both layout switches without repeat requests');
 } finally {
  await worker.evaluate(()=>{const test=globalThis.__catalogBrowser;if(!test)return;test.release?.();globalThis.fetch=test.original;chrome.permissions.request=test.permission;}).catch(()=>{});
  await page.close();await cdp.detach();
 }
}
