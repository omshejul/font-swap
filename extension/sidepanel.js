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
  mode: $('mode-toggle'),
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
let noteText = '';
let dismissedKey = '';
let doneKey = ''; // source whose swap is finished, so the steps can collapse
let reconnectTimer = 0;
let catalog = null;
let catalogLoading = null;
let matches = [];
let activeIndex = -1;
let pairsSignature = '';
let resultsSignature = '';

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
  state = null;
  busy = false;
  pending = errorText = noteText = doneKey = dismissedKey = '';
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

const sourceKey = (s) => (s && s.source ? `${s.frameId}:${s.source}` : '');
const destinationName = (destination) => (destination && destination.family) || '';

function setState(next) {
  const previous = state;
  state = next;
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
  const canSearch = Boolean(state.source) && !state.picking && !busy;
  const waitingForSource = state.picking === 'source' || (!rules.length && (!state.source || sourceKey(state) === dismissedKey));

  views.main.inert = busy;
  views.main.setAttribute('aria-busy', String(busy));
  els.undo.hidden = !rules.length;
  els.undo.disabled = busy;
  els.mode.disabled = busy;
  views.main.dataset.picking = state.picking || '';
  const inline = renderPairs(rules, editing, waitingForSource);

  els.steps.hidden = !editing;
  els.stepsHome.hidden = !editing || inline;
  els.another.hidden = waitingForSource;
  els.search.disabled = !state.source || busy;
  els.pickDest.hidden = !canSearch;
  renderResults(canSearch);

  const loadingFont = Boolean(pending) || (state.status === 'Loading font' && !state.error && !errorText);
  els.note.classList.toggle('is-loading', loadingFont);
  els.note.textContent = pending ? `Loading ${pending}` : loadingFont ? 'Loading font' : noteText;
  const pageError = typeof state.error === 'string' ? state.error.trim() : '';
  const shown = [...new Set([errorText, pageError && describeError(pageError)].filter(Boolean))].join(' ');
  els.error.textContent = shown;
  els.error.hidden = !shown;
}

function renderPairs(rules, editing, waitingForSource) {
  const hasDraft = !waitingForSource && state.source && !rules.some(rule => `${rule.frameId}:${rule.source}` === sourceKey(state)) && sourceKey(state) !== dismissedKey;
  const rows = waitingForSource ? [...rules, {id:'picking',frameId:state.frameId,source:'Pick from page',destination:null}] : hasDraft ? [...rules, {id:'draft', frameId:state.frameId, source:state.source, destination:null}] : rules;
  els.pairs.hidden = !rows.length;
  const openKey = editing ? sourceKey(state) : '';
  const inline = rows.some((rule) => `${rule.frameId}:${rule.source}` === openKey);
  const signature = JSON.stringify([openKey, state.picking, rows.map((rule) => [rule.id, rule.frameId, rule.source, destinationName(rule.destination)])]);
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
    const open = waiting || `${rule.frameId}:${from}` === openKey;
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
    header.append(edit, remove);
    if (open) {
      if (!waiting) body.append(els.steps);
      body.append(els.note,els.error);
    }
    item.append(header, body);
    return item;
  }));
  return inline;
}

// Actions

async function run(action, payload = {}, family = '') {
  if (busy || !state) return false;
  busy = true;
  pending = family;
  errorText = noteText = '';
  render();
  const response = await send(action, payload);
  if (response.stale) return false;
  busy = false;
  pending = '';
  if (!response.ok) errorText = describeError(response.error);
  if (response.ok && response.state) {
    if (action === 'undo') dismissedKey = doneKey = sourceKey(response.state);
    setState(response.state);
  }
  else render();
  return Boolean(response.ok);
}

async function choose(family) {
  const key = sourceKey(state);
  if (!key) return;
  const ok = await run('preview', { destination: { kind: 'google', family }, scope: 'all' }, family);
  if (!ok) return;
  doneKey = key;
  els.search.value = '';
  render();
  const rule = state.rules.find(rule => `${rule.frameId}:${rule.source}` === key);
  $(`edit-${rule?.frameId}-${rule?.id}`)?.focus();
}

// Search

function loadCatalog() {
  if (catalog) return catalog;
  catalogLoading ||= (async () => {
    const response = await chrome.runtime.sendMessage({ type: 'PANEL', action: 'catalog' }).catch((error) => ({ ok: false, error: error.message }));
    catalogLoading = null;
    if (!response || !response.ok || !Array.isArray(response.catalog)) {
      errorText = describeError((response && response.error) || 'Could not load the font list.');
    } else {
      catalog = response.catalog
        .map((font, index) => ({ family: font.family, key: font.family.toLowerCase(), rank: font.popularity ?? index }))
        .sort((a, b) => a.rank - b.rank);
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
  const response = await send('mode', { mode: floating ? 'sidepanel' : 'floating' });
  els.mode.disabled = false;
  if (!response.ok && !response.stale) {
    els.connectError.textContent = describeError(response.error);
    if (state) { errorText = describeError(response.error); render(); }
    else showView('error');
  }
});

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
  if (button.dataset.action === 'select') {
    if (button.getAttribute('aria-expanded') === 'true') {
      if (state.picking) await run('cancel');
      doneKey = sourceKey(state);
      render();
      $(button.id)?.focus();
      return;
    }
    if (await run('select', payload)) {
      doneKey = '';
      els.search.value = '';
      activeIndex = -1;
      render();
      els.search.focus();
    }
  } else if (await run('remove', payload)) {
    if (sourceKey(state) === `${rule.frameId}:${rule.source}`) { dismissedKey = doneKey = sourceKey(state); render(); }
    (els.another.hidden ? els.pairs.querySelector('[data-action="pick-source"]') : els.another)?.focus();
  }
});

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
  if (option) choose(matches[Number(option.dataset.index)].family);
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'STATE_CHANGED' || message.tabId !== tabId || !message.state) return;
  if (busy) return; // the pending action returns newer state
  setState(message.state);
});
if (!floating) chrome.tabs.onActivated.addListener(scheduleConnect);
if (!floating) chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.status === 'complete') scheduleConnect();
});
(floating ? root : document).addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state?.picking) {
    event.preventDefault();
    run('cancel');
  }
});

loadCatalog();
connect();
})();
