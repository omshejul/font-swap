import {getCatalog, loadGoogleFont} from './fonts.js';

const frames = new Map();
const selected = new Map();
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
  if (!Number.isInteger(tabId)) throw new Error('Open a website, then click the Font Swap toolbar button.');
  const tab = await chrome.tabs.get(tabId);
  if(!tab.url) throw new Error('Click the Font Swap toolbar button on this website to allow access.');
  if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Font Swap works on regular websites. Browser pages, PDFs and the Chrome Web Store are not supported.');
  const candidates = await chrome.webNavigation.getAllFrames({tabId}) || [{frameId:0}];
  const attempts = await Promise.allSettled(candidates.map(async ({frameId}) => {
    await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},files:['font-utils.js','content.js']});
    await page(tabId,frameId,'ping');
    return frameId;
  }));
  const allowed = attempts.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  if (!allowed.includes(0)) throw new Error('Click the Font Swap toolbar button on this website to allow access. Some protected pages cannot be changed.');
  frames.set(tabId,{allowed,blocked:candidates.length-allowed.length});
  if (!allowed.includes(await selectedFrame(tabId))) await remember(tabId,0);
  return state(tabId);
}
async function state(tabId) {
  const frameId = await selectedFrame(tabId);
  const result = await page(tabId,frameId,'state');
  const info = frames.get(tabId);
  result.tabId = tabId; result.frameId = frameId;
  if(result.picking==='destination') result.warnings.push('Pick a destination in the same document as the origin.');
  if (info?.blocked) result.warnings.push('Some embedded frames are not accessible with this website permission.');
  if (frameId !== 0) result.warnings.push('This swap applies inside the selected frame.');
  return result;
}
async function broadcast(tabId) {
  try { await chrome.runtime.sendMessage({type:'STATE_CHANGED',tabId,state:await state(tabId)}); } catch { /* Panel closed or page navigated. */ }
}
async function panel(message) {
  const {action,tabId} = message;
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
    if (results.every(r=>r.status === 'rejected')) throw new Error('The page changed. Reopen Font Swap to reconnect.');
  } else if (action === 'preview') {
    const destination = message.destination;
    if (!destination || !['google','page'].includes(destination.kind) || typeof destination.family !== 'string' || destination.family.length > 200) throw new Error('Choose a destination font.');
    const prepared = await page(tabId,frameId,'prepare',{scope:message.scope});
    if (!prepared.styles.length) throw new Error('No matching text. Pick text or choose a font used on this page.');
    const font = destination.kind === 'google' ? await loadGoogleFont(destination.family,prepared.styles) : null;
    await page(tabId,frameId,'preview',{destination,scope:message.scope,font,revision:prepared.revision});
  } else if (['source','apply','undo','compare'].includes(action)) {
    await page(tabId,frameId,action,{family:message.family,enabled:message.enabled});
  } else throw new Error('Unknown Font Swap action.');
  const result = await state(tabId);
  await chrome.runtime.sendMessage({type:'STATE_CHANGED',tabId,state:result}).catch(()=>{});
  return {state:result};
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  let work;
  if (message.type === 'PANEL' && !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''))) work = panel(message);
  // Extension pages opened as a tab also carry sender.tab.
  else if (message.type === 'PANEL' && sender.url?.startsWith(chrome.runtime.getURL(''))) work = panel(message);
  else if (message.type === 'FONT_SWAP_CSS' && sender.tab) work = (async () => {
    const target = {tabId:sender.tab.id,frameIds:[sender.frameId]};
    if (message.remove) await chrome.scripting.removeCSS({target,css:message.remove,origin:'USER'});
    if (message.insert) await chrome.scripting.insertCSS({target,css:message.insert,origin:'USER'});
    return {};
  })();
  else if (message.type === 'FONT_SWAP_EVENT' && sender.tab) work = (async () => {
    if (message.event === 'picked') {
      const previous=await selectedFrame(sender.tab.id);
      if(previous!==sender.frameId) await page(sender.tab.id,previous,'undo').catch(()=>{});
      await remember(sender.tab.id,sender.frameId);
      await Promise.allSettled((frames.get(sender.tab.id)?.allowed || []).filter(id=>id!==sender.frameId).map(id=>page(sender.tab.id,id,'cancel')));
    }
    await broadcast(sender.tab.id); return {};
  })();
  else return false;
  work.then(value=>respond({ok:true,...value}),error=>respond({ok:false,error:error.message || 'Font Swap could not complete this action.'}));
  return true;
});
chrome.action.onClicked.addListener(async tab => {
  // Open during the original toolbar gesture; normal action grants activeTab.
  chrome.sidePanel.open({tabId:tab.id}).catch(()=>{});
  try { await connect(tab.id); await panel({action:'pick',tabId:tab.id,mode:'source'}); } catch { /* The panel presents connection errors. */ }
});
chrome.tabs.onRemoved.addListener(tabId => { frames.delete(tabId); selected.delete(tabId); chrome.storage.session.remove(`frame:${tabId}`); });
chrome.webNavigation.onCommitted.addListener(({tabId,frameId}) => {
  if (frameId === 0) { frames.delete(tabId); selected.delete(tabId); chrome.storage.session.remove(`frame:${tabId}`); }
});
