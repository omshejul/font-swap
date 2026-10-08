import {getCatalog, loadGoogleFont} from './fonts.js';
import {siteOrigin, sitePattern, siteKey, savedPairs} from './sites.js';

const frames = new Map();
const selected = new Map();
const restoring = new Map();
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(() => {});
async function page(tabId, frameId, action, payload = {}) {
  const result = await chrome.tabs.sendMessage(tabId, {type:'FONT_SWAP',action,...payload}, {frameId});
  if (result?.error) throw new Error(result.error);
  return result;
}
async function selectedFrame(tabId) {
  if (!selected.has(tabId)) {
    const stored = await chrome.storage.session.get(`frame:${tabId}`);
    selected.set(tabId, stored[`frame:${tabId}`] ?? 0);
  }
  return selected.get(tabId);
}
async function remember(tabId, frameId) {
  selected.set(tabId,frameId);
  await chrome.storage.session.set({[`frame:${tabId}`]:frameId});
}
async function connect(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('Open a website, then click the SwapFont toolbar button.');
  await restoring.get(tabId);
  const tab = await chrome.tabs.get(tabId);
  if(!tab.url) throw new Error('Click the SwapFont toolbar button on this website to allow access.');
  if (!/^https?:\/\//.test(tab.url || '')) throw new Error('SwapFont works on regular websites. Browser pages, PDFs and the Chrome Web Store are not supported.');
  const candidates = await chrome.webNavigation.getAllFrames({tabId}) || [{frameId:0}];
  const attempts = await Promise.allSettled(candidates.map(async ({frameId}) => {
    await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},files:['font-utils.js','content.js']});
    await page(tabId,frameId,'ping');
    return frameId;
  }));
  const allowed = attempts.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  if (!allowed.includes(0)) throw new Error('Click the SwapFont toolbar button on this website to allow access. Some protected pages cannot be changed.');
  frames.set(tabId,{allowed,blocked:candidates.length-allowed.length});
  if (!allowed.includes(await selectedFrame(tabId))) await remember(tabId,0);
  return state(tabId);
}
async function state(tabId) {
  const frameId = await selectedFrame(tabId);
  const result = await page(tabId,frameId,'state');
  const info = frames.get(tabId);
  const others=await Promise.allSettled((info?.allowed || [frameId]).filter(id=>id!==frameId).map(async id=>({id,state:await page(tabId,id,'state')})));
  result.rules=[...(result.rules || []).map(rule=>({...rule,frameId})),...others.flatMap(item=>item.status==='fulfilled' ? (item.value.state.rules || []).map(rule=>({...rule,frameId:item.value.id})) : [])];
  result.active=result.applied=result.rules.length>0;
  result.tabId = tabId; result.frameId = frameId;
  result.siteOrigin = siteOrigin(frameId===0 ? result.url : others.find(item=>item.status==='fulfilled' && item.value.id===0)?.value.state.url);
  if (result.siteOrigin!==siteOrigin((await chrome.tabs.get(tabId)).url)) throw new Error('The page changed. Reopen SwapFont to reconnect.');
  result.remembered = Boolean((await chrome.storage.local.get(siteKey(result.siteOrigin)))[siteKey(result.siteOrigin)]);
  if(result.picking==='destination') result.warnings.push('Pick a destination in the same document as the origin.');
  if (info?.blocked) result.warnings.push('Some embedded frames are not accessible with this website permission.');
  if (frameId !== 0) result.warnings.push('This swap applies inside the selected frame.');
  return result;
}
async function broadcast(tabId) {
  try { await notify(tabId,await state(tabId)); } catch { /* Panel closed or page navigated. */ }
}
async function notify(tabId,result) {
  const message={type:'STATE_CHANGED',tabId,state:result};
  await Promise.allSettled([
    chrome.tabs.sendMessage(tabId,message,{frameId:0}),
    chrome.runtime.sendMessage(message),
  ]);
}

async function saveSite(tabId, result) {
  const origin=result.siteOrigin;
  const key=siteKey(origin);
  if (origin!==siteOrigin((await chrome.tabs.get(tabId)).url)) return;
  if (!origin || !(await chrome.storage.local.get(key))[key]) return;
  const rules=savedPairs(result.rules);
  if (rules.length) await chrome.storage.local.set({[key]:{rules}});
  else await chrome.storage.local.remove(key);
  result.remembered=rules.length>0;
}

async function restoreSite({tabId,documentId,url}) {
  const origin=siteOrigin(url), key=siteKey(origin);
  if (!origin || !(await chrome.permissions.contains({origins:[sitePattern(origin)]}))) return;
  const config=(await chrome.storage.local.get(key))[key];
  if (!config?.rules?.length) return;
  // Target this document, so a slow font download cannot change a later navigation.
  const target={tabId,documentIds:[documentId]};
  const command=async (action,payload={}) => {
    const result=await chrome.tabs.sendMessage(tabId,{type:'FONT_SWAP',action,...payload},{documentId});
    if(result?.error) throw new Error(result.error);
    return result;
  };
  await chrome.scripting.executeScript({target,files:['font-utils.js','content.js']});
  try {
    const prepared=await command('prepare-restore',{rules:config.rules});
    const rules=await Promise.all(prepared.rules.map(async rule=>({...rule,font:rule.destination.kind==='google' ? await loadGoogleFont(rule.destination.family,rule.styles) : null})));
    // Disabling or editing remembering during the download invalidates this restore.
    if (JSON.stringify((await chrome.storage.local.get(key))[key])!==JSON.stringify(config)) return;
    if (!(await chrome.permissions.contains({origins:[sitePattern(origin)]}))) return;
    await command('restore',{rules,revision:prepared.revision});
    await broadcast(tabId);
  } catch(error) {
    await command('failure',{error:`Could not restore saved fonts. ${error.message}`}).catch(()=>{});
  }
}

async function openFloating(tabId, startPicking=false) {
  const current=await connect(tabId);
  await chrome.scripting.executeScript({target:{tabId},files:['floating.js']});
  await chrome.scripting.executeScript({target:{tabId},files:['sidepanel.js']});
  if (startPicking && !current.source) await panel({action:'pick',tabId,mode:'source'});
  else await broadcast(tabId);
}
async function hideFloating(windowId) {
  const tabs=await chrome.tabs.query({windowId});
  await Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:'HIDE_FLOATING'},{frameId:0})));
}
async function closeSidePanel(windowId) {
  if (chrome.sidePanel.close) await chrome.sidePanel.close({windowId});
  else {
    // Chrome 116–140 can close by disabling, then restore availability for the next dock click.
    await chrome.sidePanel.setOptions({enabled:false});
    await chrome.sidePanel.setOptions({enabled:true});
  }
}
async function switchMode(tabId,mode) {
  if (!['floating','sidepanel'].includes(mode)) throw new Error('Choose a panel mode.');
  // Keep open() in the dock click's original user gesture, before any await.
  if (mode==='sidepanel') await chrome.sidePanel.open({tabId});
  const tab=await chrome.tabs.get(tabId);
  await panel({action:'cancel',tabId});
  if (mode==='floating') {
    await openFloating(tabId);
    await closeSidePanel(tab.windowId);
  } else await hideFloating(tab.windowId);
  await chrome.storage.local.set({panelMode:mode});
  return {};
}
async function panel(message, permission) {
  const {action,tabId} = message;
  if (action==='remember') {
    if (message.enabled && !await permission) throw new Error('Chrome needs permission to remember swaps on this site.');
    const result=await state(tabId), origin=result.siteOrigin;
    if (!origin || origin!==message.origin) throw new Error('The page changed. Try again.');
    const key=siteKey(origin), rules=savedPairs(result.rules);
    if (message.enabled) {
      if (!rules.length) throw new Error('Pick a font on the main page first. Embedded-frame swaps stay temporary.');
      await chrome.storage.local.set({[key]:{rules}});
    } else await chrome.storage.local.remove(key);
    result.remembered=Boolean(message.enabled);
    await notify(tabId,result);
    return {state:result};
  }
  if (action === 'mode') return switchMode(tabId,message.mode);
  if (action === 'ui') {
    const [html,css,icon] = await Promise.all(['sidepanel.html','sidepanel.css','icons/icon.svg'].map(file=>fetch(chrome.runtime.getURL(file)).then(r=>r.text())));
    const logo = Array.from(new Uint8Array(await fetch(chrome.runtime.getURL('icons/google-fonts.png')).then(r=>r.arrayBuffer())));
    return {html,css,icon,logo,tabId};
  }
  if (action === 'catalog') return {catalog:await getCatalog()};
  if (action === 'sample') {
    const loaded = await loadGoogleFont(message.family,[{weight:'400',style:'normal'}],true);
    return {preview:{family:loaded.family,faces:loaded.faces.map(face => ({descriptors:face.descriptors,bytes:Array.from(atob(loaded.binaries[face.id]),c=>c.charCodeAt(0))}))}};
  }
  if (action === 'connect') return {state:await connect(tabId)};
  if (!frames.has(tabId)) await connect(tabId);
  const frameId = await selectedFrame(tabId);
  if (action === 'state') return {state:await state(tabId)};
  if (action === 'pick' || action === 'cancel') {
    const results = await Promise.allSettled((action==='pick' && message.mode==='destination' ? [frameId] : frames.get(tabId).allowed).map(id => page(tabId,id,action,{mode:message.mode})));
    if (results.every(r=>r.status === 'rejected')) throw new Error('The page changed. Reopen SwapFont to reconnect.');
  } else if (action === 'preview') {
    const destination = message.destination;
    if (!destination || !['google','page'].includes(destination.kind) || typeof destination.family !== 'string' || destination.family.length > 200) throw new Error('Choose a destination font.');
    const prepared = await page(tabId,frameId,'prepare',{scope:message.scope});
    if (!prepared.styles.length) throw new Error('No matching text. Pick text or choose a font used on this page.');
    const token=crypto.randomUUID();
    await page(tabId,0,'loading',{family:destination.family,token}).catch(()=>{});
    try {
      const font = destination.kind === 'google' ? await loadGoogleFont(destination.family,prepared.styles) : null;
      await page(tabId,frameId,'preview',{destination,scope:message.scope,font,revision:prepared.revision});
    } finally { await page(tabId,0,'loading',{token}).catch(()=>{}); }
  } else if (action==='undo') {
    const results=await Promise.allSettled(frames.get(tabId).allowed.map(id=>page(tabId,id,'undo')));
    if(results.some(result=>result.status==='rejected')) throw new Error('A frame changed. Reopen SwapFont to restore the remaining swaps.');
  } else if (action==='remove' || action==='select') {
    if(!frames.get(tabId).allowed.includes(message.frameId)) throw new Error('This frame is no longer available. Pick text again.');
    await page(tabId,message.frameId,action,{ruleId:message.ruleId});
    if(action==='select') { await remember(tabId,message.frameId); await Promise.allSettled(frames.get(tabId).allowed.map(id=>page(tabId,id,'cancel'))); }
  } else if (['source','apply','compare'].includes(action)) {
    await page(tabId,frameId,action,{family:message.family,enabled:message.enabled});
  } else throw new Error('Unknown SwapFont action.');
  const result = await state(tabId);
  if (['preview','remove','undo'].includes(action)) await saveSite(tabId,result);
  await notify(tabId,result);
  return {state:result};
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  let work;
  // Request synchronously in the checkbox click's message, before any await.
  const trustedPanel=message.type==='PANEL' && (sender.url?.startsWith(chrome.runtime.getURL('')) || (sender.tab && sender.frameId===0));
  const origin=siteOrigin(sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')) ? sender.url : message.origin);
  const permission=trustedPanel && message.action==='remember' && message.enabled && origin ? chrome.permissions.request({origins:[sitePattern(origin)]}) : Promise.resolve(false);
  if (message.type === 'PANEL' && !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''))) work = panel(message,permission);
  // Floating controls are trusted content-script code. Always use the sender's tab.
  else if (message.type === 'PANEL' && sender.tab && sender.frameId === 0 && !sender.url?.startsWith(chrome.runtime.getURL(''))) work = panel({...message,tabId:sender.tab.id},permission);
  // Extension pages opened as a tab also carry sender.tab.
  else if (message.type === 'PANEL' && sender.url?.startsWith(chrome.runtime.getURL(''))) work = panel(message,permission);
  else if (message.type === 'FONT_SWAP_CSS' && sender.tab) work = (async () => {
    const target = {tabId:sender.tab.id,documentIds:[sender.documentId]};
    if (message.remove) await chrome.scripting.removeCSS({target,css:message.remove,origin:'USER'});
    if (message.insert) await chrome.scripting.insertCSS({target,css:message.insert,origin:'USER'});
    return {};
  })();
  else if (message.type === 'FONT_SWAP_EVENT' && sender.tab) work = (async () => {
    if (message.event === 'picked' || message.event === 'cancelled') {
      if (message.event === 'picked') await remember(sender.tab.id,sender.frameId);
      await Promise.allSettled((frames.get(sender.tab.id)?.allowed || []).filter(id=>id!==sender.frameId).map(id=>page(sender.tab.id,id,'cancel')));
    } else if(message.event==='destination-picked' && sender.frameId===await selectedFrame(sender.tab.id)) {
      try { await panel({action:'preview',tabId:sender.tab.id,destination:message.destination,scope:'all'}); }
      catch(error) { await page(sender.tab.id,sender.frameId,'failure',{error:error.message}).catch(()=>{}); }
    }
    await broadcast(sender.tab.id); return {};
  })();
  else return false;
  work.then(value=>respond({ok:true,...value}),error=>respond({ok:false,error:error.message || 'SwapFont could not complete this action.'}));
  return true;
});
chrome.action.onClicked.addListener(tab => chrome.storage.local.get('panelMode', stored => {
  // Chrome preserves the gesture in extension API callbacks, unlike an await continuation.
  const floating=stored.panelMode==='floating';
  const opening=floating ? openFloating(tab.id,true) : chrome.sidePanel.open({tabId:tab.id});
  (async () => {
  try {
    await opening;
    if (floating) {
      await closeSidePanel(tab.windowId);
    } else {
      await hideFloating(tab.windowId);
      const current=await connect(tab.id);
      if (!current.source) await panel({action:'pick',tabId:tab.id,mode:'source'});
      else await broadcast(tab.id);
    }
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
    await chrome.action.setTitle({tabId:tab.id,title:'Open SwapFont'});
  } catch (error) {
    await chrome.action.setBadgeText({tabId:tab.id,text:'!'});
    await chrome.action.setTitle({tabId:tab.id,title:error.message});
  }
  })();
}));
chrome.tabs.onRemoved.addListener(tabId => { frames.delete(tabId); selected.delete(tabId); chrome.storage.session.remove(`frame:${tabId}`); });
chrome.webNavigation.onCommitted.addListener(({tabId,frameId}) => {
  if (frameId === 0) { frames.delete(tabId); selected.delete(tabId); chrome.storage.session.remove(`frame:${tabId}`); }
});
chrome.webNavigation.onDOMContentLoaded.addListener(details => {
  if (details.frameId!==0) return;
  const work=restoreSite(details).catch(()=>{});
  restoring.set(details.tabId,work);
  work.finally(()=>{if(restoring.get(details.tabId)===work) restoring.delete(details.tabId);});
});
chrome.permissions.onRemoved.addListener(async () => {
  const stored=await chrome.storage.local.get(null);
  for (const key of Object.keys(stored).filter(key=>key.startsWith('site:'))) {
    if (!(await chrome.permissions.contains({origins:[sitePattern(key.slice(5))]}))) await chrome.storage.local.remove(key);
  }
});
