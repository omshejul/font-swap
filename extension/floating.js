// Mount the shared controls in the page without an iframe or remote resources.
(async () => {
  if (globalThis.__fontSwapPanelRoot) {
    const host=globalThis.__fontSwapPanelRoot.host;
    if (!host.isConnected) document.documentElement.append(host);
    host.style.setProperty('display','block','important');
    return;
  }
  const ui=await chrome.runtime.sendMessage({type:'PANEL',action:'ui'});
  if (!ui?.ok) throw new Error(ui?.error || 'Could not open SwapFont.');
  const host=document.createElement('swapfont-panel');
  host.setAttribute('data-font-swap-panel','');
  host.setAttribute('role','region');
  host.setAttribute('aria-label','SwapFont floating panel');
  const styles={all:'initial',display:'block',position:'fixed',top:'16px',right:'16px',width:'min(320px, calc(100vw - 32px))','max-height':'calc(100dvh - 32px)',overflow:'auto','z-index':'2147483645',background:'var(--bg)',color:'var(--text)',font:'14px/1.4 system-ui, sans-serif',border:'1px solid var(--border)','border-radius':'8px','box-shadow':'0 8px 32px #0003','box-sizing':'border-box',direction:'ltr','text-align':'left',opacity:'1',transform:'none','color-scheme':'light dark'};
  for (const [key,value] of Object.entries(styles)) host.style.setProperty(key,value,'important');
  const root=host.attachShadow({mode:'closed'});
  const sheet=new CSSStyleSheet();
  sheet.replaceSync(ui.css.replaceAll(':root',':host').replace(/html,\s*body/g,':host').replace(/\bbody\s*\{/g,':host {')+`
    .panel-header { cursor: grab; touch-action: none; }
    .panel-header h1 { margin-right: auto; }
    .floating-control { display: grid; place-items: center; flex: none; width: 24px; height: 28px; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--muted); cursor: pointer; }
    .floating-control:hover { background: var(--surface); color: var(--text); }
    #move-panel { cursor: grab; }
    .panel-header:active, #move-panel:active { cursor: grabbing; }
    .brand-icon { flex: none; width: 24px; height: 24px; border-radius: 5px; }
  `);
  root.adoptedStyleSheets=[sheet];
  const parser=new DOMParser();
  root.append(document.importNode(parser.parseFromString(ui.html,'text/html').querySelector('main'),true));
  const icon=document.importNode(parser.parseFromString(ui.icon,'image/svg+xml').documentElement,true);
  icon.setAttribute('class','brand-icon'); icon.setAttribute('aria-hidden','true');
  root.querySelector('h1 img').replaceWith(icon);
  const header=root.querySelector('.panel-header');
  function control(id,label,paths) {
    const button=document.createElement('button');
    button.id=id; button.type='button'; button.className='floating-control';
    button.setAttribute('aria-label',label); button.title=label;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for (const [key,value] of Object.entries({width:'16',height:'16',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','aria-hidden':'true'})) svg.setAttribute(key,value);
    for (const d of paths) { const path=document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',d); svg.append(path); }
    button.append(svg); return button;
  }
  const grip=control('move-panel','Move panel. Use arrow keys.',['M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01']);
  const close=control('close-panel','Close SwapFont',['m6 6 12 12M18 6 6 18']);
  header.prepend(grip); header.append(close);
  const previousFocus=document.activeElement;
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if (sender.id===chrome.runtime.id && message.type==='HIDE_FLOATING') host.style.setProperty('display','none','important');
  });
  close.addEventListener('click',()=>{
    host.style.setProperty('display','none','important');
    chrome.runtime.sendMessage({type:'PANEL',action:'cancel'}).catch(()=>{});
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
  });
  function move(x,y) {
    const bounds=host.getBoundingClientRect();
    host.style.setProperty('left',`${Math.max(8,Math.min(x,innerWidth-bounds.width-8))}px`,'important');
    host.style.setProperty('top',`${Math.max(8,Math.min(y,innerHeight-bounds.height-8))}px`,'important');
    host.style.setProperty('right','auto','important');
  }
  let drag=null;
  header.addEventListener('pointerdown',event=>{
    if (event.button!==0 || (event.target.closest('button') && event.target.closest('button')!==grip)) return;
    const bounds=host.getBoundingClientRect();
    drag={x:event.clientX-bounds.left,y:event.clientY-bounds.top};
    grip.focus({preventScroll:true});
    header.setPointerCapture(event.pointerId); event.preventDefault();
  });
  header.addEventListener('pointermove',event=>{if(drag)move(event.clientX-drag.x,event.clientY-drag.y);});
  for (const event of ['pointerup','pointercancel','lostpointercapture']) header.addEventListener(event,()=>{drag=null;});
  grip.addEventListener('keydown',event=>{
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if (!delta) return;
    event.preventDefault();
    const bounds=host.getBoundingClientRect(),step=event.shiftKey?50:10;
    move(bounds.left+delta[0]*step,bounds.top+delta[1]*step);
  });
  const clamp=()=>{if(host.getBoundingClientRect().width){const bounds=host.getBoundingClientRect();move(bounds.left,bounds.top);}};
  addEventListener('resize',clamp); new ResizeObserver(clamp).observe(host);
  for (const event of ['click','pointerdown','pointerup','keydown','keyup']) root.addEventListener(event,e=>e.stopPropagation());
  root.__fontSwapTabId=ui.tabId;
  globalThis.__fontSwapPanelRoot=root;
  document.documentElement.append(host);
})();
