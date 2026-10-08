import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {testSavedSites,testSavedSiteRestart} from './remember-sites.mjs';
import {testNativePanel} from './native-panel.mjs';
import {testFloatingPanel,testRememberedMode} from './floating-panel.mjs';
const temp=await mkdtemp(path.join(tmpdir(),'font-swap-e2e-'));
const extension=path.join(temp,'extension'); await cp('extension',extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json')));
// ActiveTab is a toolbar gesture. Grant only test loopback origins in the test copy.
manifest.host_permissions.push('http://127.0.0.1/*','http://localhost/*');
await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const fixture=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body>
<h1 id="heading" style="font-family:Arial,sans-serif!important;cursor:crosshair!important;outline:3px dotted red;background-color:rgb(240,240,240)">Find your next chapter</h1>
<p id="body">Stories are better when they are shared.</p><p id="fallback" class="fallback">Fallback Inter remains protected</p>
<p id="similar" class="similar">Arial Narrow remains protected</p><span id="icon" class="icon">&#xe900;</span>
<p id="inherited">Direct text <span id="inherited-icon">&#xe901;</span></p><p id="generic" style="font-family:monospace;cursor:help!important">Generic destination</p><div id="open"></div><div id="closed"></div><div id="dynamic"></div>
<iframe id="same" src="/frame"></iframe><iframe id="cross" src="http://localhost:PORT/frame"></iframe>
<script src="/fixture.js"></script></body></html>`;
const fixtureJS=`for(const mode of ['open','closed']) { const root=document.querySelector('#'+mode).attachShadow({mode}); const span=document.createElement('span'); span.id=mode+'-text'; span.style.fontFamily='Arial, sans-serif'; span.textContent=mode+' shadow text';root.append(span); }
window.addNew=()=>{document.querySelector('#dynamic').innerHTML='<p id="new" style="font-family:Arial,sans-serif">New dynamic text</p>';};`;
let port;
const server=http.createServer((req,res)=>{
 if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end('body {font-family:Arial,sans-serif;padding:30px} .fallback {font-family:Missing,Arial,sans-serif}.similar{font-family:"Arial Narrow",sans-serif}.icon{font-family:Arial} iframe{height:80px}');return;}
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(fixtureJS);return;}
 if(req.url==='/strict') res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'none'; connect-src 'none'; frame-src http://127.0.0.1:* http://localhost:*");
 if(req.url==='/strict-ui') res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'none'; font-src 'none'; frame-src 'none'; trusted-types 'none'; require-trusted-types-for 'script'");
 res.setHeader('Content-Type','text/html');res.end(req.url==='/frame'?'<p id="frame-text" style="font-family:Arial,sans-serif">Embedded text</p>':fixture.replaceAll('PORT',port));
});
await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));port=server.address().port;
let context;
const checks=[];
function passed(name){checks.push(name);console.log('PASS',name);}
try {
 const localChrome='/Users/omshejul/.cache/puppeteer/chrome/mac_arm-152.0.7977.75/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 let executablePath=process.env.CHROME_PATH;
 if(!executablePath) try{await access(localChrome);executablePath=localChrome;}catch{}
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath,channel:executablePath?undefined:'chromium',headless:process.env.HEADED!=='1',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;
 const page=await context.newPage(); await page.goto(`http://127.0.0.1:${port}`);
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url());
 const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
 const send=(action,payload={})=>panel.evaluate(async m=>chrome.runtime.sendMessage(m),{type:'PANEL',action,tabId,...payload});
 const ok=async(action,payload)=>{const r=await send(action,payload);assert.equal(r.ok,true,r.error);return r;};
 const waitState=async predicate=>{const end=Date.now()+30000;while(Date.now()<end){const r=await ok('state');if(predicate(r.state))return r;await page.waitForTimeout(40);}throw new Error('Page selection did not settle');};
 await ok('connect');
 const originalHover=await page.locator('#heading').evaluate(e=>({cursor:getComputedStyle(e).cursor,outline:e.style.outline,background:e.style.backgroundColor}));
 await ok('pick',{mode:'source'});assert.equal(await page.locator('[data-font-swap-picker]').count(),1);await page.locator('#heading').hover();assert.equal(await page.locator('[data-font-swap-tooltip]').textContent(),'Arial');
 assert.equal(await page.locator('#heading').evaluate(e=>getComputedStyle(e).cursor),'pointer');
 assert.match(await page.locator('#heading').evaluate(e=>getComputedStyle(e).outline),/1px/);
 assert.equal(await page.locator('#heading').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(45, 105, 231, 0.08)');
 await page.locator('#heading').click();assert.equal(await page.locator('[data-font-swap-tooltip]').count(),0);assert.equal(await page.locator('[data-font-swap-picker]').count(),0);
 assert.deepEqual(await page.locator('#heading').evaluate(e=>({cursor:getComputedStyle(e).cursor,outline:e.style.outline,background:e.style.backgroundColor})),originalHover);
 passed('source hover shows hand cursor, subtle highlight and font name; picking restores website styles');
 await ok('pick',{mode:'destination'});assert.equal(await page.locator('[data-font-swap-picker]').count(),1);await page.locator('#generic').hover();assert.equal(await page.locator('[data-font-swap-tooltip]').textContent(),'monospace');
 assert.equal(await page.locator('#generic').evaluate(e=>getComputedStyle(e).cursor),'pointer');
 await page.keyboard.press('Escape');await waitState(s=>!s.picking);assert.equal(await page.locator('[data-font-swap-picker]').count(),0);
 assert.equal(await page.locator('#generic').evaluate(e=>getComputedStyle(e).cursor),'help');assert.equal(await page.locator('[data-font-swap-tooltip]').count(),0);
 await ok('pick',{mode:'source'});await page.locator('#open-text').hover();assert.equal(await page.locator('#open-text').evaluate(e=>getComputedStyle(e).cursor),'pointer');
 await page.keyboard.press('Escape');await waitState(s=>!s.picking);assert.equal(await page.locator('#open-text').evaluate(e=>e.style.getPropertyValue('cursor')),'');
 await page.frameLocator('#same').locator('#frame-text').hover();assert.equal(await page.frameLocator('#same').locator('[data-font-swap-tooltip]').count(),0);assert.notEqual(await page.frameLocator('#same').locator('#frame-text').evaluate(e=>getComputedStyle(e).cursor),'pointer');
 passed('both pickers show on-page instructions; Escape restores cursors and cancels frames, including shadow text');
 let result=await ok('state');assert.equal(result.state.source,'Arial');assert.equal(result.state.selection.tag,'h1');passed('picker detects primary CSS family and selected text');
 result=await ok('preview',{destination:{kind:'google',family:'Lora'},scope:'all'});assert.equal(result.state.active,true);assert.equal(result.state.applied,true);
 const changed=await page.locator('#heading').evaluate(e=>getComputedStyle(e).fontFamily);assert.match(changed,/FontSwap_/);
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#heading'});
 const glyphs=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});assert(glyphs.fonts.some(f=>f.isCustomFont && /Lora/i.test(f.familyName)),JSON.stringify(glyphs));passed('real Google Font downloads and renders actual Lora glyphs over inline important');
 assert.doesNotMatch(await page.locator('#fallback').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 assert.doesNotMatch(await page.locator('#similar').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 assert.doesNotMatch(await page.locator('#icon').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.doesNotMatch(await page.locator('#inherited-icon').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);passed('fallback-only matches, similar names and private-use icons stay unchanged');
 assert.match(await page.locator('#open').evaluate(e=>getComputedStyle(e.shadowRoot.firstChild).fontFamily),/FontSwap_/);
 const closed=await worker.evaluate(async ({tabId})=>(await chrome.scripting.executeScript({target:{tabId},func:()=>getComputedStyle(chrome.dom.openOrClosedShadowRoot(document.querySelector('#closed')).firstChild).fontFamily}))[0].result,{tabId});assert.match(closed,/FontSwap_/);passed('open and closed shadow DOM text swaps');
 await page.evaluate(()=>window.addNew());await page.waitForTimeout(450);assert.match(await page.locator('#new').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);passed('dynamic page text joins current font mapping');
 await page.evaluate(()=>{window.churn=setInterval(()=>document.querySelector('#new').textContent='Changing '+Date.now(),50);});await page.waitForTimeout(350);assert.match(await page.locator('#new').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);await page.evaluate(()=>clearInterval(window.churn));passed('continuous DOM updates do not starve matching');
 await ok('pick',{mode:'source'});await page.locator('#heading').hover();assert.equal(await page.locator('[data-font-swap-tooltip]').textContent(),'Lora');await page.locator('#generic').click();await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'all'});
 result=await ok('state');assert.equal(result.state.rules.length,2);assert.match(await page.locator('#heading').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.match(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);passed('two different origin fonts stay applied together and hover shows replacement name');
 const genericRule=result.state.rules.find(r=>r.source==='monospace');await ok('remove',{ruleId:genericRule.id,frameId:genericRule.frameId});assert.equal((await ok('state')).state.rules.length,1);assert.match(await page.locator('#heading').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.equal(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),'monospace');passed('removing one swap preserves the other');
 await ok('pick',{mode:'source'});await page.locator('#generic').click();await ok('pick',{mode:'destination'});await page.locator('#heading').click();await waitState(s=>s.destination?.family==='Lora' && s.rules.length===2);assert.match(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 const arialRule=(await ok('state')).state.rules.find(r=>r.source==='Arial');await ok('remove',{ruleId:arialRule.id,frameId:arialRule.frameId});assert.match(await page.locator('#generic').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.doesNotMatch(await page.locator('#heading').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);passed('page picking a replaced Google font survives removal of its original swap');
 await ok('undo');await ok('source',{family:'Arial'});await ok('preview',{destination:{kind:'google',family:'Lora'},scope:'all'});
 const editRule=(await ok('state')).state.rules[0];await ok('select',{ruleId:editRule.id,frameId:editRule.frameId});await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'all'});assert.equal((await ok('state')).state.rules.length,1);assert.equal((await ok('state')).state.rules[0].id,editRule.id);await ok('preview',{destination:{kind:'google',family:'Lora'},scope:'all'});passed('editing a swap replaces its destination without duplicating the pair');
 await ok('compare',{enabled:true});assert.doesNotMatch(await page.locator('#heading').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 assert.doesNotMatch(await page.locator('#open').evaluate(e=>getComputedStyle(e.shadowRoot.firstChild).fontFamily),/FontSwap_/);
 await ok('compare',{enabled:false});assert.match(await page.locator('#heading').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 await ok('apply');assert.equal((await ok('state')).state.applied,true);passed('instant application needs no Apply and internal comparison remains reversible');
 await page.locator('#heading').evaluate(e=>e.style.setProperty('font-family','Courier New','important'));
 await page.locator('#open').evaluate(e=>e.shadowRoot.firstChild.style.setProperty('font-family','Georgia','important'));
 await page.waitForTimeout(450);await ok('undo');
 assert.match(await page.locator('#heading').evaluate(e=>getComputedStyle(e).fontFamily),/Courier/);assert.match(await page.locator('#open').evaluate(e=>getComputedStyle(e.shadowRoot.firstChild).fontFamily),/Georgia/);passed('Undo preserves website styling changes including shadow inline changes');
 await ok('pick',{mode:'source'});await page.locator('#fallback').click();assert.equal((await ok('state')).state.selection.confidence,'css');passed('fallback detection is labelled CSS identity rather than confirmed rendered font');
 await ok('source',{family:'Never Used Family'});assert.equal((await ok('state')).state.count,0);assert.equal((await ok('state')).state.selection,null);
 assert.equal((await send('preview',{destination:{kind:'google',family:'Inter'},scope:'all'})).ok,false);passed('absent source produces zero matches and no misleading success');
 await ok('pick',{mode:'source'});await page.locator('#body').click();await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'element'});
 assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.doesNotMatch(await page.locator('#new').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);await ok('undo');passed('selected element scope only changes selected element');
 await ok('pick',{mode:'source'});await page.locator('#body').click();await ok('pick',{mode:'destination'});await page.locator('#heading').click();
 await waitState(s=>s.destination?.family==='Courier New');assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/Courier New/);await ok('undo');passed('destination can be picked from existing page text');
 await ok('pick',{mode:'source'});await page.locator('#body').click();await ok('pick',{mode:'destination'});await page.locator('#generic').click();await waitState(s=>s.destination?.family==='monospace');assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/^monospace,/);await ok('undo');passed('page-picked CSS generic font keeps generic semantics');
 await ok('pick',{mode:'source'});await page.locator('#body').click();await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'all'});
 const previous=await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily);
 const failed=await send('preview',{destination:{kind:'google',family:'Not A Google Font'},scope:'all'});assert.equal(failed.ok,false);assert.equal(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),previous);passed('destination failure retains previous preview');
 await context.setOffline(true);try { const offline=await send('preview',{destination:{kind:'google',family:'Abyssinica SIL'},scope:'all'});assert.equal(offline.ok,false);assert.equal(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),previous);await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'all'});assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/); } finally { await context.setOffline(false); }await ok('undo');passed('offline uncached font fails safely and cached font still previews');
 await page.goto(`http://127.0.0.1:${port}/strict`);await ok('connect');await ok('pick',{mode:'source'});await page.locator('#body').click();await ok('preview',{destination:{kind:'google',family:'Lora'},scope:'all'});assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);passed('strict website CSP with font-src none supports worker-loaded FontFace');
 await ok('pick',{mode:'destination'});await page.frameLocator('#cross').locator('#frame-text').click();assert.equal((await ok('state')).state.frameId,0);await ok('cancel');passed('destination picker stays in origin document');
 await ok('pick',{mode:'source'});await page.frameLocator('#cross').locator('#frame-text').click();result=await waitState(s=>s.frameId!==0);assert.notEqual(result.state.frameId,0);assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);passed('moving origin to another frame preserves previous swaps');await ok('preview',{destination:{kind:'google',family:'Lora'},scope:'all'});assert.match(await page.frameLocator('#cross').locator('#frame-text').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.equal((await ok('state')).state.rules.length,2);await ok('undo');assert.doesNotMatch(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);assert.doesNotMatch(await page.frameLocator('#cross').locator('#frame-text').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);passed('Undo all restores simultaneous swaps across permitted frames');
 await testSavedSites(context,worker,page,panel,`http://127.0.0.1:${port}`,passed);
 await page.goto('chrome://version');const blocked=await send('connect');assert.equal(blocked.ok,false);passed('restricted browser page reports unsupported action');
 await context.close();
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath,channel:executablePath?undefined:'chromium',headless:process.env.HEADED!=='1',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await testSavedSiteRestart(context,context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'),`http://127.0.0.1:${port}`,passed);
 await context.close();
 context=await chromium.launchPersistentContext(path.join(temp,'production-profile'),{executablePath,channel:executablePath?undefined:'chromium',headless:process.env.HEADED!=='1',args:['--enable-unsafe-extension-debugging',`--disable-extensions-except=${path.resolve('extension')}`,`--load-extension=${path.resolve('extension')}`]});
 const productionWorker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 await testNativePanel(context,productionWorker,`http://127.0.0.1:${port}`,passed);
 await context.close();
 context=await chromium.launchPersistentContext(path.join(temp,'floating-profile'),{executablePath,channel:executablePath?undefined:'chromium',headless:process.env.HEADED!=='1',args:['--enable-unsafe-extension-debugging',`--disable-extensions-except=${path.resolve('extension')}`,`--load-extension=${path.resolve('extension')}`]});
 const floatingWorker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 await testFloatingPanel(context,floatingWorker,`http://127.0.0.1:${port}`,passed);
 await context.close();
 context=await chromium.launchPersistentContext(path.join(temp,'floating-profile'),{executablePath,channel:executablePath?undefined:'chromium',headless:process.env.HEADED!=='1',args:['--enable-unsafe-extension-debugging',`--disable-extensions-except=${path.resolve('extension')}`,`--load-extension=${path.resolve('extension')}`]});
 await testRememberedMode(context,`http://127.0.0.1:${port}`,passed);
 await mkdir('test-results',{recursive:true});await writeFile('test-results/e2e.json',JSON.stringify({date:new Date().toISOString(),browser:await context.browser().version(),checks},null,2));
 console.log(`${checks.length} end-to-end checks passed.`);
} finally {if(context)await context.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
