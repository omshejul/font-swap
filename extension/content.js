(() => {
  if (globalThis.__fontSwapController) return;
  globalThis.__fontSwapController = true;
  const U = globalThis.FSFontUtils;
  const marker = `data-font-swap-${crypto.randomUUID().replaceAll('-','')}`;
  let source = '', destination = null, scope = 'all', selection = null, selectedElement = null;
  let active = false, compared = false, applied = false, picking = null, status = 'Pick text on the page';
  let revision = 0, cssRule = '', owned = [], warnings = [], records = [], roots = [], rules = [];
  let pending = Promise.resolve(), timer, highlighted = null, highlightStyle, mutating = false, dirty = false;
  let tooltip = null, pickerBadge = null, badgeLabel = null, failureMessage = '';
  const observers = new Map();
  const announce = (event,payload={}) => chrome.runtime.sendMessage({type:'FONT_SWAP_EVENT',event,...payload}).catch(()=>{});
  const serialize = operation => { const result = pending.then(operation); pending = result.catch(()=>{}); return result; };
  function textOf(element) {
    if (element.matches('input,textarea')) return element.type === 'password' ? '' : (element.value || element.placeholder || '');
    return [...element.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
  }
  function shadowOf(element) { try { return chrome.dom.openOrClosedShadowRoot(element); } catch { return element.shadowRoot; } }
  function scan() {
    records = []; roots = []; let visited = 0;
    function walk(root) {
      roots.push(root);
      const walker = document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);
      let element;
      while ((element=walker.nextNode())) {
        if (++visited > 30000) break;
        if (element===tooltip || element===pickerBadge || element.hasAttribute('data-font-swap-panel') || element.matches('script,style,noscript,template,head,svg,svg *,canvas')) continue;
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
        const ui=[tooltip,pickerBadge,globalThis.__fontSwapPanelRoot?.host];
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
  function matchesRule(record,rule) { return !record.protected && (rule.scope==='element' ? record.element===rule.element : U.matches(record.stack,rule.source)); }
  function ruleFor(record) { return record && rules.findLast(rule=>matchesRule(record,rule)); }
  function selectedRule() { return rules.findLast(rule=>U.normalize(rule.source)===U.normalize(source) && (rule.scope!=='element' || rule.element===selectedElement)); }
  function sync() { active=rules.length>0; applied=active; destination=selectedRule()?.destination || null; }
  function currentState() {
    const fonts = new Map(); for (const r of records.filter(r=>!r.protected)) fonts.set(r.family,(fonts.get(r.family)||0)+1);
    return {url:location.href,selection,source,destination,scope,count:targets().length,pageFonts:[...fonts].map(([family,count])=>({family,count})).sort((a,b)=>b.count-a.count),active,compared,applied,picking,status,error:failureMessage,warnings:[...new Set(warnings)],rules:rules.map(rule=>({id:rule.id,source:rule.source,destination:rule.destination,count:records.filter(r=>matchesRule(r,rule)).length}))};
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
      for (const item of owned) {
        if (item.inline && item.element.style.getPropertyValue('font-family')===item.value && item.element.style.getPropertyPriority('font-family')==='important') {
          if (item.before) item.element.style.setProperty('font-family',item.before,item.priority);
          else item.element.style.removeProperty('font-family');
        }
        if (item.element.getAttribute(marker)===item.token) item.element.removeAttribute(marker);
      }
      owned = [];
    } finally { for (const observer of observers.values()) observer.takeRecords(); mutating = false; if(dirty) { dirty=false; schedule(); } }
  }
  async function paint() {
    if (!active || compared) return;
    const chosen = records.filter(record=>ruleFor(record));
    // Keep inherited icon glyphs on their original stack when an ancestor swaps.
    const changed=new Set(chosen.map(r=>r.element));
    const guards=records.filter(r=>{
      if(!r.protected) return false;
      let ancestor=r.element.parentElement || r.element.getRootNode().host;
      while(ancestor) { if(changed.has(ancestor)) return true; ancestor=ancestor.parentElement || ancestor.getRootNode().host; }
      return false;
    });
    const groups = new Map(); const cssRules = [];
    mutating = true;
    try {
      for (const record of [...chosen,...guards]) {
        const rule=ruleFor(record);
        const tail = rule && U.fallback(record.stack,rule.source);
        const value = record.protected ? record.stack : `${rule.alias ? U.quote(rule.alias) : U.familyCSS(rule.destination.family)}${tail ? ', '+tail : ''}`;
        let token = groups.get(value);
        if (!token && record.root===document) { token = `g${groups.size}`; groups.set(value,token); cssRules.push(`[${marker}="${token}"] { font-family: ${value} !important; }`); }
        const item = {element:record.element,token,inline:record.root!==document,value};
        if (!item.inline) record.element.setAttribute(marker,token);
        if (item.inline) {
          item.before = record.element.style.getPropertyValue('font-family'); item.priority = record.element.style.getPropertyPriority('font-family');
          record.element.style.setProperty('font-family',value,'important');
          item.value = record.element.style.getPropertyValue('font-family');
        }
        owned.push(item);
      }
      for (const observer of observers.values()) observer.takeRecords();
      const next = cssRules.join('\n'); await stylesheet('',next); cssRule=next;
    } catch (error) { await clean(); throw error; }
    finally { for (const observer of observers.values()) observer.takeRecords(); mutating=false; if(dirty) { dirty=false; schedule(); } }
    if (scope==='element' && !selectedElement?.isConnected) status='Selected text was removed. Pick it again.';
    else if (!chosen.length) status='No matching text on this page';
  }
  async function refresh() {
    await clean(); scan(); await paint();
  }
  function schedule() {
    if(timer) return;
    timer=setTimeout(()=>{timer=null;serialize(async()=>{ await refresh(); announce('changed'); }).catch(()=>{});},150);
  }
  function showPickerBadge() {
    // Source picking spans frames. Show its instruction once on the main page.
    if (window!==window.top && picking!=='destination') return;
    if (!pickerBadge) {
      pickerBadge=document.createElement('div'); pickerBadge.setAttribute('data-font-swap-picker',''); pickerBadge.setAttribute('role','status');
      const styles={all:'initial',position:'fixed',left:'50%',bottom:'20px',transform:'translateX(-50%)','z-index':'2147483646',display:'flex','align-items':'center',gap:'8px','pointer-events':'none',background:'#202124',color:'#fff',font:'14px/1.4 system-ui, sans-serif',padding:'10px 14px','border-radius':'999px',border:'1px solid #ffffff30','box-shadow':'0 2px 12px #0003','max-width':'calc(100vw - 24px)','white-space':'nowrap'};
      for (const [key,value] of Object.entries(styles)) pickerBadge.style.setProperty(key,value,'important');
      const root=pickerBadge.attachShadow({mode:'closed'});
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
      for (const [key,value] of Object.entries({width:'16',height:'16',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) icon.setAttribute(key,value);
      icon.style.flexShrink='0';
      for (const d of ['m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12','m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z','m2 22 .414-.414']) {
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);icon.append(path);
      }
      badgeLabel=document.createElement('span');
      const escape=document.createElement('span');escape.textContent='Esc to cancel';escape.style.cssText='font-size:12px;color:#b8bdc7';
      root.append(icon,badgeLabel,escape);
    }
    badgeLabel.textContent=picking==='destination'?'Pick replacement font':'Pick a font';
    document.documentElement.append(pickerBadge);
  }
  function stopPicking() {
    picking=null; unhighlight(); pickerBadge?.remove();
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
      const styles={all:'initial',position:'fixed','z-index':'2147483647','pointer-events':'none',background:'#202124',color:'#fff',font:'14px/1.3 system-ui, sans-serif',padding:'7px 10px','border-radius':'6px','box-shadow':'0 2px 8px #0004','max-width':'calc(100vw - 16px)','white-space':'nowrap',overflow:'hidden','text-overflow':'ellipsis'};
      for (const [key,value] of Object.entries(styles)) tooltip.style.setProperty(key,value,'important');
      document.documentElement.append(tooltip);
    }
    const record=records.find(r=>r.element===element);
    tooltip.textContent=(!compared && ruleFor(record)?.destination.family) || record?.family || U.parseStack(getComputedStyle(element).fontFamily)[0];
    const bounds=tooltip.getBoundingClientRect();
    tooltip.style.setProperty('left',`${Math.max(8,Math.min(event.clientX+14,innerWidth-bounds.width-8))}px`,'important');
    tooltip.style.setProperty('top',`${Math.max(8,Math.min(event.clientY+18,innerHeight-bounds.height-8))}px`,'important');
  }
  function locate(event) {
    if (panelEvent(event)) return null;
    let element = event.composedPath().find(n=>n instanceof Element) || event.target;
    // Closed shadow roots hide their child nodes from composedPath.
    let shadow;
    while ((shadow=shadowOf(element))) { const inside=shadow.elementFromPoint(event.clientX,event.clientY); if (!inside || inside===element) break; element=inside; }
    while (element && element!==document.documentElement) {
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
  const panelEvent = event => event.composedPath().some(node=>node instanceof Element && node.hasAttribute('data-font-swap-panel'));
  window.addEventListener('pointerdown',event=>{if(picking && !panelEvent(event)) {event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('click',event=>{
    if (!picking) return;
    const element=locate(event); if (!element) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const mode=picking, visibleRule=!compared && ruleFor(records.find(r=>r.element===element)); stopPicking();
    serialize(async()=>{
      await clean(); scan();
      const record=records.find(r=>r.element===element);
      if (!record) { await paint(); status='Pick visible text instead of an image or icon.'; announce('changed'); return; }
      if (mode==='source') {
        compared=false; source=record.family; selectedElement=element; scope='all'; sync();
        const estimate=U.estimate(element,record.stack);
        selection={family:record.family,stack:record.stack,text:record.text.slice(0,160),tag:element.tagName.toLowerCase(),weight:record.weight,style:record.style,size:record.size,confidence:estimate && U.normalize(estimate)===U.normalize(record.family) ? 'estimated' : 'css'};
        warnings=[];
        status='Choose a font'; revision++; await paint(); announce('picked');
      } else {
        await paint(); status='Loading font'; announce('changed');
        announce('destination-picked',{destination:visibleRule?.destination || {kind:'page',family:record.family}});
      }
    }).catch(error=>{failureMessage=status=error.message; announce('changed');});
  },true);
  document.addEventListener('keydown',event=>{ if (event.key==='Escape' && picking) { stopPicking(); status='Picker cancelled'; announce('cancelled'); } },true);
  async function preview(message) {
    if (message.revision!==revision) throw new Error('The origin changed while loading. Choose the destination again.');
    let loaded=[], nextAlias='';
    if (message.destination.kind==='google') {
      nextAlias=`FontSwap_${crypto.randomUUID().replaceAll('-','')}`;
      try {
        for (const face of message.font.faces) {
          const binary=Uint8Array.from(atob(message.font.binaries[face.id]),c=>c.charCodeAt(0));
          const font=new FontFace(nextAlias,binary,face.descriptors); await font.load(); loaded.push(font);
        }
      } catch { throw new Error('Chrome could not load this font. The previous preview is unchanged.'); }
    } else if (!records.some(r=>U.normalize(r.family)===U.normalize(message.destination.family))) throw new Error('That font is no longer used on this page. Pick it again.');
    if (message.revision!==revision) throw new Error('The origin changed. Choose the destination again.');
    await clean();
    const nextScope=message.scope==='element'?'element':'all';
    const previous=rules.find(rule=>U.normalize(rule.source)===U.normalize(source) && rule.scope===nextScope && (nextScope==='all' || rule.element===selectedElement));
    const next={id:previous?.id || crypto.randomUUID(),source,destination:message.destination,scope:nextScope,element:selectedElement,alias:nextAlias,fontFaces:loaded};
    rules=rules.filter(rule=>rule!==previous); rules.push(next);
    for (const face of previous?.fontFaces || []) document.fonts.delete(face);
    for (const face of loaded) document.fonts.add(face);
    destination=message.destination; scope=nextScope;
    warnings=warnings.filter(w=>!w.includes('closest available face'));
    warnings.push(...(message.font?.warnings || []));
    sync(); compared=false; status='Applied'; scan(); await paint();
  }
  async function command(message) {
    if (message.action==='ping') return {};
    if (message.action==='state') { if (!active) scan(); return currentState(); }
    if (message.action==='failure') { failureMessage=status=message.error; return currentState(); }
    failureMessage='';
    if (message.action==='pick') { if (!['source','destination'].includes(message.mode)) throw new Error('Choose what to pick.'); picking=message.mode; unhighlight(); showPickerBadge(); status=message.mode==='source'?'Click text to replace its font':'Click text to use its font'; return currentState(); }
    if (message.action==='cancel') { stopPicking(); status='Picker cancelled'; return currentState(); }
    if (message.action==='source') {
      if (typeof message.family!=='string' || !message.family.trim() || message.family.length>200) throw new Error('Choose an origin font.');
      await clean(); compared=false; source=message.family.trim(); sync();
      if (selection && U.normalize(selection.family)!==U.normalize(source)) { selection=null; selectedElement=null; scope='all'; }
      revision++; scan(); await paint(); status=targets().length?'Choose a font':'No matching text on this page';
    } else if (message.action==='prepare') {
      await refresh(); revision++; const chosen=targets(message.scope==='element'?'element':'all');
      return {revision,styles:[...new Map(chosen.map(r=>[`${r.weight}:${r.style}`,{weight:r.weight,style:r.style}])).values()]};
    } else if (message.action==='preview') await preview(message);
    else if (message.action==='select') {
      const rule=rules.find(rule=>rule.id===message.ruleId); if(!rule) throw new Error('This swap is no longer on the page.');
      source=rule.source; scope=rule.scope; selectedElement=rule.element; destination=rule.destination; stopPicking(); revision++; status='Choose a font';
    } else if (message.action==='remove') {
      const rule=rules.find(rule=>rule.id===message.ruleId); if(!rule) throw new Error('This swap is no longer on the page.');
      await clean(); rules=rules.filter(item=>item!==rule); for(const face of rule.fontFaces) document.fonts.delete(face); sync(); revision++; scan(); await paint(); status=active?'Applied':'Original fonts restored';
    }
    else if (message.action==='apply') { if (!active) throw new Error('Choose a destination first.'); if (compared) { compared=false; await refresh(); } applied=true; status='Applied'; }
    else if (message.action==='undo') {
      await clean(); compared=false; revision++;
      for (const rule of rules) for (const face of rule.fontFaces) document.fonts.delete(face); rules=[]; sync(); stopPicking(); scan(); status='Original fonts restored';
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
