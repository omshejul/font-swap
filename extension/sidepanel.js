// Side panel: pick a font on the page, choose its replacement, done.

const MAX_RESULTS = 30;
const RECONNECT_DELAY_MS = 150;
const FALLBACK_ERROR = 'That did not work. Try again.';

const $ = (id) => document.getElementById(id);

const els = {
  undo: $('undo'),
  connectError: $('connect-error'),
  retry: $('retry'),
  picking: $('picking'),
  cancel: $('cancel'),
  pairs: $('pairs'),
  steps: $('steps'),
  pickSource: $('pick-source'),
  sourceName: $('source-name'),
  search: $('search'),
  results: $('results'),
  pickDest: $('pick-dest'),
  another: $('another'),
  note: $('note'),
  error: $('error'),
  warnings: $('warnings'),
  warningList: $('warning-list'),
};

const views = { loading: $('view-loading'), error: $('view-error'), main: $('view-main') };

let tabId = null;
let tabEpoch = 0;
let state = null;
let busy = false;
let pending = '';
let errorText = '';
let noteText = '';
let doneKey = ''; // source whose swap is finished, so the steps can collapse
let reconnectTimer = 0;
let catalog = null;
let catalogLoading = null;
let matches = [];
let activeIndex = -1;
let pairsSignature = '';

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
  const epoch = ++tabEpoch;
  state = null;
  busy = false;
  pending = errorText = noteText = doneKey = '';
  showView('loading');
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = null;
  }
  if (epoch !== tabEpoch) return;
  // The panel itself can be the active tab when opened as a page. Keep the last real tab.
  if (tab && tab.url && tab.url.startsWith(chrome.runtime.getURL(''))) tab = tabId === null ? null : { id: tabId };
  tabId = tab ? tab.id : null;
  const response = tabId === null ? { ok: false, error: 'Open a website first.' } : await send('connect');
  if (response.stale || epoch !== tabEpoch) return;
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
    if (previous.picking === 'source') doneKey = '';
    else if (changed && next.destination) doneKey = sourceKey(next);
    // A pick that ended without a result explains itself through the page status.
    noteText = changed ? '' : next.status || '';
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
  const editing = !rules.length || (state.source && sourceKey(state) !== doneKey);
  const canSearch = Boolean(state.source) && !state.picking && !busy;

  views.main.inert = busy;
  views.main.setAttribute('aria-busy', String(busy));
  els.undo.hidden = !rules.length;
  els.undo.disabled = busy;
  els.picking.hidden = !state.picking;
  renderPairs(rules);

  els.steps.hidden = !editing;
  els.another.hidden = editing;
  els.sourceName.textContent = state.source || 'Pick font';
  els.pickSource.setAttribute('aria-label', state.source ? `Font to change: ${state.source}. Pick another` : 'Pick font to change');
  els.pickSource.setAttribute('aria-pressed', String(state.picking === 'source'));
  els.search.disabled = !state.source || busy;
  els.pickDest.hidden = !canSearch;
  renderResults(canSearch);

  els.note.textContent = pending ? `Loading ${pending}` : noteText;
  const pageError = typeof state.error === 'string' ? state.error.trim() : '';
  const shown = [...new Set([errorText, pageError && describeError(pageError)].filter(Boolean))].join(' ');
  els.error.textContent = shown;
  els.error.hidden = !shown;
  const warnings = Array.isArray(state.warnings) ? state.warnings : [];
  els.warnings.hidden = !warnings.length;
  els.warningList.replaceChildren(...warnings.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
}

function renderPairs(rules) {
  els.pairs.hidden = !rules.length;
  const current = sourceKey(state);
  const signature = JSON.stringify([current, rules.map((rule) => [rule.id, rule.frameId, rule.source, destinationName(rule.destination)])]);
  if (signature === pairsSignature) return;
  pairsSignature = signature;
  els.pairs.replaceChildren(...rules.map((rule) => {
    const from = rule.source;
    const to = destinationName(rule.destination);
    const item = document.createElement('li');
    item.className = 'pair';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'pair-edit';
    edit.dataset.action = 'select';
    edit.setAttribute('aria-label', `Change ${from} to ${to}`);
    if (`${rule.frameId}:${from}` === current) edit.setAttribute('aria-current', 'true');
    const arrow = Object.assign(document.createElement('span'), { className: 'pair-arrow', textContent: '→' });
    edit.append(Object.assign(document.createElement('span'), { textContent: from }), arrow, Object.assign(document.createElement('span'), { textContent: to }));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pair-remove';
    remove.dataset.action = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${from} to ${to}`);
    for (const button of [edit, remove]) {
      button.dataset.ruleId = rule.id;
      button.dataset.frameId = rule.frameId;
    }
    item.append(edit, remove);
    return item;
  }));
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
  if (response.ok && response.state) setState(response.state);
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
  els.another.focus();
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
  setActive(activeIndex);
}

function setActive(index) {
  activeIndex = matches.length ? Math.max(-1, Math.min(index, matches.length - 1)) : -1;
  for (const option of els.results.querySelectorAll('.result')) {
    const selected = Number(option.dataset.index) === activeIndex;
    option.setAttribute('aria-selected', String(selected));
    if (selected) option.scrollIntoView({ block: 'nearest' });
  }
  if (activeIndex < 0) els.search.removeAttribute('aria-activedescendant');
  else els.search.setAttribute('aria-activedescendant', `result-${activeIndex}`);
}

// Events

els.retry.addEventListener('click', connect);
els.cancel.addEventListener('click', () => run('cancel'));
els.undo.addEventListener('click', () => run('undo'));
els.pickSource.addEventListener('click', () => run('pick', { mode: 'source' }));
els.another.addEventListener('click', () => run('pick', { mode: 'source' }));
els.pickDest.addEventListener('click', () => run('pick', { mode: 'destination' }));

els.pairs.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const payload = { ruleId: button.dataset.ruleId, frameId: Number(button.dataset.frameId) };
  const rule = state.rules.find((entry) => String(entry.id) === payload.ruleId && entry.frameId === payload.frameId);
  if (rule) payload.ruleId = rule.id;
  if (button.dataset.action === 'select') {
    doneKey = '';
    if (await run('select', payload)) els.search.focus();
  } else if (await run('remove', payload)) {
    (els.another.hidden ? els.pickSource : els.another).focus();
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
chrome.tabs.onActivated.addListener(scheduleConnect);
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.status === 'complete') scheduleConnect();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state?.picking) {
    event.preventDefault();
    run('cancel');
  }
});

loadCatalog();
connect();
