// Side panel implementation follows the message contract in UI-CONTRACT.md.

const MAX_RESULTS = 12;
const MAX_SAMPLES = 4;
const MAX_PAGE_EXTRAS = 3;
const MAX_SAMPLE_FACES = 8;
const MAX_CACHED_SAMPLES = 32;
const SEARCH_DEBOUNCE_MS = 120;
const SAMPLE_DELAY_MS = 200;
const SAMPLE_RETRY_MS = 30000;
const RECONNECT_DELAY_MS = 150;
const DEFAULT_SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog';

const RESTRICTED_TEXT = 'Font Swap cannot change fonts on this page. Open a regular web page, then select Try again.';
const ACCESS_TEXT = 'Font Swap needs access to this tab. Select the Font Swap toolbar icon on this tab, then select Try again.';
const UNREACHABLE_TEXT = 'Font Swap could not reach this page. Reload the page, then select Try again.';
const NO_TAB_TEXT = 'No active tab was found. Open a web page, then select Try again.';

const $ = (id) => document.getElementById(id);

const els = {
  status: $('status'),
  picking: $('picking'),
  pickingText: $('picking-text'),
  pickingCancel: $('picking-cancel'),
  errorText: $('error-text'),
  retry: $('retry'),
  emptyPick: $('empty-pick'),
  emptyManual: $('empty-manual'),
  emptyError: $('empty-error'),
  sourcePick: $('source-pick'),
  sourceError: $('source-error'),
  snippet: $('snippet'),
  snippetText: $('snippet-text'),
  snippetMeta: $('snippet-meta'),
  destPick: $('dest-pick'),
  destError: $('dest-error'),
  category: $('dest-category'),
  catalogRetry: $('catalog-retry'),
  scope: $('scope'),
  scopeAll: $('scope-all'),
  scopeElement: $('scope-element'),
  count: $('count'),
  warnings: $('warnings'),
  apply: $('apply'),
  compare: $('compare'),
  undo: $('undo'),
  actionError: $('action-error'),
};

const views = {
  loading: $('view-loading'),
  error: $('view-error'),
  empty: $('view-empty'),
  editor: $('view-editor'),
};

function createField(name) {
  return {
    name,
    wrap: $(`${name}-field`),
    input: $(`${name}-input`),
    panel: $(`${name}-panel`),
    list: $(`${name}-results`),
    note: $(`${name}-note`),
    dirty: false, // input holds an uncommitted search draft
    settled: false, // a result was chosen while the draft was still shown
    open: false,
    quiet: false,
    rebuilding: false,
    items: [],
    signature: '',
    timer: 0,
  };
}

const fields = { source: createField('source'), dest: createField('dest') };

let tabId = null;
let tabEpoch = 0;
let state = null;
let connecting = false;
let connectSeq = 0;
let reconnectTimer = 0;
let reconnectReason = '';
let panelError = '';
let manual = false;
let pendingFamily = '';
let scopeDraft = 'all';
let scopeDirty = false;
let sampleTimer = 0;
let aliasSeq = 0;
let pointerDown = false;

const busy = new Set();
const errors = { source: '', dest: '', action: '' };
const catalog = { status: 'idle', entries: [], names: new Set(), byCategory: new Map() };
const samples = new Map();
const deferred = [];

// Messaging

async function send(action, payload = {}, anyTab = false) {
  const epoch = tabEpoch;
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'PANEL', action, tabId, ...payload });
  } catch (error) {
    response = { ok: false, error: error && error.message ? error.message : '' };
  }
  if (!anyTab && epoch !== tabEpoch) return { ok: false, stale: true };
  if (!response || typeof response !== 'object') return { ok: false, error: '' };
  return response;
}

function describeError(raw, fallback = 'That did not work. Try again.') {
  const text = String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^at\s/.test(line))[0] || '';
  const message = text.replace(/^(Uncaught\s+)?(\w*Error:\s*)+/i, '').trim();
  if (!message) return fallback;
  if (/chrome(-extension|-search|-untrusted)?:\/\/|edge:\/\/|about:|view-source:|devtools:|extensions gallery|webstore|cannot be scripted|restricted/i.test(message)) {
    return RESTRICTED_TEXT;
  }
  if (/cannot access|activeTab|permission|host access|not allowed/i.test(message)) return ACCESS_TEXT;
  if (/receiving end does not exist|could not establish connection|message port closed|no tab with id|frame .* (removed|not found)/i.test(message)) {
    return UNREACHABLE_TEXT;
  }
  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

function isRestrictedUrl(url) {
  if (!url) return false;
  return /^(chrome|chrome-extension|chrome-search|chrome-untrusted|devtools|edge|brave|about|view-source):/i.test(url)
    || /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url);
}

// State

function normalizeQuery(value) {
  return String(value || '').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeState(next) {
  const pageFonts = Array.isArray(next.pageFonts) ? next.pageFonts : [];
  const destination = next.destination && next.destination.family ? next.destination : null;
  return {
    ...next,
    selection: next.selection || null,
    pageFonts: pageFonts
      .filter((font) => font && typeof font.family === 'string' && font.family)
      .map((font) => ({ family: font.family, count: Number(font.count) || 0, lower: normalizeQuery(font.family) })),
    source: typeof next.source === 'string' ? next.source : '',
    destination,
    scope: next.scope === 'element' ? 'element' : 'all',
    count: Number(next.count) || 0,
    picking: next.picking === 'source' || next.picking === 'destination' ? next.picking : null,
    status: typeof next.status === 'string' ? next.status : '',
    warnings: Array.isArray(next.warnings) ? next.warnings.filter((item) => typeof item === 'string' && item) : [],
  };
}

function committed(name) {
  if (!state) return '';
  return name === 'source' ? state.source : state.destination ? state.destination.family : '';
}

function resetField(name) {
  const field = fields[name];
  clearTimeout(field.timer);
  field.dirty = false;
  field.settled = false;
  field.open = false;
  const value = committed(name);
  if (field.input.value !== value) field.input.value = value;
}

function syncField(name, changed, keep) {
  const field = fields[name];
  if (!field.dirty) {
    const value = committed(name);
    if (field.input.value !== value) field.input.value = value;
    return;
  }
  // A typed draft survives unrelated updates; a new pick from the page replaces it.
  if (changed && !keep) resetField(name);
}

function applyState(next, options = {}) {
  if (!next || typeof next !== 'object') return;
  if (next.tabId != null && tabId != null && next.tabId !== tabId) return;
  const previous = state;
  const previousDest = previous && previous.destination ? previous.destination.family : '';
  state = normalizeState(next);
  panelError = '';
  if (!scopeDirty) scopeDraft = state.scope;
  syncField('source', !previous || previous.source !== state.source, false);
  syncField('dest', previousDest !== committed('dest'), options.keepDest);
}

function resetPanel() {
  tabEpoch += 1;
  state = null;
  manual = false;
  pendingFamily = '';
  scopeDraft = 'all';
  scopeDirty = false;
  busy.clear();
  errors.source = '';
  errors.dest = '';
  errors.action = '';
  resetField('source');
  resetField('dest');
}

// Connection

async function connect(reason) {
  const seq = ++connectSeq;
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (error) {
    tab = null;
  }
  if (seq !== connectSeq) return;
  const nextId = tab && typeof tab.id === 'number' ? tab.id : null;
  // Activation in another window reports the tab this panel already follows.
  if (reason === 'activated' && !connecting && nextId !== null && nextId === tabId && (state || panelError)) return;
  if (nextId !== tabId) resetPanel();
  tabId = nextId;
  panelError = '';
  connecting = true;
  render();

  let response;
  if (tabId === null) {
    response = { ok: false, text: NO_TAB_TEXT };
  } else if (isRestrictedUrl(tab.url)) {
    response = { ok: false, text: RESTRICTED_TEXT };
  } else {
    try {
      response = await chrome.runtime.sendMessage({ type: 'PANEL', action: 'connect', tabId });
    } catch (error) {
      response = { ok: false, error: error && error.message ? error.message : '' };
    }
    if (seq !== connectSeq) return;
  }

  connecting = false;
  if (response && response.ok && response.state) {
    applyState(response.state);
  } else {
    resetPanel();
    panelError = (response && response.text)
      || describeError(response && response.error, 'Font Swap could not connect to this page. Select Try again.');
  }
  render();
  if (catalog.status === 'idle' || catalog.status === 'error') loadCatalog();
}

function scheduleConnect(reason) {
  reconnectReason = reason === 'updated' || reconnectReason === 'updated' ? 'updated' : reason;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    const next = reconnectReason;
    reconnectReason = '';
    connect(next);
  }, RECONNECT_DELAY_MS);
}

// Catalog and search

function categoryLabel(category) {
  const text = String(category || '').replace(/[-_]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : '';
}

async function loadCatalog() {
  if (catalog.status === 'loading' || catalog.status === 'ready') return;
  catalog.status = 'loading';
  render();
  const response = await send('catalog', {}, true);
  const list = response.ok && Array.isArray(response.catalog) ? response.catalog : [];
  const entries = [];
  const names = new Set();
  const byCategory = new Map();
  for (const font of list) {
    if (!font || typeof font.family !== 'string' || !font.family) continue;
    const entry = { family: font.family, category: String(font.category || ''), lower: normalizeQuery(font.family) };
    if (names.has(entry.lower)) continue;
    names.add(entry.lower);
    entries.push(entry);
    if (!entry.category) continue;
    if (!byCategory.has(entry.category)) byCategory.set(entry.category, []);
    byCategory.get(entry.category).push(entry);
  }
  if (entries.length) {
    catalog.status = 'ready';
    catalog.entries = entries;
    catalog.names = names;
    catalog.byCategory = byCategory;
    const options = [...byCategory.keys()].sort().map((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = categoryLabel(category);
      return option;
    });
    els.category.replaceChildren(els.category.options[0], ...options);
  } else {
    catalog.status = 'error';
  }
  render();
}

function rank(list, query, limit, accept) {
  const exact = [];
  const starts = [];
  const words = [];
  const inner = [];
  for (const entry of list) {
    if (accept && !accept(entry)) continue;
    if (!query) {
      starts.push(entry);
      continue;
    }
    const at = entry.lower.indexOf(query);
    if (at < 0) continue;
    if (entry.lower.length === query.length) exact.push(entry);
    else if (at === 0) starts.push(entry);
    else if (entry.lower[at - 1] === ' ') words.push(entry);
    else inner.push(entry);
  }
  const all = exact.concat(starts, words, inner);
  return { items: all.slice(0, Math.max(0, limit)), total: all.length };
}

function elementCount(count) {
  return count === 1 ? '1 element' : `${count.toLocaleString()} elements`;
}

function moreNote(shown, total) {
  return total > shown ? `Showing ${shown} of ${total.toLocaleString()}. Keep typing to narrow the list.` : '';
}

function sourceResults() {
  const field = fields.source;
  const typed = field.dirty ? field.input.value.trim() : '';
  const query = normalizeQuery(typed);
  const pageFonts = state ? state.pageFonts : [];
  const page = rank(pageFonts, query, MAX_RESULTS);
  let google = { items: [], total: 0 };
  if (query && catalog.status === 'ready') {
    const onPage = new Set(pageFonts.map((font) => font.lower));
    google = rank(catalog.entries, query, MAX_RESULTS - page.items.length, (entry) => !onPage.has(entry.lower));
  }
  const items = [
    ...page.items.map((font) => ({ kind: 'page', family: font.family, meta: elementCount(font.count), group: 'On this page' })),
    ...google.items.map((font) => ({ kind: 'google', family: font.family, meta: categoryLabel(font.category), group: 'Google Fonts' })),
  ];
  const total = page.total + google.total;
  let note = '';
  if (query && catalog.status === 'loading') note = 'Loading Google Fonts';
  else if (query && catalog.status !== 'ready') note = items.length ? 'The Google Fonts list could not be loaded.' : `No page fonts match "${typed}". The Google Fonts list could not be loaded.`;
  else if (!items.length) note = query ? `No fonts match "${typed}".` : 'No fonts were found on this page. Type a name to search Google Fonts.';
  else if (total > items.length) note = moreNote(items.length, total);
  else if (!query) note = 'Type a name to search Google Fonts as well.';
  return { items, note, showGroups: true };
}

function destResults() {
  const field = fields.dest;
  const typed = field.dirty ? field.input.value.trim() : '';
  const query = normalizeQuery(typed);
  const category = els.category.value || 'all';
  const ready = catalog.status === 'ready';
  const pageFonts = state ? state.pageFonts : [];
  const extras = query && category === 'all'
    ? rank(pageFonts, query, MAX_PAGE_EXTRAS, (font) => !catalog.names.has(font.lower))
    : { items: [], total: 0 };
  const pool = category === 'all' ? catalog.entries : catalog.byCategory.get(category) || [];
  const google = ready ? rank(pool, query, MAX_RESULTS - extras.items.length) : { items: [], total: 0 };
  const items = [
    ...google.items.map((font, index) => ({
      kind: 'google',
      family: font.family,
      meta: categoryLabel(font.category),
      group: 'Google Fonts',
      sample: index < MAX_SAMPLES,
    })),
    ...extras.items.map((font) => ({ kind: 'page', family: font.family, meta: elementCount(font.count), group: 'On this page' })),
  ];
  const total = google.total + extras.total;
  let note = '';
  if (catalog.status === 'loading' || catalog.status === 'idle') note = 'Loading Google Fonts';
  else if (!ready) note = 'The Google Fonts list could not be loaded.';
  else if (!items.length) note = query ? `No fonts match "${typed}".` : 'No fonts in this style.';
  else note = moreNote(items.length, total);
  return { items, note, showGroups: extras.items.length > 0 };
}

// Samples

function sampleText() {
  const text = state && state.selection && typeof state.selection.text === 'string'
    ? state.selection.text.replace(/\s+/g, ' ').trim()
    : '';
  return text ? text.slice(0, 60) : DEFAULT_SAMPLE_TEXT;
}

function faceDescriptors(descriptors) {
  const clean = {};
  if (!descriptors || typeof descriptors !== 'object') return clean;
  for (const key of ['weight', 'style', 'unicodeRange']) {
    const value = descriptors[key];
    if (typeof value === 'number' || (typeof value === 'string' && value)) clean[key] = String(value);
  }
  return clean;
}

function trimSamples() {
  if (samples.size <= MAX_CACHED_SAMPLES) return;
  const visible = new Set(fields.dest.items.map((item) => item.family));
  for (const [family, entry] of samples) {
    if (samples.size <= MAX_CACHED_SAMPLES) break;
    if (entry.status === 'loading' || visible.has(family)) continue;
    for (const face of entry.faces) document.fonts.delete(face);
    samples.delete(family);
  }
}

async function loadSample(family) {
  // Each sample gets its own alias so it can never collide with a font the panel or page already uses.
  const entry = { status: 'loading', alias: `font-swap-sample-${++aliasSeq}`, faces: [], at: Date.now() };
  samples.set(family, entry);
  render();
  const response = await send('sample', { family }, true);
  try {
    const faces = response.ok && response.preview && Array.isArray(response.preview.faces) ? response.preview.faces : [];
    const built = [];
    for (const face of faces.slice(0, MAX_SAMPLE_FACES)) {
      if (!face || !Array.isArray(face.bytes) || !face.bytes.length) continue;
      built.push(new FontFace(entry.alias, new Uint8Array(face.bytes).buffer, faceDescriptors(face.descriptors)));
    }
    const settled = await Promise.allSettled(built.map((face) => face.load()));
    const loaded = built.filter((face, index) => settled[index].status === 'fulfilled');
    if (!loaded.length) throw new Error('No usable sample faces');
    for (const face of loaded) document.fonts.add(face);
    entry.faces = loaded;
    entry.status = 'ready';
  } catch (error) {
    entry.status = 'error';
  }
  entry.at = Date.now();
  // The row is looked up again on render, so a result that scrolled out of the list is simply skipped.
  if (samples.get(family) === entry) render();
  trimSamples();
}

function scheduleSamples(items) {
  clearTimeout(sampleTimer);
  if (tabId === null) return;
  const wanted = items.filter((item) => item.sample).map((item) => item.family).filter((family) => {
    const entry = samples.get(family);
    return !entry || (entry.status === 'error' && Date.now() - entry.at > SAMPLE_RETRY_MS);
  });
  if (!wanted.length) return;
  sampleTimer = setTimeout(() => {
    for (const family of wanted) {
      const entry = samples.get(family);
      if (!entry || entry.status === 'error') loadSample(family);
    }
  }, SAMPLE_DELAY_MS);
}

// Rendering

function currentView() {
  if (panelError) return 'error';
  if (!state) return 'loading';
  if (state.selection || state.source || state.destination || manual) return 'editor';
  return 'empty';
}

function setText(node, text) {
  const value = text || '';
  if (node.textContent !== value) node.textContent = value;
  if (node.hidden !== !value) node.hidden = !value;
}

function statusText() {
  if (connecting) return state ? 'Reconnecting' : '';
  if (busy.has('preview')) return pendingFamily ? `Loading ${pendingFamily}` : 'Loading preview';
  if (busy.has('apply')) return 'Applying';
  if (busy.has('undo')) return 'Restoring original';
  if (busy.has('source')) return 'Finding matching text';
  return state ? state.status : '';
}

function buildResult(item, index, selected, blocked, text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'result';
  button.dataset.index = String(index);
  button.dataset.family = item.family;
  if (selected) button.setAttribute('aria-current', 'true');
  if (blocked) button.setAttribute('aria-disabled', 'true');

  const main = document.createElement('span');
  main.className = 'result-main';
  const name = document.createElement('span');
  name.className = 'result-name';
  name.textContent = item.family;
  const meta = document.createElement('span');
  meta.className = 'result-meta';
  meta.textContent = blocked && pendingFamily === item.family && busy.has('preview') ? 'Loading' : item.meta;
  main.append(name, meta);
  button.append(main);

  if (item.sample) {
    const entry = samples.get(item.family);
    const sample = document.createElement('span');
    sample.className = 'result-sample';
    if (entry && entry.status === 'ready') {
      sample.textContent = text;
      sample.style.fontFamily = `"${entry.alias}", system-ui, sans-serif`;
    } else {
      sample.classList.add('is-waiting');
      sample.textContent = entry && entry.status === 'error' ? 'Sample unavailable' : 'Loading sample';
    }
    button.append(sample);
  }

  const row = document.createElement('li');
  row.append(button);
  return row;
}

function renderResults(name) {
  const field = fields[name];
  field.panel.hidden = !field.open;
  if (name === 'dest') els.catalogRetry.hidden = !field.open || catalog.status !== 'error';
  if (!field.open) {
    field.items = [];
    field.signature = '';
    return;
  }
  const { items, note, showGroups } = name === 'source' ? sourceResults() : destResults();
  const chosen = normalizeQuery(committed(name));
  const blocked = busy.size > 0;
  const text = name === 'dest' ? sampleText() : '';
  const signature = JSON.stringify([
    items.map((item) => [item.kind, item.family, item.meta, item.sample ? (samples.get(item.family) || {}).status || '' : null]),
    chosen, blocked, pendingFamily, showGroups, text,
  ]);
  field.items = items;
  setText(field.note, note);
  if (signature === field.signature) return;
  field.signature = signature;

  const active = document.activeElement;
  const focused = field.list.contains(active) ? active.dataset.family : null;
  const rows = [];
  let group = '';
  items.forEach((item, index) => {
    if (showGroups && item.group !== group) {
      group = item.group;
      const label = document.createElement('li');
      label.className = 'result-group';
      label.textContent = group;
      rows.push(label);
    }
    rows.push(buildResult(item, index, normalizeQuery(item.family) === chosen, blocked, text));
  });
  field.rebuilding = true;
  field.list.replaceChildren(...rows);
  if (focused !== null) {
    const match = [...field.list.querySelectorAll('button.result')].find((button) => button.dataset.family === focused);
    focusQuietly(field, match || field.input);
  }
  field.rebuilding = false;
  if (name === 'dest') scheduleSamples(items);
}

function renderSnippet() {
  const selection = state.selection;
  const text = selection && typeof selection.text === 'string' ? selection.text.replace(/\s+/g, ' ').trim() : '';
  els.snippet.hidden = !selection;
  if (!selection) return;
  els.snippetText.textContent = text ? (text.length > 180 ? `${text.slice(0, 177)}...` : text) : 'No text in the picked element';
  const parts = [];
  if (selection.family) parts.push(selection.family);
  if (selection.weight) parts.push(String(selection.weight));
  if (selection.style && selection.style !== 'normal') parts.push(String(selection.style));
  if (selection.size) parts.push(typeof selection.size === 'number' ? `${Math.round(selection.size * 10) / 10}px` : String(selection.size));
  if (selection.tag) parts.push(`in ${String(selection.tag).toLowerCase()}`);
  let meta = parts.join(', ');
  if (selection.confidence === 'estimated') meta += `${meta ? '. ' : ''}Font is estimated from how the text renders.`;
  els.snippetMeta.textContent = meta;
}

function renderEditor() {
  const blocked = busy.size > 0 || connecting;
  els.sourcePick.disabled = blocked;
  els.destPick.disabled = blocked;
  els.sourcePick.setAttribute('aria-pressed', String(state.picking === 'source'));
  els.destPick.setAttribute('aria-pressed', String(state.picking === 'destination'));

  renderSnippet();
  renderResults('source');
  renderResults('dest');
  setText(els.sourceError, errors.source);
  setText(els.destError, errors.dest);

  els.scope.disabled = blocked;
  els.scopeAll.checked = scopeDraft !== 'element';
  els.scopeElement.checked = scopeDraft === 'element';
  els.scopeElement.disabled = !state.selection && scopeDraft !== 'element';

  let count = '';
  if (state.source && !state.picking) {
    if (state.count === 0) count = `No text on this page uses ${state.source}.`;
    else count = `${state.active ? 'Affects' : 'Matches'} ${elementCount(state.count)}`;
  }
  setText(els.count, count);

  els.warnings.hidden = !state.warnings.length;
  if (els.warnings.dataset.signature !== state.warnings.join('\n')) {
    els.warnings.dataset.signature = state.warnings.join('\n');
    els.warnings.replaceChildren(...state.warnings.map((warning) => {
      const item = document.createElement('li');
      item.textContent = warning;
      return item;
    }));
  }

  els.apply.disabled = blocked || !state.active || state.applied;
  els.compare.disabled = blocked || !state.active;
  els.compare.setAttribute('aria-pressed', String(Boolean(state.compared)));
  els.undo.disabled = blocked || !(state.active || state.applied);
  setText(els.actionError, errors.action);
}

function render() {
  const view = currentView();
  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;
  const status = statusText();
  if (els.status.textContent !== status) els.status.textContent = status;

  const picking = state ? state.picking : null;
  els.picking.hidden = !picking;
  if (picking) {
    els.pickingText.textContent = picking === 'source'
      ? 'Click text on the page to choose the font to replace. Press Escape to cancel.'
      : 'Click text on the page to use its font as the replacement. Press Escape to cancel.';
    els.pickingCancel.disabled = busy.has('cancel');
  }

  if (view === 'error') {
    els.errorText.textContent = panelError;
    els.retry.disabled = connecting;
  } else if (view === 'empty') {
    els.emptyPick.disabled = busy.size > 0 || connecting || Boolean(picking);
    setText(els.emptyError, errors.source);
  } else if (view === 'editor') {
    renderEditor();
  }
}

// Commands

async function run(action, payload, area, options) {
  if (busy.has(action) || tabId === null) return null;
  busy.add(action);
  errors[area] = '';
  render();
  const response = await send(action, payload);
  if (response.stale) return null;
  busy.delete(action);
  if (response.ok) {
    if (response.state) applyState(response.state, options);
  } else {
    errors[area] = describeError(response.error);
  }
  render();
  return response;
}

function togglePick(mode) {
  if (!state || busy.size) return;
  const area = mode === 'source' ? 'source' : 'dest';
  if (state.picking === mode) run('cancel', {}, area);
  else run('pick', { mode }, area);
}

function cancelPick() {
  if (state && state.picking) run('cancel', {}, 'action');
}

async function chooseSource(item) {
  const response = await run('source', { family: item.family }, 'source');
  if (!response || !response.ok) return;
  resetField('source');
  if (fields.source.wrap.contains(document.activeElement)) focusQuietly(fields.source, fields.source.input);
  render();
}

async function previewDestination(destination, scope, area) {
  pendingFamily = destination.family;
  const response = await run('preview', { destination: { kind: destination.kind, family: destination.family }, scope }, area, { keepDest: true });
  pendingFamily = '';
  if (response && !response.ok && !navigator.onLine) {
    errors[area] = `You appear to be offline, so ${destination.family} could not be loaded. Your current fonts are unchanged.`;
  }
  return response;
}

async function chooseDest(item) {
  if (!state || !state.source) {
    errors.dest = 'Choose the font to replace first.';
    render();
    return;
  }
  const response = await previewDestination(item, scopeDraft, 'dest');
  if (response && response.ok) {
    scopeDirty = false;
    if (state) scopeDraft = state.scope;
    fields.dest.settled = true;
  }
  render();
}

function choose(name, item) {
  if (!item || !state || busy.size) return;
  if (name === 'source') chooseSource(item);
  else chooseDest(item);
}

async function changeScope(value) {
  scopeDraft = value === 'element' ? 'element' : 'all';
  scopeDirty = true;
  if (!state || !state.destination) {
    render();
    return;
  }
  const epoch = tabEpoch;
  const response = await previewDestination(state.destination, scopeDraft, 'action');
  if (epoch !== tabEpoch) return;
  scopeDirty = false;
  if (state) scopeDraft = state.scope;
  if (!response) errors.action = '';
  render();
}

// Field interaction

function focusQuietly(field, node) {
  field.quiet = true;
  node.focus();
  field.quiet = false;
}

function flushField(field) {
  clearTimeout(field.timer);
  render();
}

function openField(field) {
  if (field.open) return;
  field.open = true;
  render();
}

function collapseField(field) {
  if (field.wrap.contains(document.activeElement) && document.hasFocus()) return;
  if (field.dirty && !field.settled) return;
  resetField(field.name);
  render();
}

function onFieldKeydown(field, event) {
  const onInput = event.target === field.input;
  const onResult = field.list.contains(event.target);
  if (event.key === 'Escape') {
    if (!field.open && !field.dirty) return;
    event.preventDefault();
    resetField(field.name);
    errors[field.name] = '';
    focusQuietly(field, field.input);
    render();
    return;
  }
  if (!onInput && !onResult) return;
  if (onInput && event.key === 'Enter') {
    event.preventDefault();
    field.open = true;
    flushField(field);
    choose(field.name, field.items[0]);
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  if (onInput && event.key !== 'ArrowDown') return;
  event.preventDefault();
  if (onInput) {
    field.open = true;
    flushField(field);
  }
  const buttons = [...field.list.querySelectorAll('button.result')];
  if (!buttons.length) return;
  const index = buttons.indexOf(document.activeElement);
  let target = null;
  if (onInput || event.key === 'Home') target = buttons[0];
  else if (event.key === 'End') target = buttons[buttons.length - 1];
  else if (event.key === 'ArrowDown') target = buttons[Math.min(index + 1, buttons.length - 1)];
  else target = index <= 0 ? field.input : buttons[index - 1];
  focusQuietly(field, target);
}

function wireField(field) {
  field.input.addEventListener('focus', () => {
    if (field.quiet) return;
    if (!field.dirty) field.input.select();
    openField(field);
  });
  field.input.addEventListener('click', () => openField(field));
  field.input.addEventListener('input', () => {
    field.dirty = true;
    field.settled = false;
    field.open = true;
    errors[field.name] = '';
    clearTimeout(field.timer);
    field.timer = setTimeout(render, SEARCH_DEBOUNCE_MS);
  });
  field.wrap.addEventListener('keydown', (event) => onFieldKeydown(field, event));
  field.wrap.addEventListener('focusout', (event) => {
    if (field.rebuilding || field.wrap.contains(event.relatedTarget)) return;
    // Collapsing moves the controls below, so wait until a click in progress has landed.
    if (pointerDown) deferred.push(field);
    else setTimeout(() => collapseField(field), 0);
  });
  field.list.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button.result') : null;
    if (!button || !field.list.contains(button)) return;
    choose(field.name, field.items[Number(button.dataset.index)]);
  });
}

function releasePointer() {
  pointerDown = false;
  if (!deferred.length) return;
  const waiting = deferred.splice(0);
  setTimeout(() => waiting.forEach(collapseField), 80);
}

// Wiring

wireField(fields.source);
wireField(fields.dest);

document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', releasePointer, true);
document.addEventListener('pointercancel', releasePointer, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (state && state.picking) {
    event.preventDefault();
    cancelPick();
  }
});

els.retry.addEventListener('click', () => {
  if (!connecting) connect('retry');
});
els.emptyPick.addEventListener('click', () => togglePick('source'));
els.emptyManual.addEventListener('click', () => {
  manual = true;
  render();
  fields.source.input.focus();
});
els.sourcePick.addEventListener('click', () => togglePick('source'));
els.destPick.addEventListener('click', () => togglePick('destination'));
els.pickingCancel.addEventListener('click', cancelPick);
els.category.addEventListener('change', () => {
  fields.dest.open = true;
  render();
});
els.catalogRetry.addEventListener('click', () => {
  focusQuietly(fields.dest, fields.dest.input);
  loadCatalog();
});
els.scopeAll.addEventListener('change', () => changeScope('all'));
els.scopeElement.addEventListener('change', () => changeScope('element'));
els.apply.addEventListener('click', () => run('apply', {}, 'action'));
els.undo.addEventListener('click', () => run('undo', {}, 'action'));
els.compare.addEventListener('click', () => {
  if (state) run('compare', { enabled: !state.compared }, 'action');
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'STATE_CHANGED' || tabId === null || message.tabId !== tabId || !message.state) return;
  applyState(message.state);
  render();
});

chrome.tabs.onActivated.addListener(() => scheduleConnect('activated'));
chrome.tabs.onUpdated.addListener((id, changeInfo) => {
  if (id === tabId && changeInfo.status === 'complete') scheduleConnect('updated');
});

render();
connect('load');
