# Side panel contract

Plain HTML/CSS/JavaScript extension page. No inline scripts, external JavaScript, or framework. UI-only files: extension/sidepanel.html, sidepanel.css, sidepanel.js.

Use chrome.runtime.sendMessage with { type: 'PANEL', action, tabId, ...payload }. Response is { ok: true, state?, catalog?, preview? } or { ok: false, error: 'human readable' }. Commands always return state where appropriate.

- action 'connect': get active tab via chrome.tabs.query({active:true,currentWindow:true}); inject picker/controller and return state.
- 'state': refresh current state.
- 'catalog': return catalog array of {family, category, variants}. Catalog is bundled offline and complete Google Fonts snapshot.
- 'pick', mode:'source' or 'destination': arm picker in accessible frames.
- 'source', family:string: select a page family, or choose a catalog font as origin, showing zero matches if absent.
- 'preview', destination:{kind:'google'|'page',family:string}, scope:'all'|'element': load and preview destination. Debounce search; preview only when selecting a result, not every keystroke. Returns state.
- 'apply': keep preview, status Applied.
- 'undo': remove preview rules and restore original page appearance. Returns state.
- 'compare', enabled:boolean: toggle original view while retaining preview.
- 'cancel': exit picker.

State shape:
{ tabId, url, selection: null | {family, stack, text, tag, weight, style, size, confidence:'css'|'estimated'}, pageFonts:[{family,count}], source:string, destination:null|{kind,family}, scope:'all'|'element', count:number, active:boolean, compared:boolean, applied:boolean, picking:null|'source'|'destination', status:string, warnings:string[], frameId:number }

Worker broadcasts {type:'STATE_CHANGED',tabId,state} to extension views after page picks, dynamic updates and operations. Ignore updates for other tabs. On tabs.onActivated reconnect to the active tab and reset panel state. On tabs.onUpdated status complete reconnect if same tab. State getter can be used to refresh after document navigation.

Show origin prefilled from click. Both origin and destination have search and Pick from page. Origin suggestions prioritize pageFonts, then full Google Fonts catalog. Destination suggestions filter full catalog by name and can optionally include page fonts. Minimum viable preview samples use lazy loaded FontFace via a separate command 'sample', family:string which returns {ok:true,preview:{family,faces:[{bytes:number[], descriptors:{weight,style,unicodeRange}}]}}. Construct FontFace from binary in panel and add to document.fonts. Load samples only for first few visible results, not the full catalog. Sample loading errors must not block choosing a font, and page preview errors must be shown beside controls.

Keep controls compact and accessible with native elements and focus styles. Native panel may be 320px wide. Use 'Replace' and 'With', selected text snippet, scope, target count, preview/Apply, Compare original, Undo. Initial empty state 'Pick text on the page' with single primary Pick text action. Loading/errors, no search matches, source absent, offline destination loading and unsupported pages need clear text. Keep existing selections on operation failure. No all-caps eyebrow, gradients, em dashes, or marketing sections. One restrained blue accent, opaque panels, device theme default. Copy should describe product outcomes only.

UI should never optimistically show success before worker confirms. Disable duplicate pending actions and ignore stale sample promises. Unknown tab/restricted URL produces error and useful recovery text. All dynamic text via textContent, not innerHTML.
