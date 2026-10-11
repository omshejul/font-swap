(() => {
  if (globalThis.__fontSwapController) return;
  globalThis.__fontSwapController = true;
  const U = globalThis.FSFontUtils;
  const marker = `data-font-swap-${crypto.randomUUID().replaceAll('-','')}`;
  let source = '', destination = null, scope = 'all', selection = null, selectedElement = null;
  let selectedRuleId = '', draftTags = null;
  let active = false, compared = false, applied = false, picking = null, status = 'Pick text on the page';
  let revision = 0, styleRevision = 0, cssRule = '', owned = [], warnings = [], records = [], roots = [], rules = [];
  let pending = Promise.resolve(), timer, highlighted = null, highlightStyle, mutating = false, dirty = false;
  let tooltip = null, tooltipFont, tooltipTag, pickerBadge = null, badgeLabel = null, badgeHint = null, pickRuleId = '', failureMessage = '';
  let loadingBadge = null, loadingLabel, loadingToken = null, loadingFamily = '';
  let attentionOverlay = null, attentionTint, attentionOutline, badgeAttention, attentionTimer, attentionAnimations = [];
  const attentionTiming = {page:500, dialogue:400, delay:100, exit:200, reduced:500};
  const observers = new Map();
  const announce = (event,payload={}) => chrome.runtime.sendMessage({type:'FONT_SWAP_EVENT',event,...payload}).catch(()=>{});
  const serialize = operation => { const result = pending.then(operation); pending = result.catch(()=>{}); return result; };
  function textOf(element) {
    if (element.matches('input,textarea')) return element.type === 'password' ? '' : (element.value || element.placeholder || '');
    return [...element.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
  }
  function shadowOf(element) { try { return chrome.dom.openOrClosedShadowRoot(element); } catch { return element.shadowRoot; } }
  function scan() {
    // Read the website's fonts without leaving them visible for a browser frame.
    const previous = owned.filter(item=>item.inline ? item.element.style.getPropertyValue('font-family')===item.value && item.element.style.getPropertyPriority('font-family')==='important' : item.element.getAttribute(marker)===item.token);
    releaseOwned(owned);
    try { collect(); }
    finally { applyOwned(previous); for (const observer of observers.values()) observer.takeRecords(); }
  }
  function collect() {
    records = []; roots = []; let visited = 0;
    function walk(root) {
      roots.push(root);
      const walker = document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);
      let element;
      while ((element=walker.nextNode())) {
        if (++visited > 30000) break;
        if (element===tooltip || tooltip?.contains(element) || element===pickerBadge || element===attentionOverlay || element===loadingBadge || element.hasAttribute('data-font-swap-panel') || element.matches('script,style,noscript,template,head,svg,svg *,canvas')) continue;
        const shadow = shadowOf(element); if (shadow) walk(shadow);
        const text = textOf(element); if (!text) continue;
        const css = getComputedStyle(element);
        if (css.display==='none' || css.visibility==='hidden' || !element.getClientRects().length) continue;
        const family = U.parseStack(css.fontFamily)[0] || '';
        if (!family) continue;
        records.push({element,root,family,protected:U.protectedFont(family,text),stack:css.fontFamily,text,weight:css.fontWeight,style:css.fontStyle,size:css.fontSize});
      }
    }
    walk(document);
    warnings = warnings.filter(w=>!w.startsWith('Large page:'));
    if (visited>30000) warnings.push('Large page: scanning is limited to the first 30,000 elements.');
    for (const [root,observer] of observers) if (!roots.includes(root)) { observer.disconnect(); observers.delete(root); }
    for (const root of roots) if (!observers.has(root)) {
      const observer = new MutationObserver(changes => {
        if (!active) return;
        const ui=[tooltip,pickerBadge,attentionOverlay,loadingBadge,globalThis.__fontSwapPanelRoot?.host];
        changes=changes.filter(change=>!ui.some(node=>node && (change.target===node || node.contains(change.target))) &&
          !([...change.addedNodes,...change.removedNodes].length && [...change.addedNodes,...change.removedNodes].every(node=>ui.includes(node))));
        if (!changes.length) return;
        if (mutating) { dirty=true; return; }
        if (changes.some(change=>change.type!=='attributes' || ['style','class','hidden'].includes(change.attributeName))) schedule();
      });
      observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden']});
      observers.set(root,observer);
    }
  }
  function targets(nextScope=scope) { return records.filter(r=>!r.protected && (nextScope==='element' ? r.element===selectedElement : U.matches(r.stack,source))); }
  function matchesRule(record,rule) { return !record.protected && (rule.scope==='element' ? record.element===rule.element : U.matches(record.stack,rule.source)) && U.matchesTags(record.element,rule.tags); }
  function tagOptions(rule) {
    const tags = new Map();
    for (const record of records) {
      if (record.protected || !U.matches(record.stack,rule.source)) continue;
      for (const element of U.ancestors(record.element)) {
        if (['html','body'].includes(element.localName)) continue;
        if (!tags.has(element.localName)) tags.set(element.localName,new Set());
        tags.get(element.localName).add(element);
      }
    }
    return [...tags].map(([tag,elements])=>({tag,count:elements.size}));
  }
  function ruleFor(record) { return record && rules.findLast(rule=>matchesRule(record,rule)); }
  function selectedRule() { return rules.find(rule=>rule.id===selectedRuleId); }
  function sync() { active=rules.length>0; applied=active; destination=selectedRule()?.destination || null; }
  function currentState() {
    const fonts = new Map(); for (const r of records.filter(r=>!r.protected)) fonts.set(r.family,(fonts.get(r.family)||0)+1);
    return {url:location.href,selection,source,destination,scope,selectedRuleId,tags:selectedRule()?.tags ?? draftTags,count:targets().length,pageFonts:[...fonts].map(([family,count])=>({family,count})).sort((a,b)=>b.count-a.count),active,compared,applied,picking,status,loadingFamily,error:failureMessage,warnings:[...new Set(warnings)],rules:rules.map(rule=>({id:rule.id,source:rule.source,destination:rule.destination,scope:rule.scope,tags:rule.tags ?? null,count:records.filter(r=>matchesRule(r,rule)).length}))};
  }
  async function stylesheet(remove='',insert='') {
    if (!remove && !insert) return;
    const result = await chrome.runtime.sendMessage({type:'FONT_SWAP_CSS',remove,insert});
    if (!result?.ok) throw new Error(result?.error || 'Could not update page styles.');
  }
  async function clean() {
    mutating = true;
    try {
      await stylesheet(cssRule); cssRule = '';
      releaseOwned(owned);
      owned = [];
    } finally { for (const observer of observers.values()) observer.takeRecords(); mutating = false; if(dirty) { dirty=false; schedule(); } }
  }
  function releaseOwned(items) {
    for (const item of items) {
      if (item.inline && item.element.style.getPropertyValue('font-family')===item.value && item.element.style.getPropertyPriority('font-family')==='important') {
        if (item.before) item.element.style.setProperty('font-family',item.before,item.priority);
        else item.element.style.removeProperty('font-family');
      }
      if (item.element.getAttribute(marker)===item.token) item.element.removeAttribute(marker);
    }
  }
  function applyOwned(items) {
    for (const item of items) {
      if (!item.inline) item.element.setAttribute(marker,item.token);
      else {
        item.before = item.element.style.getPropertyValue('font-family'); item.priority = item.element.style.getPropertyPriority('font-family');
        item.element.style.setProperty('font-family',item.value,'important');
        item.value = item.element.style.getPropertyValue('font-family');
      }
    }
  }
  async function paint() {
    if (!active || compared) { await clean(); return; }
    const chosen = records.filter(record=>ruleFor(record));
    // Keep unselected text and icon glyphs on their original inherited stack.
    const changed=new Set(chosen.map(r=>r.element));
    const guards=records.filter(r=>{
      if(changed.has(r.element)) return false;
      let ancestor=r.element.parentElement || r.element.getRootNode().host;
      while(ancestor) { if(changed.has(ancestor)) return true; ancestor=ancestor.parentElement || ancestor.getRootNode().host; }
      return false;
    });
    const groups = new Map(), cssRules = [], nextOwned = [], prefix = `g${++styleRevision}_`;
    mutating = true;
    try {
      for (const record of [...chosen,...guards]) {
        const rule=ruleFor(record);
        const tail = rule && U.fallback(record.stack,rule.source);
        const value = !rule ? record.stack : `${rule.alias ? U.quote(rule.alias) : U.familyCSS(rule.destination.family)}${tail ? ', '+tail : ''}`;
        let token = groups.get(value);
        if (!token && record.root===document) { token = `${prefix}${groups.size}`; groups.set(value,token); cssRules.push(`[${marker}="${token}"] { font-family: ${value} !important; }`); }
        const item = {element:record.element,token,inline:record.root!==document,value};
        nextOwned.push(item);
      }
      // Install new selectors before switching ownership, so the old swap stays painted.
      const next = cssRules.join('\n'), previous = cssRule;
      await stylesheet('',next);
      releaseOwned(owned); applyOwned(nextOwned); owned=nextOwned; cssRule=next;
      for (const observer of observers.values()) observer.takeRecords();
      await stylesheet(previous);
    }
    finally { for (const observer of observers.values()) observer.takeRecords(); mutating=false; if(dirty) { dirty=false; schedule(); } }
    if (scope==='element' && !selectedElement?.isConnected) status='Selected text was removed. Pick it again.';
    else if (!chosen.length) status='No matching text on this page';
  }
  async function refresh() {
    scan(); await paint();
  }
  function schedule() {
    if(timer) return;
    timer=setTimeout(()=>{timer=null;serialize(async()=>{ await refresh(); announce('changed'); }).catch(()=>{});},150);
  }
  function showPickerBadge(mode=picking) {
    // Source picking spans frames. Show its instruction once on the main page.
    if (window!==window.top && mode!=='destination') { pickerBadge?.remove(); return; }
    if (!pickerBadge) {
      pickerBadge=document.createElement('div'); pickerBadge.setAttribute('data-font-swap-picker',''); pickerBadge.setAttribute('role','region');pickerBadge.setAttribute('aria-label','Font picker');
      const styles={all:'initial',position:'fixed',left:'50%',bottom:'20px',transform:'translateX(-50%)','z-index':'2147483646',display:'block','pointer-events':'auto',background:'#2c2c2c',color:'#fff',font:'12px/16px system-ui, sans-serif',padding:'12px','border-radius':'8px',border:'1px solid #ffffff24','box-shadow':'0 4px 16px #0003',width:'max-content','max-width':'calc(100vw - 24px)','box-sizing':'border-box'};
      for (const [key,value] of Object.entries(styles)) pickerBadge.style.setProperty(key,value,'important');
      const root=pickerBadge.attachShadow({mode:'closed'});
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
      for (const [key,value] of Object.entries({width:'16',height:'16',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) icon.setAttribute(key,value);
      icon.style.cssText='flex:none;color:#8ab4f8;margin-top:2px';
      for (const d of ['m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12','m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z','m2 22 .414-.414']) {
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);icon.append(path);
      }
      badgeLabel=document.createElement('span');
      badgeLabel.setAttribute('role','status');badgeLabel.style.cssText='display:block;font-size:13px;line-height:16px;font-weight:600';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.setAttribute('aria-label','Cancel picking');
      cancel.style.cssText='all:unset;display:inline-flex;align-items:center;align-self:center;gap:8px;box-sizing:border-box;height:28px;cursor:pointer;padding:0 8px;border-radius:6px;background:#ffffff14;color:#fff;font:inherit;flex:none;margin-left:4px';
      cancel.addEventListener('pointerenter',()=>{cancel.style.background='#ffffff24';});cancel.addEventListener('pointerleave',()=>{cancel.style.background='#ffffff14';});
      cancel.addEventListener('focus',()=>{cancel.style.outline='2px solid #8ab4f8';cancel.style.outlineOffset='2px';});cancel.addEventListener('blur',()=>{cancel.style.outline='';});
      cancel.addEventListener('click',event=>{event.stopPropagation();stopPicking();status='Picker cancelled';announce('cancelled');});
      const escape=document.createElement('kbd');escape.textContent='Esc';escape.setAttribute('aria-hidden','true');escape.style.cssText='font:11px/16px system-ui,sans-serif;color:#b3b3b3;border:1px solid #ffffff33;border-radius:4px;padding:0 3px';cancel.append(escape);
      const hint=document.createElement('div');hint.textContent='Hover text to see its font, then click it.';hint.style.cssText='color:#b3b3b3;margin-top:4px';
      badgeHint=hint;
      const text=document.createElement('div');text.style.cssText='flex:1;min-width:0;max-width:240px';text.append(badgeLabel,hint);
      badgeAttention=document.createElement('div');badgeAttention.style.cssText='position:absolute;inset:0;border-radius:inherit;background:rgba(66,133,244,.3);opacity:0;pointer-events:none';
      const row=document.createElement('div');row.style.cssText='position:relative;display:flex;align-items:flex-start;gap:8px';row.append(icon,text,cancel);
      root.append(badgeAttention,row);
    }
    badgeLabel.textContent=mode==='tag'?'Pick a tag':mode==='destination'?'Pick the replacement font':'Pick the font to replace';
    badgeHint.textContent=mode==='tag'?'Hover text to see its tag, then click it.':'Hover text to see its font, then click it.';
    document.documentElement.append(pickerBadge);
  }
  function showLoading(family,token) {
    if (!loadingBadge) {
      loadingBadge=document.createElement('div');loadingBadge.setAttribute('data-font-swap-loading','');loadingBadge.setAttribute('role','status');loadingBadge.setAttribute('aria-live','polite');
      const styles={all:'initial',position:'fixed',left:'50%',bottom:'20px',transform:'translateX(-50%)','z-index':'2147483646',display:'block','pointer-events':'none',background:'#2c2c2c',color:'#fff',font:'13px/20px system-ui, sans-serif',padding:'12px','border-radius':'8px',border:'1px solid #ffffff24','box-shadow':'0 4px 16px #0003',width:'max-content','max-width':'calc(100vw - 24px)','box-sizing':'border-box'};
      for (const [key,value] of Object.entries(styles)) loadingBadge.style.setProperty(key,value,'important');
      const root=loadingBadge.attachShadow({mode:'closed'}), sheet=new CSSStyleSheet();
      sheet.replaceSync('@keyframes spin{to{transform:rotate(360deg)}}svg{animation:spin .8s linear infinite}@media(prefers-reduced-motion:reduce){svg{animation:none}}');root.adoptedStyleSheets=[sheet];
      const spinner=document.createElementNS('http://www.w3.org/2000/svg','svg');
      for (const [key,value] of Object.entries({width:'16',height:'16',viewBox:'0 0 16 16',fill:'none','aria-hidden':'true'})) spinner.setAttribute(key,value);
      spinner.style.cssText='display:block;flex:none;color:#8ab4f8';
      const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
      for (const [key,value] of Object.entries({cx:'8',cy:'8',r:'6',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-dasharray':'28 10'})) circle.setAttribute(key,value);
      spinner.append(circle);
      loadingLabel=document.createElement('span');loadingLabel.style.cssText='min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:8px';row.append(spinner,loadingLabel);root.append(row);
    }
    loadingToken=token;loadingLabel.textContent=`Loading ${family}`;document.documentElement.append(loadingBadge);
  }
  function stopPicking() {
    if (picking || pickerBadge?.isConnected) clearAttention(true);
    picking=null; pickRuleId=''; unhighlight(); pickerBadge?.remove();
  }
  function clearAttention(fade=false) {
    clearTimeout(attentionTimer); attentionTimer=null;
    const opacity=fade && attentionOverlay?.isConnected && !matchMedia('(prefers-reduced-motion: reduce)').matches ? Number(getComputedStyle(attentionTint).opacity) : 0;
    for (const animation of attentionAnimations) animation.cancel();
    attentionAnimations=[];
    if (attentionTint) attentionTint.style.opacity='0';
    if (attentionOutline) attentionOutline.style.opacity='0';
    if (!opacity) { attentionOverlay?.remove(); return; }
    const animations=[attentionTint.animate([{opacity},{opacity:0}],{duration:attentionTiming.exit,easing:'ease-in-out'})];
    attentionAnimations=animations;
    animations[0].finished.then(()=>{if(attentionAnimations===animations) { attentionAnimations=[];attentionOverlay.remove(); }}).catch(()=>{});
  }
  function showAttention() {
    const opacity=attentionOverlay?.isConnected ? Number(getComputedStyle(attentionTint).opacity) : 0;
    clearAttention();
    if (!pickerBadge?.isConnected) return;
    if (!attentionOverlay) {
      attentionOverlay=document.createElement('div'); attentionOverlay.setAttribute('data-font-swap-attention',''); attentionOverlay.setAttribute('aria-hidden','true');
      const styles={all:'initial',position:'fixed',inset:'0',display:'block','pointer-events':'none','z-index':'2147483644'};
      for (const [key,value] of Object.entries(styles)) attentionOverlay.style.setProperty(key,value,'important');
      const root=attentionOverlay.attachShadow({mode:'closed'});
      attentionTint=document.createElement('div'); attentionTint.style.cssText='position:absolute;inset:0;background:linear-gradient(to right,rgba(66,133,244,.58),rgba(66,133,244,.22) 8%,transparent 22%),linear-gradient(to left,rgba(66,133,244,.58),rgba(66,133,244,.22) 8%,transparent 22%),linear-gradient(to bottom,rgba(66,133,244,.58),rgba(66,133,244,.22) 10%,transparent 28%),linear-gradient(to top,rgba(66,133,244,.58),rgba(66,133,244,.22) 10%,transparent 28%);opacity:0;pointer-events:none';
      attentionOutline=document.createElement('div'); attentionOutline.style.cssText='position:absolute;box-sizing:border-box;border:2px solid #8ab4f8;border-radius:10px;box-shadow:0 0 0 3px #8ab4f81f;opacity:0;pointer-events:none';
      root.append(attentionTint,attentionOutline);
    }
    const bounds=pickerBadge.getBoundingClientRect();
    Object.assign(attentionOutline.style,{left:`${bounds.left-2}px`,top:`${bounds.top-2}px`,width:`${bounds.width+4}px`,height:`${bounds.height+4}px`,opacity:'0'});
    document.documentElement.append(attentionOverlay);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      attentionTint.style.opacity='0.5';attentionOutline.style.opacity='1';
      attentionTimer=setTimeout(()=>{attentionOutline.style.opacity='0';attentionTimer=null;},attentionTiming.reduced); return;
    }
    const frames=[{opacity:0},{opacity:1,offset:0.3},{opacity:0}];
    const animations=[attentionTint.animate([{opacity},{opacity:0.5}],{duration:attentionTiming.page,easing:'ease-in-out',fill:'forwards'}),
      ...[attentionOutline,badgeAttention].map(element=>element.animate(frames,{delay:attentionTiming.delay,duration:attentionTiming.dialogue,easing:'ease-in-out'}))];
    attentionAnimations=animations;
  }
  function unhighlight() {
    if (tooltip) { tooltip.remove(); tooltip=null; }
    if (!highlighted) return;
    for (const [property,before] of Object.entries(highlightStyle)) {
      if (highlighted.style.getPropertyValue(property)!==before.applied || highlighted.style.getPropertyPriority(property)!=='important') continue;
      if (before.value) highlighted.style.setProperty(property,before.value,before.priority);
      else highlighted.style.removeProperty(property);
    }
    highlighted=null;
  }
  function showName(element,event) {
    if (!tooltip) {
      tooltip=document.createElement('div'); tooltip.setAttribute('data-font-swap-tooltip',''); tooltip.setAttribute('role','tooltip');
      const styles={all:'initial',position:'fixed','z-index':'2147483647','pointer-events':'none',display:'inline-flex','align-items':'center',gap:'8px',background:'#202124',color:'#fff',font:'14px/1.3 system-ui, sans-serif',padding:'7px 10px','border-radius':'6px','box-shadow':'0 2px 8px #0004','max-width':'calc(100vw - 16px)','box-sizing':'border-box','white-space':'nowrap',overflow:'hidden','text-overflow':'ellipsis'};
      for (const [key,value] of Object.entries(styles)) tooltip.style.setProperty(key,value,'important');
      tooltipFont=document.createElement('span'); tooltipTag=document.createElement('span');
      const fontStyles={all:'initial',display:'block',font:'14px/1.3 system-ui, sans-serif',color:'#fff','pointer-events':'none','min-width':'0',overflow:'hidden','text-overflow':'ellipsis','white-space':'nowrap'};
      const tagStyles={all:'initial',font:'11px/1 system-ui, sans-serif',color:'#8ab4f8','pointer-events':'none',padding:'2px 6px',border:'1px solid #8ab4f8','border-radius':'999px',flex:'none','white-space':'nowrap'};
      for (const [key,value] of Object.entries(fontStyles)) tooltipFont.style.setProperty(key,value,'important');
      for (const [key,value] of Object.entries(tagStyles)) tooltipTag.style.setProperty(key,value,'important');
      tooltip.append(tooltipFont,tooltipTag);
      document.documentElement.append(tooltip);
    }
    const record=records.find(r=>r.element===element);
    const visibleRule=compared ? null : ruleFor(record);
    const tags=picking==='source' ? sourcePickTags(record,element,visibleRule) : picking==='destination' ? selectedRule()?.tags ?? draftTags : null;
    const tag=Array.isArray(tags) && tags.length===1 ? tags[0] : '';
    tooltipFont.textContent=picking==='tag' ? `<${element.localName}>` : visibleRule?.destination.family || record?.family || U.parseStack(getComputedStyle(element).fontFamily)[0];
    tooltipTag.textContent=tag ? ` <${tag}> only` : '';
    tooltipTag.style.setProperty('display',tag ? 'block' : 'none','important');
    const bounds=tooltip.getBoundingClientRect();
    tooltip.style.setProperty('left',`${Math.max(8,Math.min(event.clientX+14,innerWidth-bounds.width-8))}px`,'important');
    tooltip.style.setProperty('top',`${Math.max(8,Math.min(event.clientY+18,innerHeight-bounds.height-8))}px`,'important');
  }
  function sourcePickTags(record,element,rule) {
    if (rule) return rule.tags ?? null;
    return record && rules.some(rule=>U.matches(record.stack,rule.source) && Array.isArray(rule.tags)) ? [element.localName] : null;
  }
  function locate(event) {
    if (panelEvent(event)) return null;
    let element = event.composedPath().find(n=>n instanceof Element) || event.target;
    // Closed shadow roots hide their child nodes from composedPath.
    let shadow;
    while ((shadow=shadowOf(element))) { const inside=shadow.elementFromPoint(event.clientX,event.clientY); if (!inside || inside===element) break; element=inside; }
    if (picking==='tag' && (element.namespaceURI!=='http://www.w3.org/1999/xhtml' || element.matches('html,body,script,style,noscript,template,head,canvas'))) return null;
    while (element && element!==document.documentElement) {
      if (picking==='tag' && element.localName==='body') return null;
      if (textOf(element) && !U.protectedFont(U.parseStack(getComputedStyle(element).fontFamily)[0] || '',textOf(element))) return element;
      element=element.parentElement || element.getRootNode().host;
    }
    return null;
  }
  document.addEventListener('pointermove',event=>{
    if (!picking) return;
    const element=locate(event); if (element===highlighted) { if(element) showName(element,event); return; }
    unhighlight(); if (!element) return;
    highlighted=element; highlightStyle={};
    for (const [property,value] of Object.entries({outline:'1px solid rgba(45, 105, 231, 0.45)','background-color':'rgba(45, 105, 231, 0.08)',cursor:'pointer'})) {
      const before={value:element.style.getPropertyValue(property),priority:element.style.getPropertyPriority(property)};
      element.style.setProperty(property,value,'important');
      before.applied=element.style.getPropertyValue(property); highlightStyle[property]=before;
    }
    showName(element,event);
  },true);
  const panelEvent = event => event.composedPath().some(node=>node instanceof Element && node.matches('[data-font-swap-panel],[data-font-swap-picker],[data-font-swap-attention],[data-font-swap-loading]'));
  window.addEventListener('pointerdown',event=>{if(picking && !panelEvent(event)) {event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('click',event=>{
    if (!picking) return;
    const element=locate(event); if (!element) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const mode=picking, tagRuleId=pickRuleId, visibleRule=!compared && ruleFor(records.find(r=>r.element===element)); stopPicking();
    serialize(async()=>{
      if (mode==='tag') {
        const rule=rules.find(rule=>rule.id===tagRuleId); if (!rule) return;
        const tag=element.localName, choices=tagOptions(rule);
        const all=rule.tags==null || (choices.length>0 && choices.every(choice=>rule.tags.includes(choice.tag)));
        const duplicate=!all && rule.tags.includes(tag);
        rule.tags=U.normalizeTags(all ? [tag] : [...rule.tags,tag]);
        revision++; await paint(); status=all ? `Now applies to ${tag} only` : duplicate ? `${tag} is already picked` : `Added ${tag}`;
        announce('tags-picked'); return;
      }
      await clean(); scan();
      const record=records.find(r=>r.element===element);
      if (!record) { await paint(); status='Pick visible text instead of an image or icon.'; announce('changed'); return; }
      if (mode==='source') {
        compared=false; source=record.family; selectedElement=element; scope='all';
        selectedRuleId=visibleRule?.id || '';
        // Uncovered text gets its own tag scope instead of replacing a filtered sibling.
        draftTags=selectedRuleId ? null : sourcePickTags(record,element,null);
        sync();
        const estimate=U.estimate(element,record.stack);
        selection={family:record.family,stack:record.stack,text:record.text.slice(0,160),tag:element.tagName.toLowerCase(),weight:record.weight,style:record.style,size:record.size,confidence:estimate && U.normalize(estimate)===U.normalize(record.family) ? 'estimated' : 'css'};
        warnings=[];
        status='Choose a font'; revision++; await paint(); announce('picked');
      } else {
        const pickedDestination=visibleRule?.destination || {kind:'page',family:record.family};
        await paint(); loadingFamily=pickedDestination.family;status='Loading font'; announce('changed');
        announce('destination-picked',{destination:pickedDestination});
      }
    }).catch(error=>{failureMessage=status=error.message; announce('changed');});
  },true);
  document.addEventListener('keydown',event=>{ if (event.key==='Escape' && (picking || pickerBadge?.isConnected)) { stopPicking(); status='Picker cancelled'; announce('cancelled'); } },true);
  async function loadFaces(destination,fontData) {
    let loaded=[], nextAlias='';
    if (destination.kind==='google') {
      nextAlias=`FontSwap_${crypto.randomUUID().replaceAll('-','')}`;
      try {
        for (const face of fontData.faces) {
          const binary=Uint8Array.from(atob(fontData.binaries[face.id]),c=>c.charCodeAt(0));
          const font=new FontFace(nextAlias,binary,face.descriptors); await font.load(); loaded.push(font);
        }
      } catch { throw new Error('Chrome could not load this font. The previous preview is unchanged.'); }
    }
    return {alias:nextAlias,fontFaces:loaded};
  }
  async function preview(message) {
    if (message.revision!==revision) throw new Error('The origin changed while loading. Choose the destination again.');
    if (message.destination.kind==='page' && !records.some(r=>U.normalize(r.family)===U.normalize(message.destination.family))) throw new Error('That font is no longer used on this page. Pick it again.');
    const {alias:nextAlias,fontFaces:loaded}=await loadFaces(message.destination,message.font);
    if (message.revision!==revision) throw new Error('The origin changed. Choose the destination again.');
    await clean();
    const nextScope=message.scope==='element'?'element':'all';
    const chosen=selectedRule();
    const previous=chosen?.scope===nextScope ? chosen : null;
    const next={id:previous?.id || crypto.randomUUID(),source,destination:message.destination,scope:nextScope,tags:previous ? previous.tags : draftTags,element:selectedElement,alias:nextAlias,fontFaces:loaded};
    if (previous) rules=rules.map(rule=>rule===previous ? next : rule); else rules.push(next);
    selectedRuleId=next.id; draftTags=null;
    for (const face of previous?.fontFaces || []) document.fonts.delete(face);
    for (const face of loaded) document.fonts.add(face);
    destination=message.destination; scope=nextScope;
    warnings=warnings.filter(w=>!w.includes('closest available face'));
    warnings.push(...(message.font?.warnings || []));
    sync(); compared=false; status='Applied'; loadingFamily=''; scan(); await paint();
  }
  async function command(message) {
    if (message.action==='ping') return {};
    if (message.action==='tag-guide') { showPickerBadge('tag'); showAttention(); return {}; }
    if (message.action==='loading') {
      if (message.family) showLoading(message.family,message.token);
      else if (message.token===loadingToken) { loadingBadge?.remove();loadingToken=null; }
      return {};
    }
    if (message.action==='state') { if (!active) scan(); return currentState(); }
    if (message.action==='tag-options') {
      const rule=rules.find(rule=>rule.id===message.ruleId); if (!rule) throw new Error('This swap is no longer on the page.');
      return {tags:tagOptions(rule)};
    }
    if (message.action==='failure') { loadingFamily='';failureMessage=status=message.error; return currentState(); }
    failureMessage='';
    if (['pick','cancel','source','select','remove','undo'].includes(message.action)) loadingFamily='';
    if (message.action==='pick') {
      if (!['source','destination','tag'].includes(message.mode)) throw new Error('Choose what to pick.');
      if (message.mode==='tag' && !rules.some(rule=>rule.id===message.ruleId)) throw new Error('This swap is no longer on the page.');
      picking=message.mode; pickRuleId=message.mode==='tag' ? message.ruleId : ''; unhighlight(); showPickerBadge(); showAttention();
      status=message.mode==='tag'?'Click text to pick its tag':message.mode==='source'?'Click text to replace its font':'Click text to use its font'; return currentState();
    }
    if (message.action==='cancel') { stopPicking(); status='Picker cancelled'; return currentState(); }
    if (message.action==='prepare-restore') {
      scan();
      return {revision,rules:message.rules.map(rule=>({...rule,styles:[...new Map(records.filter(r=>U.matches(r.stack,rule.source)).map(r=>[`${r.weight}:${r.style}`,{weight:r.weight,style:r.style}])).values()].concat({weight:'400',style:'normal'})}))};
    } else if (message.action==='restore') {
      if (message.revision!==revision || rules.length || picking) return currentState();
      const restored=await Promise.all(message.rules.map(async rule=>({id:crypto.randomUUID(),source:rule.source,destination:rule.destination,scope:'all',tags:U.normalizeTags(rule.tags),element:null,...await loadFaces(rule.destination,rule.font)})));
      rules=restored;
      for(const rule of rules) for(const face of rule.fontFaces) document.fonts.add(face);
      source=rules[0]?.source || ''; selectedRuleId=rules[0]?.id || ''; draftTags=null; scope='all'; sync(); revision++; status='Applied'; scan(); await paint();
    } else if (message.action==='source') {
      if (typeof message.family!=='string' || !message.family.trim() || message.family.length>200) throw new Error('Choose an origin font.');
      await clean(); compared=false; source=message.family.trim();
      selectedRuleId=rules.findLast(rule=>U.normalize(rule.source)===U.normalize(source) && (rule.scope!=='element' || rule.element===selectedElement))?.id || ''; draftTags=null; sync();
      if (selection && U.normalize(selection.family)!==U.normalize(source)) { selection=null; selectedElement=null; scope='all'; }
      revision++; scan(); await paint(); status=targets().length?'Choose a font':'No matching text on this page';
    } else if (message.action==='prepare') {
      await refresh(); revision++; const chosen=targets(message.scope==='element'?'element':'all');
      return {revision,styles:[...new Map(chosen.map(r=>[`${r.weight}:${r.style}`,{weight:r.weight,style:r.style}])).values()]};
    } else if (message.action==='preview') await preview(message);
    else if (message.action==='tags') {
      const rule=rules.find(rule=>rule.id===message.ruleId); if (!rule) throw new Error('This swap is no longer on the page.');
      const tags=U.normalizeTags(message.tags);
      rule.tags=tags; revision++; status='Applied'; await paint();
    }
    else if (message.action==='select') {
      const rule=rules.find(rule=>rule.id===message.ruleId); if(!rule) throw new Error('This swap is no longer on the page.');
      source=rule.source; selectedRuleId=rule.id; draftTags=null; scope=rule.scope; selectedElement=rule.element; destination=rule.destination; stopPicking(); revision++; status='Choose a font';
    } else if (message.action==='remove') {
      const rule=rules.find(rule=>rule.id===message.ruleId); if(!rule) throw new Error('This swap is no longer on the page.');
      if (pickRuleId===rule.id) { stopPicking(); announce('cancelled'); }
      await clean(); rules=rules.filter(item=>item!==rule); for(const face of rule.fontFaces) document.fonts.delete(face); if(selectedRuleId===rule.id) selectedRuleId=''; sync(); revision++; scan(); await paint(); status=active?'Applied':'Original fonts restored';
    }
    else if (message.action==='apply') { if (!active) throw new Error('Choose a destination first.'); if (compared) { compared=false; await refresh(); } applied=true; status='Applied'; }
    else if (message.action==='undo') {
      await clean(); compared=false; revision++;
      for (const rule of rules) for (const face of rule.fontFaces) document.fonts.delete(face); rules=[]; selectedRuleId=''; draftTags=null; sync(); stopPicking(); scan(); status='Original fonts restored';
    } else if (message.action==='compare') { if (!active) throw new Error('Choose a destination first.'); compared=!!message.enabled; await refresh(); status=compared?'Showing original':applied?'Applied':'Previewing'; }
    else throw new Error('Unknown page action.');
    return currentState();
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if (sender.id!==chrome.runtime.id || message.type!=='FONT_SWAP') return false;
    serialize(()=>command(message)).then(value=>respond(value),error=>respond({error:error.message})); return true;
  });
  window.addEventListener('resize',()=>{if(active)schedule();});
  document.fonts.addEventListener('loadingdone',()=>{if(active)schedule();});
  scan();
})();
