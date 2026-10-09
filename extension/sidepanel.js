// Shared controls for the side panel and floating panel.
(() => {
const root = globalThis.__fontSwapPanelRoot || document;
if (root.__fontSwapMounted) return;
root.__fontSwapMounted = true;
const floating = root !== document;

const MAX_RESULTS = 30;
const RECONNECT_DELAY_MS = 150;
const FALLBACK_ERROR = 'That did not work. Try again.';

const $ = (id) => root.getElementById(id);

const els = {
  undo: $('undo'),
  remember: $('remember-site'),
  rememberRow: $('remember-row'),
  rememberPermission: $('remember-permission'),
  rememberRetry: $('remember-retry'),
  mode: $('mode-toggle'),
  feedback: $('feedback'),
  connectError: $('connect-error'),
  retry: $('retry'),
  messagesHome: $('messages-home'),
  pairs: $('pairs'),
  stepsHome: $('steps-home'),
  steps: $('steps'),
  search: $('search'),
  results: $('results'),
  pickDest: $('pick-dest'),
  another: $('another'),
  note: $('note'),
  error: $('error'),
  tagFilter: $('tag-filter'),
  tagSearch: $('tag-search'),
  tagOptions: $('tag-options'),
  allTags: $('all-tags'),
  tagError: $('tag-error'),
};

els.mode.title = floating ? 'Dock to side panel' : 'Float on page';
els.mode.setAttribute('aria-label', els.mode.title);
els.mode.querySelector('.mode-float').toggleAttribute('hidden', floating);
els.mode.querySelector('.mode-dock').toggleAttribute('hidden', !floating);

const views = { loading: $('view-loading'), error: $('view-error'), main: $('view-main') };

let tabId = floating ? root.__fontSwapTabId : null;
let tabEpoch = 0;
let state = null;
let busy = false;
let pending = '';
let errorText = '';
let rememberDeniedOrigin = '';
let noteText = '';
let dismissedKey = '';
let doneKey = ''; // source whose swap is finished, so the steps can collapse
let reconnectTimer = 0;
let catalog = null;
let catalogLoading = null;
let matches = [];
let activeIndex = -1;
let switchingMode = false;
let pairsSignature = '';
let resultsSignature = '';
let filterRule = null;
let filterSession = 0;
let tagChoices = [];
let tagChoicesSignature = '';
let tagQueue = Promise.resolve();
const tagEdits = new Map();
const ruleKey = rule => `${rule.frameId}:${rule.id}`;
const tagNames = {h1:'Heading 1',h2:'Heading 2',h3:'Heading 3',h4:'Heading 4',h5:'Heading 5',h6:'Heading 6',p:'Paragraph',a:'Link',button:'Button',span:'Inline text',li:'List item',label:'Label',blockquote:'Quote',code:'Code',pre:'Preformatted',div:'Container',td:'Table cell',th:'Table heading',summary:'Summary',figcaption:'Caption',input:'Input',textarea:'Text area'};

function filterIcon(size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  for (const [name,value] of Object.entries({width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.75','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(name,value);
  const path = document.createElementNS(svg.namespaceURI,'path');
  path.setAttribute('d','M4 4h16l-6 7v7l-4 2v-9L4 4Z'); svg.append(path);
  return svg;
}

function updateFeedback() {
  const manifest = chrome.runtime.getManifest();
  const rules = state?.rules || [];
  const details = [
    `Extension: ${manifest.name}`,
    `Version: ${manifest.version}`,
    `Extension ID: ${chrome.runtime.id}`,
    `Layout: ${floating ? 'Floating panel' : 'Side panel'}`,
    `Browser: ${navigator.userAgent}`,
    `Platform: ${navigator.platform}`,
    `Language: ${navigator.language}`,
    `Website: ${state?.siteOrigin || 'Not available'}`,
    `Remember for this site: ${state?.remembered ? 'On' : 'Off'}`,
    `Active swaps: ${rules.length}`,
    ...rules.slice(0, 5).map(rule => `${rule.source} -> ${rule.destination.family}`),
    `Status: ${state?.status || 'Connecting'}`,
    `Date: ${new Date().toISOString()}`,
  ];
  if (errorText || state?.error) details.push(`Error: ${describeError(errorText || state.error)}`);
  const body = ['What happened, or what would you like to see?', '', '', 'Steps to reproduce (if it is a bug):', '', '', '--- Diagnostics: edit or remove anything ---', ...details].join('\r\n');
  els.feedback.href = `mailto:chromewebstore@omshejul.com?subject=${encodeURIComponent(`${manifest.name} feedback (v${manifest.version})`)}&body=${encodeURIComponent(body)}`;
}
els.feedback.addEventListener('click', updateFeedback);
updateFeedback();

// Messaging

async function send(action, payload = {}) {
  const epoch = tabEpoch;
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'PANEL', action, tabId, ...payload });
  } catch (error) {
    response = { ok: false, error: error && error.message };
  }
  if (epoch !== tabEpoch) return { ok: false, stale: true };
  if (!response || typeof response !== 'object') return { ok: false };
  return response;
}

function describeError(raw) {
  const text = String(raw || '').replace(/^(Uncaught\s+)?(\w*Error:\s*)+/i, '').trim();
  if (!text) return FALLBACK_ERROR;
  if (/receiving end does not exist|could not establish connection|message port closed|no tab with id/i.test(text)) {
    return 'Could not reach this page. Reload it, then retry.';
  }
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

function showView(name) {
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
  if (name !== 'main') els.undo.hidden = true;
}

// Connection

async function connect() {
  clearTimeout(reconnectTimer);
  if (busy) { scheduleConnect(); return; }
  const epoch = ++tabEpoch;
  closeTagFilter();
  tagEdits.clear();
  state = null;
  busy = false;
  pending = errorText = rememberDeniedOrigin = noteText = doneKey = dismissedKey = '';
  showView('loading');
  let tab;
  try {
    if (floating) tab = { id: tabId };
    else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = null;
  }
  if (epoch !== tabEpoch) return;
  // The panel itself can be the active tab when opened as a page. Keep the last real tab.
  if (tab && tab.url && tab.url.startsWith(chrome.runtime.getURL(''))) tab = tabId === null ? null : { id: tabId };
  tabId = tab ? tab.id : null;
  const priorState = state;
  const response = tabId === null ? { ok: false, error: 'Open a website first.' } : await send('connect');
  if (response.stale || epoch !== tabEpoch || state !== priorState) return;
  if (!response.ok || !response.state) {
    els.connectError.textContent = describeError(response.error);
    showView('error');
    return;
  }
  doneKey = response.state.destination ? sourceKey(response.state) : '';
  setState(response.state);
}

function scheduleConnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
}

// State

const sourceKey = (s) => (s && s.source ? `${s.frameId}:${s.selectedRuleId || s.source}` : '');
const pairKey = rule => rule.id === 'draft' ? `${rule.frameId}:${rule.source}` : ruleKey(rule);
const destinationName = (destination) => (destination && destination.family) || '';

function setState(next) {
  const previous = state;
  state = next;
  if (next.siteOrigin !== rememberDeniedOrigin || next.remembered || !next.rules?.length) rememberDeniedOrigin = '';
  updateFeedback();
  if (previous && previous.picking && !next.picking) {
    const changed = sourceKey(previous) !== sourceKey(next) || destinationName(previous.destination) !== destinationName(next.destination);
    if (previous.picking === 'source' && next.status === 'Choose a font') doneKey = dismissedKey = '';
    else if (changed && next.destination) doneKey = sourceKey(next);
    // A pick that ended without a result explains itself through the page status.
    noteText = changed || ['Picker cancelled','Choose a font','Loading font'].includes(next.status) ? '' : next.status || '';
  }
  if (next.status === 'Applied' && next.destination && (previous?.picking === 'destination' || previous?.status === 'Loading font')) {
    doneKey = sourceKey(next);
    noteText = '';
  }
  if (sourceKey(previous) !== sourceKey(next)) {
    els.search.value = '';
    if (previous && next.source && !next.destination) queueMicrotask(() => els.search.focus());
  }
  showView('main');
  render();
}

function render() {
  const rules = Array.isArray(state.rules) ? state.rules : [];
  const editing = Boolean(state.source) && sourceKey(state) !== doneKey && sourceKey(state) !== dismissedKey && state.picking !== 'source';
  const loadingFont = Boolean(pending) || (state.status === 'Loading font' && !state.error && !errorText);
  const loadingFamily = pending || (typeof state.loadingFamily === 'string' ? state.loadingFamily.trim() : '');
  const blocked = busy || loadingFont;
  const canSearch = Boolean(state.source) && !state.picking && !blocked;
  const waitingForSource = state.picking === 'source' || (!rules.length && (!state.source || sourceKey(state) === dismissedKey));

  views.main.inert = blocked;
  views.main.setAttribute('aria-busy', String(blocked));
  els.undo.hidden = !rules.length;
  els.undo.disabled = blocked;
  els.rememberRow.hidden = !rules.length && !state.remembered;
  els.rememberRow.title = state.siteOrigin || '';
  if (!busy) els.remember.checked = Boolean(state.remembered);
  els.remember.disabled = blocked;
  els.rememberPermission.hidden = !rememberDeniedOrigin || els.rememberRow.hidden;
  els.rememberRetry.disabled = blocked;
  if (els.rememberPermission.hidden) els.remember.removeAttribute('aria-describedby');
  else els.remember.setAttribute('aria-describedby', 'remember-description');
  els.mode.disabled = blocked;
  views.main.dataset.picking = state.picking || '';
  const inline = renderPairs(rules, editing, waitingForSource);
  if (filterRule) {
    if (blocked || !rules.some(rule => ruleKey(rule) === ruleKey(filterRule))) closeTagFilter();
    else { renderTagOptions(); positionTagFilter(); }
  }

  // The loading row replaces the editor until the font applies or fails.
  els.steps.hidden = !editing || loadingFont;
  els.stepsHome.hidden = !editing || inline || loadingFont;
  els.another.hidden = waitingForSource;
  els.search.disabled = !state.source || blocked;
  els.pickDest.hidden = !canSearch;
  renderResults(canSearch);

  els.note.classList.toggle('is-loading', loadingFont);
  els.note.textContent = loadingFont ? `Loading ${loadingFamily || 'font'}` : noteText;
  const pageError = typeof state.error === 'string' ? state.error.trim() : '';
  const shown = [...new Set([errorText, pageError && describeError(pageError)].filter(Boolean))].join(' ');
  els.error.textContent = shown;
  els.error.hidden = !shown;
}

function renderPairs(rules, editing, waitingForSource) {
  const hasDraft = !waitingForSource && state.source && !rules.some(rule => ruleKey(rule) === sourceKey(state)) && sourceKey(state) !== dismissedKey;
  const rows = waitingForSource ? [...rules, {id:'picking',frameId:state.frameId,source:'Pick from page',destination:null}] : hasDraft ? [...rules, {id:'draft', frameId:state.frameId, source:state.source, destination:null,tags:state.tags}] : rules;
  els.pairs.hidden = !rows.length;
  const openKey = editing ? sourceKey(state) : '';
  const inline = rows.some((rule) => pairKey(rule) === openKey);
  const signature = JSON.stringify([openKey, state.picking, rows.map((rule) => [rule.id, rule.frameId, rule.source, destinationName(rule.destination), rule.tags])]);
  if (signature === pairsSignature) return inline;
  pairsSignature = signature;
  // Keep the single editor alive while rebuilding its accordion rows.
  els.stepsHome.append(els.steps);
  els.messagesHome.append(els.note,els.error);
  els.pairs.replaceChildren(...rows.map((rule) => {
    const from = rule.source;
    const waiting = rule.id === 'picking';
    const draft = waiting || rule.id === 'draft';
    const to = destinationName(rule.destination) || 'Choose font';
    const item = document.createElement('li');
    item.className = waiting ? `pair pair-pending pair-source${state.picking === 'source' ? ' pair-awaiting' : ''}` : draft ? 'pair pair-pending' : 'pair';
    const header = Object.assign(document.createElement('div'), { className: 'pair-header' });
    const body = Object.assign(document.createElement('div'), { className: 'pair-body', id: `pair-${rule.frameId}-${rule.id}` });
    const open = waiting || pairKey(rule) === openKey;
    body.hidden = !open;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'pair-edit';
    edit.dataset.action = waiting ? state.picking ? 'cancel-pick' : 'pick-source' : draft ? 'draft-select' : 'select';
    edit.id = `edit-${rule.frameId}-${rule.id}`;
    edit.setAttribute('aria-label', waiting ? 'Pick a font from the page' : `Change ${from} to ${to}`);
    edit.setAttribute('aria-expanded', String(open));
    edit.setAttribute('aria-controls', body.id);
    const arrow = Object.assign(document.createElement('span'), { className: 'pair-arrow', textContent: '→' });
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'pair-chevron');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('aria-hidden', 'true');
    const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    chevronPath.setAttribute('d', 'm6 9 6 6 6-6');
    chevron.append(chevronPath);
    const fromLabel=Object.assign(document.createElement('span'), {className:'pair-from',textContent:from});
    if (waiting) fromLabel.prepend(els.pickDest.querySelector('svg').cloneNode(true));
    const replacement=Object.assign(document.createElement('span'), {className:'pair-destination'});
    replacement.append(arrow,Object.assign(document.createElement('span'), {className:'pair-to',textContent:to}));
    edit.append(fromLabel,replacement,chevron);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pair-remove';
    remove.dataset.action = waiting ? 'cancel-pick' : draft ? 'draft-remove' : 'remove';
    remove.textContent = '×';
    remove.hidden = waiting && !state.picking;
    remove.setAttribute('aria-label', `Remove ${from} to ${to}`);
    for (const button of [edit, remove]) {
      button.dataset.ruleId = rule.id;
      button.dataset.frameId = rule.frameId;
    }
    header.append(edit);
    if (!draft) {
      const filter = Object.assign(document.createElement('button'), {type:'button',className:'icon-button pair-filter',id:`filter-${rule.frameId}-${rule.id}`,title:'Apply to tags'});
      filter.dataset.action = 'filter'; filter.dataset.ruleId = rule.id; filter.dataset.frameId = rule.frameId;
      filter.setAttribute('aria-label',`Apply ${to} to specific tags`);
      filter.setAttribute('aria-haspopup','dialog'); filter.setAttribute('aria-controls','tag-filter');
      filter.setAttribute('aria-expanded',String(Boolean(filterRule && ruleKey(filterRule) === ruleKey(rule))));
      filter.setAttribute('aria-pressed',String(Array.isArray(rule.tags)));
      filter.append(filterIcon()); header.append(filter);
    }
    header.append(remove);
    if (open) {
      if (!waiting) body.append(els.steps);
      body.append(els.note,els.error);
    }
    item.append(header);
    if (Array.isArray(rule.tags)) {
      const summary = Object.assign(document.createElement('div'), {className:'tag-summary'});
      summary.append(filterIcon(12),document.createTextNode(rule.tags.join(', ') || 'No tags selected'));
      item.append(summary);
    }
    item.append(body);
    return item;
  }));
  return inline;
}

// Tag choices reuse the page controller's existing scan, never page text or selectors.
function closeTagFilter(focus = false) {
  const button = filterRule && $(`filter-${filterRule.frameId}-${filterRule.id}`);
  if (els.tagFilter.matches(':popover-open')) els.tagFilter.hidePopover();
  filterRule = null; filterSession++;
  button?.setAttribute('aria-expanded','false');
  if (focus) button?.focus({preventScroll:true});
}

function positionTagFilter() {
  if (!filterRule || !els.tagFilter.matches(':popover-open')) return;
  const button = $(`filter-${filterRule.frameId}-${filterRule.id}`);
  if (!button) return;
  const anchor = button.getBoundingClientRect(), panel = root.querySelector('.panel').getBoundingClientRect();
  const width = Math.min(254,panel.width - 16,innerWidth - 16);
  els.tagFilter.style.width = `${width}px`;
  const left = Math.max(8,Math.min(anchor.right - width,innerWidth - width - 8));
  els.tagFilter.style.left = `${left}px`;
  const height = els.tagFilter.getBoundingClientRect().height;
  const top = Math.max(8,Math.min(anchor.bottom + 6,innerHeight - height - 8));
  els.tagFilter.style.top = `${top}px`;
  els.tagFilter.dataset.below = String(top >= anchor.bottom + 4);
  els.tagFilter.style.setProperty('--tag-arrow-left',`${Math.max(12,Math.min(anchor.left + anchor.width / 2 - left - 4,width - 20))}px`);
}

function currentFilterTags() {
  const edit = tagEdits.get(ruleKey(filterRule));
  return edit ? edit.tags : state.rules.find(rule => ruleKey(rule) === ruleKey(filterRule))?.tags ?? null;
}

function allTagsSelected() {
  const tags = currentFilterTags();
  return tags == null || (tagChoices.length > 0 && tagChoices.every(choice => tags.includes(choice.tag)));
}

function renderTagOptions() {
  if (!filterRule) return;
  const tags = currentFilterTags(), query = els.tagSearch.value.trim().toLowerCase();
  const choices = [...tagChoices];
  for (const tag of tags || []) if (!choices.some(choice => choice.tag === tag)) choices.push({tag,count:0});
  choices.sort((a,b) => {
    const order = ['h1','h2','h3','h4','h5','h6','p','a','button','span','li'];
    return (order.indexOf(a.tag) < 0 ? 99 : order.indexOf(a.tag)) - (order.indexOf(b.tag) < 0 ? 99 : order.indexOf(b.tag)) || a.tag.localeCompare(b.tag);
  });
  const visible = choices.filter(({tag}) => `${tag} ${tagNames[tag] || tag}`.toLowerCase().includes(query));
  const signature = JSON.stringify(visible);
  // Keep focused checkbox nodes alive across confirmed state updates.
  if (signature !== tagChoicesSignature) {
    tagChoicesSignature = signature;
    els.tagOptions.replaceChildren(...visible.map(({tag,count}) => {
      const row = Object.assign(document.createElement('label'), {className:'tag-option'});
      const input = Object.assign(document.createElement('input'), {type:'checkbox'}); input.dataset.tag = tag;
      input.setAttribute('aria-label',`${tag}: ${tagNames[tag] || tag}`);
      row.append(input,Object.assign(document.createElement('code'), {textContent:tag}),Object.assign(document.createElement('span'), {className:'tag-name',textContent:tagNames[tag] || tag}),Object.assign(document.createElement('span'), {className:'tag-count',textContent:count}));
      return row;
    }));
    if (!visible.length) els.tagOptions.append(Object.assign(document.createElement('p'), {className:'tag-empty',textContent:'No tags found'}));
  }
  for (const input of els.tagOptions.querySelectorAll('input')) input.checked = tags == null || tags.includes(input.dataset.tag);
  const all = allTagsSelected();
  els.allTags.textContent = all ? 'Clear' : 'All tags';
  els.allTags.setAttribute('aria-pressed',String(all));
}

async function openTagFilter(rule) {
  if (filterRule && ruleKey(filterRule) === ruleKey(rule)) { closeTagFilter(); return; }
  closeTagFilter(); filterRule = rule;
  const session = ++filterSession;
  tagChoices = []; tagChoicesSignature = '';
  els.tagSearch.value = ''; els.tagError.hidden = true;
  els.tagSearch.disabled = els.allTags.disabled = true;
  els.tagOptions.replaceChildren(Object.assign(document.createElement('p'), {className:'tag-empty',textContent:'Loading tags…'}));
  $(`filter-${rule.frameId}-${rule.id}`).setAttribute('aria-expanded','true');
  els.tagFilter.showPopover(); positionTagFilter();
  const response = await send('tag-options',{ruleId:rule.id,frameId:rule.frameId});
  if (session !== filterSession) return;
  els.tagSearch.disabled = els.allTags.disabled = false;
  tagChoices = response.tags || [];
  if (!response.ok) { els.tagError.textContent = describeError(response.error); els.tagError.hidden = false; }
  renderTagOptions(); positionTagFilter(); els.tagSearch.focus({preventScroll:true});
}

function updateTags(tags) {
  const target = filterRule, key = ruleKey(target), epoch = tabEpoch, edit = {tags};
  tagEdits.set(key,edit); els.tagError.hidden = true; renderTagOptions();
  tagQueue = tagQueue.then(async () => {
    if (epoch !== tabEpoch || tagEdits.get(key) !== edit) return;
    const response = await send('tags',{ruleId:target.id,frameId:target.frameId,tags});
    if (tagEdits.get(key) === edit) tagEdits.delete(key);
    if (response.stale) return;
    if (response.ok && response.state) setState(response.state);
    else if (filterRule && ruleKey(filterRule) === key) {
      els.tagError.textContent = describeError(response.error); els.tagError.hidden = false; renderTagOptions();
    }
  });
}

// Actions

async function run(action, payload = {}, family = '') {
  if (busy || !state || (state.status === 'Loading font' && !state.error)) return false;
  closeTagFilter();
  busy = true;
  pending = family;
  errorText = noteText = '';
  render();
  await tagQueue;
  const response = await send(action, payload);
  if (response.stale) return false;
  busy = false;
  pending = '';
  if (action === 'remember') rememberDeniedOrigin = '';
  if (!response.ok) {
    if (action === 'remember' && payload.enabled && response.code === 'SITE_PERMISSION_DENIED') rememberDeniedOrigin = payload.origin;
    else errorText = describeError(response.error);
  }
  if (response.ok && response.state) {
    if (action === 'undo') dismissedKey = doneKey = sourceKey(response.state);
    setState(response.state);
  }
  else render();
  return Boolean(response.ok);
}

async function choose(family, focusRow = true) {
  const key = sourceKey(state);
  if (!key) return;
  const ok = await run('preview', { destination: { kind: 'google', family }, scope: 'all' }, family);
  if (!ok) return;
  doneKey = sourceKey(state);
  els.search.value = '';
  render();
  const rule = state.rules.find(rule => ruleKey(rule) === doneKey);
  if (focusRow) $(`edit-${rule?.frameId}-${rule?.id}`)?.focus();
}

// Search

function adoptCatalog(families) {
  const activeFamily = matches[activeIndex]?.family;
  catalog = families.map((font, index) => ({family:font.family, key:font.family.toLowerCase(), rank:font.popularity ?? index})).sort((a,b) => a.rank - b.rank);
  if (state && !views.main.hidden) {
    const canSearch = Boolean(state.source) && !state.picking && !busy && !pending && state.status !== 'Loading font';
    activeIndex = activeFamily ? search(els.search.value).findIndex(font => font.family === activeFamily) : -1;
    renderResults(canSearch);
  }
}
function loadCatalog() {
  if (catalog) return catalog;
  catalogLoading ||= (async () => {
    const response = await chrome.runtime.sendMessage({ type: 'PANEL', action: 'catalog' }).catch((error) => ({ ok: false, error: error.message }));
    catalogLoading = null;
    if (catalog) return catalog; // A refresh notification may have arrived before this response.
    if (!response || !response.ok || !Array.isArray(response.catalog)) {
      errorText = describeError((response && response.error) || 'Could not load the font list.');
    } else {
      adoptCatalog(response.catalog);
    }
    if (state && !views.main.hidden) render();
    return catalog;
  })();
  return catalogLoading;
}

function search(query) {
  if (!catalog) return [];
  const q = query.trim().toLowerCase();
  if (!q) return catalog.slice(0, MAX_RESULTS);
  const found = [];
  for (const font of catalog) {
    const at = font.key.indexOf(q);
    if (at < 0) continue;
    const score = font.key === q ? 0 : at === 0 ? 1 : font.key.includes(` ${q}`) ? 2 : 3;
    found.push({ font, score });
  }
  return found.sort((a, b) => a.score - b.score || a.font.rank - b.font.rank).slice(0, MAX_RESULTS).map((entry) => entry.font);
}

function renderResults(show) {
  const query = els.search.value;
  matches = show ? search(query) : [];
  if (activeIndex >= matches.length) activeIndex = matches.length - 1;
  els.results.hidden = !show || !catalog;
  els.search.setAttribute('aria-expanded', String(matches.length > 0));
  const signature = JSON.stringify([show, Boolean(catalog), matches.map((font) => font.family)]);
  // Page refreshes can arrive between pointer down and up. Keep the click target alive.
  if (signature !== resultsSignature) {
    resultsSignature = signature;
    els.results.replaceChildren(...matches.map((font, index) => {
      const option = document.createElement('div');
      option.id = `result-${index}`;
      option.className = 'result';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === activeIndex));
      option.dataset.index = index;
      option.dataset.family = font.family;
      option.textContent = font.family;
      return option;
    }));
    if (show && catalog && !matches.length) {
      els.results.append(Object.assign(document.createElement('p'), { className: 'results-empty', textContent: 'No fonts found' }));
    }
  }
  setActive(activeIndex, false);
}

function setActive(index, scroll = true) {
  activeIndex = matches.length ? Math.max(-1, Math.min(index, matches.length - 1)) : -1;
  for (const option of els.results.querySelectorAll('.result')) {
    const selected = Number(option.dataset.index) === activeIndex;
    option.setAttribute('aria-selected', String(selected));
    if (selected && scroll) option.scrollIntoView({ block: 'nearest' });
  }
  if (activeIndex < 0) els.search.removeAttribute('aria-activedescendant');
  else els.search.setAttribute('aria-activedescendant', `result-${activeIndex}`);
}

// Events

els.mode.addEventListener('click', async () => {
  if (busy || els.mode.disabled || tabId === null) return;
  els.mode.disabled = true;
  switchingMode = true;
  const response = await send('mode', { mode: floating ? 'sidepanel' : 'floating' });
  els.mode.disabled = false;
  if (!response.ok) switchingMode = false;
  if (!response.ok && !response.stale) {
    els.connectError.textContent = describeError(response.error);
    if (state) { errorText = describeError(response.error); render(); }
    else showView('error');
  }
});

els.remember.addEventListener('change', () => run('remember', { enabled: els.remember.checked, origin: state.siteOrigin }));
els.rememberRetry.addEventListener('click', () => run('remember', { enabled: true, origin: state.siteOrigin }));

els.retry.addEventListener('click', connect);
els.undo.addEventListener('click', () => run('undo'));
els.another.addEventListener('click', () => run('pick', { mode: 'source' }));
els.pickDest.addEventListener('click', () => run('pick', { mode: 'destination' }));

els.pairs.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || busy) return;
  if (button.dataset.action === 'pick-source') { await run('pick', { mode: 'source' }); return; }
  if (button.dataset.action === 'cancel-pick') {
    if (!event.target.closest('.pair-from')) await run('cancel');
    return;
  }
  if (button.dataset.action.startsWith('draft-')) {
    if (state.picking) await run('cancel');
    if (button.dataset.action === 'draft-remove') { dismissedKey = sourceKey(state); doneKey = dismissedKey; }
    else doneKey = button.getAttribute('aria-expanded') === 'true' ? sourceKey(state) : '';
    render();
    (button.dataset.action === 'draft-remove' ? (els.another.hidden ? els.pairs.querySelector('[data-action="pick-source"]') : els.another) : els.steps.hidden ? $(button.id) : els.search)?.focus();
    return;
  }
  const payload = { ruleId: button.dataset.ruleId, frameId: Number(button.dataset.frameId) };
  const rule = state.rules.find((entry) => String(entry.id) === payload.ruleId && entry.frameId === payload.frameId);
  if (busy || !rule) return;
  payload.ruleId = rule.id;
  if (button.dataset.action === 'filter') { openTagFilter(rule); return; }
  if (button.dataset.action === 'select') {
    if (button.getAttribute('aria-expanded') === 'true') {
      if (state.picking) await run('cancel');
      doneKey = sourceKey(state);
      render();
      if (event.detail === 0) $(button.id)?.focus();
      return;
    }
    if (await run('select', payload)) {
      doneKey = '';
      els.search.value = '';
      activeIndex = -1;
      render();
      els.search.focus();
    }
  } else {
    const selected = sourceKey(state) === ruleKey(rule);
    if (!await run('remove', payload)) return;
    if (selected) { dismissedKey = doneKey = sourceKey(state); render(); }
    (els.another.hidden ? els.pairs.querySelector('[data-action="pick-source"]') : els.another)?.focus();
  }
});

els.tagSearch.addEventListener('input',() => { renderTagOptions(); positionTagFilter(); });
els.allTags.addEventListener('click',() => updateTags(allTagsSelected() ? [] : null));
els.tagOptions.addEventListener('change',event => {
  const tag = event.target.dataset.tag;
  if (!tag || !filterRule) return;
  const tags = new Set(currentFilterTags() ?? tagChoices.map(choice => choice.tag));
  if (event.target.checked) tags.add(tag); else tags.delete(tag);
  updateTags([...tags].sort());
});
els.tagFilter.addEventListener('beforetoggle',event => {
  if (event.newState !== 'closed') return;
  if (filterRule) $(`filter-${filterRule.frameId}-${filterRule.id}`)?.setAttribute('aria-expanded','false');
  filterRule = null; filterSession++;
});
addEventListener('resize',positionTagFilter);
root.addEventListener('scroll',positionTagFilter,true);
root.addEventListener('click',event => { if (event.target.closest('#close-panel')) closeTagFilter(); });

els.search.addEventListener('focus', loadCatalog);
els.search.addEventListener('input', () => {
  activeIndex = els.search.value.trim() ? 0 : -1;
  renderResults(true);
  els.results.scrollTop = 0;
});
els.search.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') setActive(activeIndex + 1);
  else if (event.key === 'ArrowUp') setActive(Math.max(0, activeIndex - 1));
  else if (event.key === 'Home' && activeIndex >= 0) setActive(0);
  else if (event.key === 'End' && activeIndex >= 0) setActive(matches.length - 1);
  else if (event.key === 'Enter' && matches[activeIndex]) choose(matches[activeIndex].family);
  else if (event.key === 'Escape' && els.search.value) {
    els.search.value = '';
    activeIndex = -1;
    renderResults(true);
  } else return;
  event.preventDefault();
});
// Keep focus in the search box so arrow keys keep working after a click.
els.results.addEventListener('mousedown', (event) => event.preventDefault());
els.results.addEventListener('click', (event) => {
  const option = event.target.closest('.result');
  if (option) choose(matches[Number(option.dataset.index)].family, event.detail === 0);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === chrome.runtime.id && message?.type === 'CATALOG_CHANGED' && Array.isArray(message.catalog)) {
    adoptCatalog(message.catalog);
    return;
  }
  if (floating && message?.type === 'HIDE_FLOATING') closeTagFilter();
  if (!message || message.type !== 'STATE_CHANGED' || message.tabId !== tabId || !message.state) return;
  if (busy) return; // the pending action returns newer state
  setState(message.state);
});
if (!floating) chrome.tabs.onActivated.addListener(scheduleConnect);
if (!floating) chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.status === 'complete') scheduleConnect();
});
if (!floating) {
  const cancelPicking = () => { if (!switchingMode && tabId !== null) send('cancel'); };
  window.addEventListener('pagehide', cancelPicking);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPicking(); else switchingMode = false; });
}
(floating ? root : document).addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && filterRule) { event.preventDefault(); closeTagFilter(true); return; }
  if (event.key === 'Escape' && state?.picking) {
    event.preventDefault();
    run('cancel');
  }
});

loadCatalog();
chrome.runtime.sendMessage({type:'PANEL',action:'open'}).catch(() => {});
connect();
})();
