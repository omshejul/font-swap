import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const temp=await mkdtemp(path.join(tmpdir(),'font-swap-flicker-'));
const extension=path.join(temp,'extension');
const fixture=`<!doctype html><meta charset="utf-8"><title>Font refresh regression</title>
<style>body{padding:30px}#target{font:32px Arial,sans-serif;width:420px}#destination,#churn,#padding{font-family:Georgia,serif}</style>
<p id="target">Chrome Web Store gives you new ways to customize your browser.</p>
<p id="destination">Georgia destination</p><output id="churn">0</output><div id="shadow"></div>
<div id="padding">${'<span>Unrelated visible text. </span>'.repeat(5000)}</div>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fixture);});
let context,cleanupPromise;
function cleanup() {
  return cleanupPromise ||= (async()=>{
    if(context) await context.close().catch(()=>{});
    server.closeAllConnections();
    if(server.listening) await new Promise(resolve=>server.close(resolve));
    await rm(temp,{recursive:true,force:true});
  })();
}
const deadline=setTimeout(()=>{console.error('Font flicker test exceeded five minutes');void cleanup().finally(()=>process.exit(124));},300000);
deadline.unref();
try {
  await cp(process.env.TEST_EXTENSION_DIR || 'extension',extension,{recursive:true});
  const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json')));
  // ActiveTab needs a toolbar gesture. Grant loopback only in the disposable copy.
  manifest.host_permissions.push('http://127.0.0.1/*');
  await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  const localChrome='/Users/omshejul/.cache/puppeteer/chrome/mac_arm-152.0.7977.75/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  let executablePath=process.env.CHROME_PATH;
  if(!executablePath) try{await access(localChrome);executablePath=localChrome;}catch{}
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath,channel:executablePath?undefined:'chromium',headless:process.env.HEADED!=='1',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page=await context.newPage();await page.goto(url);
  await page.evaluate(()=>{
    const text=document.createElement('span');text.style.cssText='display:block;font:32px Arial,sans-serif;width:420px';text.textContent='Shadow text must stay swapped during page updates';
    document.querySelector('#shadow').attachShadow({mode:'open'}).append(text);
  });
  const original=await page.locator('#target').evaluate(e=>({font:getComputedStyle(e).fontFamily,height:e.getBoundingClientRect().height}));
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,url);
  const panel=await context.newPage();await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
  const send=async(action,payload={})=>{
    const result=await panel.evaluate(message=>chrome.runtime.sendMessage(message),{type:'PANEL',action,tabId,...payload});
    assert.equal(result.ok,true,result.error);
  };
  await send('connect');await send('source',{family:'Arial'});
  await send('preview',{destination:{kind:'page',family:'Georgia'},scope:'all'});
  await page.bringToFront();await page.waitForTimeout(300);
  const swapped=await page.locator('#target').evaluate(e=>{
    const shadow=document.querySelector('#shadow').shadowRoot.firstChild;
    return {font:getComputedStyle(e).fontFamily,height:e.getBoundingClientRect().height,belowTop:document.querySelector('#destination').getBoundingClientRect().top,shadowFont:getComputedStyle(shadow).fontFamily,shadowHeight:shadow.getBoundingClientRect().height};
  });
  assert.match(swapped.font,/^Georgia/);assert.match(swapped.shadowFont,/^Georgia/);
  const sample=async(mutate,duration)=>page.evaluate(({mutate,duration})=>new Promise(resolve=>{
    const target=document.querySelector('#target'),destination=document.querySelector('#destination'),churn=document.querySelector('#churn'),shadow=document.querySelector('#shadow').shadowRoot.firstChild;
    const frames=[];let mutations=0;
    const interval=mutate?setInterval(()=>{
      churn.textContent=String(++mutations);
      if(mutations===1) {
        const dynamic=document.createElement('p');dynamic.id='dynamic';dynamic.style.fontFamily='Arial,sans-serif';dynamic.textContent='New matching text';document.body.append(dynamic);
      }
    },50):null;
    const start=performance.now();
    function frame(now) {
      frames.push({ms:Number((now-start).toFixed(2)),font:getComputedStyle(target).fontFamily,height:target.getBoundingClientRect().height,belowTop:destination.getBoundingClientRect().top,shadowFont:getComputedStyle(shadow).fontFamily,shadowHeight:shadow.getBoundingClientRect().height});
      if(now-start<duration) requestAnimationFrame(frame);
      else {clearInterval(interval);resolve({frames,mutations});}
    }
    requestAnimationFrame(frame);
  }),{mutate,duration});
  const idle=await sample(false,1500),mutations=await sample(true,4500);
  const dynamic=await page.locator('#dynamic').evaluate(e=>getComputedStyle(e).fontFamily);
  const summarize=phase=>({frames:phase.frames.length,mutations:phase.mutations,revertedFrames:phase.frames.filter(frame=>frame.font!==swapped.font || frame.shadowFont!==swapped.shadowFont).length,shiftedFrames:phase.frames.filter(frame=>Math.abs(frame.height-swapped.height)>0.01 || Math.abs(frame.belowTop-swapped.belowTop)>0.01 || Math.abs(frame.shadowHeight-swapped.shadowHeight)>0.01).length});
  const result={browser:context.browser().version(),version:manifest.version,original,swapped,idle:summarize(idle),mutations:summarize(mutations),dynamic};
  await mkdir('test-results',{recursive:true});await writeFile('test-results/flicker.json',JSON.stringify({result,idle,mutations},null,2));
  console.log(JSON.stringify(result));
  assert(idle.frames.length>50 && mutations.frames.length>100,'Animation-frame sampling did not run');
  assert(mutations.mutations>50,'Unrelated DOM churn did not run');
  assert.match(dynamic,/^Georgia/,'New matching text must join the active swap, proving mutation refresh still runs');
  for(const [name,phase] of [['idle',result.idle],['mutations',result.mutations]]) {
    assert.equal(phase.revertedFrames,0,`Applied font reverted during ${name}`);
    assert.equal(phase.shiftedFrames,0,`Text geometry changed during ${name}`);
  }
  console.log('PASS font and geometry stay stable during unrelated DOM updates; new text still swaps');
} finally {clearTimeout(deadline);await cleanup();}
