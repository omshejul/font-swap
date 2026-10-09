import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const bundled = JSON.parse(await readFile(new URL('../extension/catalog.json', import.meta.url), 'utf8'));
const endpoint = 'https://omshejul.com/api/swapfont/catalog';
const source = 'https://www.googleapis.com/webfonts/v1/webfonts';
const day = 24 * 60 * 60 * 1000;
const week = 7 * day;
const hour = 60 * 60 * 1000;
const start = Date.UTC(2026, 9, 9, 12);
const cacheKey = 'googleFontCatalog';
const fetchedKey = 'googleFontCatalogFetchedAt';
const attemptedKey = 'googleFontCatalogLastAttemptAt';
let imports = 0;

function payload() {
  return {...structuredClone(bundled), source};
}
function downloaded() {
  const data = payload();
  data.families.push({family:'New Catalog Family', category:'sans-serif', variants:['regular','700italic'], popularity:0});
  return data;
}
function json(data, options) {
  return new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}, ...options});
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
async function freshModule() {
  return import(new URL(`../extension/fonts.js?catalog-test=${++imports}`, import.meta.url));
}
async function harness(t, {stored = {}, now = start, respond} = {}) {
  const previous = {
    chrome: Object.getOwnPropertyDescriptor(globalThis, 'chrome'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
    caches: Object.getOwnPropertyDescriptor(globalThis, 'caches'),
    timeout: Object.getOwnPropertyDescriptor(AbortSignal, 'timeout'),
    now: Date.now,
  };
  const env = {
    store:structuredClone(stored), writes:[], requests:[], localRequests:[], timeouts:[], now,
    respond:respond || (() => json(downloaded())), otherFetch:null, failWrite:null,
  };
  Date.now = () => env.now;
  Object.defineProperty(AbortSignal, 'timeout', {configurable:true, writable:true, value:ms => {
    env.timeouts.push(ms);
    return new AbortController().signal;
  }});
  globalThis.chrome = {
    runtime:{getURL:path => `chrome-extension://catalog-test/${path}`},
    storage:{local:{
      async get(keys) {
        if (env.failRead) throw new Error('Storage unavailable');
        if (keys === null || keys === undefined) return structuredClone(env.store);
        if (typeof keys === 'string') keys = [keys];
        if (Array.isArray(keys)) return structuredClone(Object.fromEntries(keys.filter(key => key in env.store).map(key => [key, env.store[key]])));
        return structuredClone({...keys, ...Object.fromEntries(Object.keys(keys).filter(key => key in env.store).map(key => [key, env.store[key]]))});
      },
      async set(values) {
        if (env.failWrite?.(values)) throw new Error('Storage write failed');
        env.writes.push(structuredClone(values));
        Object.assign(env.store, structuredClone(values));
      },
      async remove() { throw new Error('Catalog refresh must not remove stored settings'); },
      async clear() { throw new Error('Catalog refresh must not clear stored settings'); },
    }},
  };
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url === chrome.runtime.getURL('catalog.json')) {
      env.localRequests.push(url);
      if (env.failBundle) throw new Error('Bundled catalog unavailable');
      return json(bundled);
    }
    if (url === endpoint) {
      env.requests.push({url, options});
      return env.respond(url, options);
    }
    if (env.otherFetch) return env.otherFetch(url, options);
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(() => {
    Date.now = previous.now;
    for (const key of ['chrome', 'fetch', 'caches']) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
    Object.defineProperty(AbortSignal, 'timeout', previous.timeout);
  });
  env.fonts = await freshModule();
  env.restart = async () => { env.fonts = await freshModule(); return env.fonts; };
  return env;
}
async function requestStarted(env) {
  for (let turn = 0; turn < 20 && !env.requests.length; turn++) await new Promise(setImmediate);
  assert.equal(env.requests.length, 1, 'background request should start');
}

test('first opening uses the bundle while a background download remains pending', async t => {
  const response = deferred();
  const env = await harness(t, {respond:() => response.promise});
  assert.deepEqual(await env.fonts.getCatalog(), bundled.families);
  assert.equal(env.requests.length, 0);
  assert.equal(env.writes.length, 0);
  const refresh = env.fonts.refreshCatalog();
  let settled = false;
  refresh.then(() => { settled = true; });
  await requestStarted(env);
  assert.deepEqual(await env.fonts.getCatalog(), bundled.families);
  assert.equal(settled, false);
  env.now += 60 * 1000;
  response.resolve(json(downloaded()));
  assert.deepEqual(await refresh, downloaded().families);
  assert.deepEqual(await env.fonts.getCatalog(), downloaded().families);
  assert.equal(env.store[fetchedKey], env.now);
  assert.equal(env.store[attemptedKey], start);
});

test('a fresh downloaded catalog supplies metadata without a backend request', async t => {
  const cached = downloaded();
  const env = await harness(t, {stored:{[cacheKey]:cached, [fetchedKey]:start - week + 1}});
  assert.deepEqual(await env.fonts.getCatalog(), cached.families);
  assert.equal(await env.fonts.refreshCatalog(), null);
  assert.equal(env.requests.length, 0);
  assert.equal(env.writes.length, 0);
});

test('ordinary catalog reads never request a refresh even when the cache is stale', async t => {
  const cached = payload();
  const env = await harness(t, {stored:{[cacheKey]:cached, [fetchedKey]:start - week}});
  for (let read = 0; read < 10; read++) assert.deepEqual(await env.fonts.getCatalog(), cached.families);
  assert.equal(env.requests.length, 0);
  assert.equal(env.writes.length, 0);
});

test('daily openings and worker restarts preserve the successful refresh time until the weekly boundary', async t => {
  const env = await harness(t);
  await env.fonts.getCatalog();
  await env.fonts.refreshCatalog();
  assert.equal(env.store[fetchedKey], start);
  for (let elapsed = day; elapsed < week; elapsed += day) {
    env.now = start + elapsed;
    await env.restart();
    assert.deepEqual(await env.fonts.getCatalog(), downloaded().families);
    assert.equal(await env.fonts.refreshCatalog(), null);
    assert.equal(env.store[fetchedKey], start);
    assert.equal(env.requests.length, 1);
  }
  env.now = start + week - 1;
  assert.equal(await env.fonts.refreshCatalog(), null);
  env.now++;
  assert.deepEqual(await env.fonts.refreshCatalog(), downloaded().families);
  assert.equal(env.requests.length, 2);
  assert.equal(env.store[fetchedKey], start + week);
});

test('concurrent refresh calls share one promise and persist the attempt before requesting', async t => {
  const response = deferred();
  const env = await harness(t, {respond:() => {
    assert.equal(env.store[attemptedKey], start);
    assert.equal(env.store[fetchedKey], undefined);
    return response.promise;
  }});
  const refresh = env.fonts.refreshCatalog();
  const others = Array.from({length:12}, () => env.fonts.refreshCatalog());
  for (const other of others) assert.equal(other, refresh);
  await requestStarted(env);
  assert.equal(env.requests.length, 1);
  const {url, options} = env.requests[0];
  assert.equal(url, endpoint);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(env.timeouts, [20000]);
  assert.ok(!options.body);
  response.resolve(json(downloaded()));
  await Promise.all([refresh, ...others]);
  assert.equal(env.requests.length, 1);
});

test('a success stores catalog and successful timestamp together without changing saved site settings', async t => {
  const settings = {'site:https://example.com':{rules:[{source:'Arial', destination:{kind:'google', family:'Inter'}}]}, panelMode:'side'};
  const env = await harness(t, {stored:settings});
  assert.deepEqual(await env.fonts.refreshCatalog(), downloaded().families);
  assert.equal(env.store[fetchedKey], start);
  assert.deepEqual(env.store[cacheKey], downloaded());
  const successfulWrite = env.writes.find(values => cacheKey in values);
  assert.deepEqual(successfulWrite[cacheKey], downloaded());
  assert.equal(successfulWrite[fetchedKey], start);
  assert.ok(env.writes.filter(values => fetchedKey in values).every(values => cacheKey in values));
  for (const [key, value] of Object.entries(settings)) assert.deepEqual(env.store[key], value);
  for (const values of env.writes) assert.ok(Object.keys(values).every(key => [cacheKey, fetchedKey, attemptedKey].includes(key)));
  await env.restart();
  assert.deepEqual(await env.fonts.getCatalog(), downloaded().families);
  assert.equal(await env.fonts.refreshCatalog(), null);
  assert.equal(env.requests.length, 1);
});

test('offline use returns the bundle and throttles a failed refresh', async t => {
  const env = await harness(t, {respond:() => { throw new TypeError('Failed to fetch'); }});
  assert.deepEqual(await env.fonts.getCatalog(), bundled.families);
  assert.equal(await env.fonts.refreshCatalog(), null);
  assert.deepEqual(await env.fonts.getCatalog(), bundled.families);
  assert.equal(env.store[cacheKey], undefined);
  assert.equal(env.store[fetchedKey], undefined);
  assert.equal(env.store[attemptedKey], start);
  assert.equal(await env.fonts.refreshCatalog(), null);
  assert.equal(env.requests.length, 1);
});

test('HTTP errors, timeout, offline failure and malformed JSON preserve the usable catalog and timestamp', async t => {
  const failures = {
    'HTTP 429':() => json({error:'limited'}, {status:429}),
    'HTTP 503':() => json({error:'unavailable'}, {status:503}),
    timeout:() => { throw new DOMException('Timed out', 'TimeoutError'); },
    offline:() => { throw new TypeError('Failed to fetch'); },
    'malformed JSON':() => new Response('{"families":'),
  };
  for (const [name, respond] of Object.entries(failures)) await t.test(name, async t => {
    const cached = payload();
    const oldTime = start - week;
    const env = await harness(t, {stored:{[cacheKey]:cached, [fetchedKey]:oldTime}, respond});
    assert.deepEqual(await env.fonts.getCatalog(), cached.families);
    assert.equal(await env.fonts.refreshCatalog(), null);
    assert.deepEqual(await env.fonts.getCatalog(), cached.families);
    assert.deepEqual(env.store[cacheKey], cached);
    assert.equal(env.store[fetchedKey], oldTime);
    assert.equal(env.store[attemptedKey], start);
    assert.ok(!env.writes.some(values => cacheKey in values || fetchedKey in values));
  });
});

test('a failed attempt survives worker restart and retries at the exact one-hour boundary', async t => {
  const env = await harness(t, {respond:() => { throw new TypeError('Offline'); }});
  assert.equal(await env.fonts.refreshCatalog(), null);
  await env.restart();
  env.now = start + hour - 1;
  assert.equal(await env.fonts.refreshCatalog(), null);
  assert.equal(env.requests.length, 1);
  env.now++;
  env.respond = () => json(downloaded());
  assert.deepEqual(await env.fonts.refreshCatalog(), downloaded().families);
  assert.equal(env.requests.length, 2);
  assert.equal(env.store[fetchedKey], start + hour);
});

test('an interrupted persisted attempt enforces cooldown after worker startup', async t => {
  const env = await harness(t, {stored:{[attemptedKey]:start - hour + 1}});
  assert.deepEqual(await env.fonts.getCatalog(), bundled.families);
  assert.equal(await env.fonts.refreshCatalog(), null);
  assert.equal(env.requests.length, 0);
  env.now++;
  assert.deepEqual(await env.fonts.refreshCatalog(), downloaded().families);
  assert.equal(env.requests.length, 1);
});

test('storage failures cannot advance the successful refresh timestamp or erase cached metadata', async t => {
  for (const stage of ['attempt', 'catalog']) await t.test(stage, async t => {
    const cached = payload();
    const env = await harness(t, {stored:{[cacheKey]:cached, [fetchedKey]:start - week}});
    assert.deepEqual(await env.fonts.getCatalog(), cached.families);
    env.failWrite = values => stage === 'attempt' ? attemptedKey in values : cacheKey in values;
    assert.equal(await env.fonts.refreshCatalog(), null);
    assert.deepEqual(await env.fonts.getCatalog(), cached.families);
    assert.deepEqual(env.store[cacheKey], cached);
    assert.equal(env.store[fetchedKey], start - week);
    assert.equal(env.requests.length, stage === 'attempt' ? 0 : 1);
    if (stage === 'catalog') {
      await env.restart();
      assert.deepEqual(await env.fonts.getCatalog(), cached.families);
      assert.equal(await env.fonts.refreshCatalog(), null);
      assert.equal(env.requests.length, 1);
    }
  });
});

test('unavailable local storage still allows offline bundled metadata', async t => {
  const env = await harness(t);
  env.failRead = true;
  assert.deepEqual(await env.fonts.getCatalog(), bundled.families);
  assert.equal(await env.fonts.refreshCatalog(), null);
  assert.equal(env.requests.length, 0);
});

test('missing, corrupt and future successful or attempt timestamps never suppress an eligible refresh', async t => {
  const invalid = [undefined, null, 'tomorrow', String(start), NaN, Infinity, -1, 0, start + day];
  for (const key of [fetchedKey, attemptedKey]) for (const value of invalid) await t.test(`${key}: ${String(value)}`, async t => {
    const env = await harness(t, {stored:{[cacheKey]:payload(), [fetchedKey]:start - week, [attemptedKey]:start - hour, [key]:value}});
    assert.deepEqual(await env.fonts.refreshCatalog(), downloaded().families);
    assert.equal(env.requests.length, 1);
  });
});

const malformed = [
  ['null payload', () => null],
  ['wrong source', data => { data.source = 'https://example.com/catalog'; }],
  ['missing source', data => { delete data.source; }],
  ['invalid date', data => { data.updated = '2026-02-29'; }],
  ['invalid day of month', data => { data.updated = '2026-04-31'; }],
  ['non-date update', data => { data.updated = '2026-10-09T00:00:00Z'; }],
  ['missing date', data => { delete data.updated; }],
  ['missing families', data => { delete data.families; }],
  ['families object', data => { data.families = {}; }],
  ['empty families', data => { data.families = []; }],
  ['truncated families', data => { data.families.length = Math.ceil(bundled.families.length * 0.9) - 1; }],
  ['too many families', data => { data.families = Array.from({length:10001}, (_, i) => ({family:`Family ${i}`, category:'serif', variants:['regular'], popularity:i})); }],
  ['null family entry', data => { data.families[0] = null; }],
  ['missing name', data => { delete data.families[0].family; }],
  ['empty name', data => { data.families[0].family = ''; }],
  ['blank name', data => { data.families[0].family = '   '; }],
  ['non-string name', data => { data.families[0].family = 42; }],
  ['control in name', data => { data.families[0].family = 'Font\nName'; }],
  ['DEL in name', data => { data.families[0].family = 'Font\u007fName'; }],
  ['long name', data => { data.families[0].family = 'x'.repeat(201); }],
  ['duplicate name', data => { data.families[1].family = data.families[0].family; }],
  ['invalid category', data => { data.families[0].category = 'system-ui'; }],
  ['missing category', data => { delete data.families[0].category; }],
  ['empty variants', data => { data.families[0].variants = []; }],
  ['non-array variants', data => { data.families[0].variants = 'regular'; }],
  ['non-string variant', data => { data.families[0].variants = [400]; }],
  ['unknown variant', data => { data.families[0].variants = ['bold']; }],
  ['zero weight', data => { data.families[0].variants = ['0']; }],
  ['out-of-range weight', data => { data.families[0].variants = ['1001italic']; }],
  ['negative popularity', data => { data.families[0].popularity = -1; }],
  ['fractional popularity', data => { data.families[0].popularity = 0.5; }],
  ['string popularity', data => { data.families[0].popularity = '1'; }],
  ['missing popularity', data => { delete data.families[0].popularity; }],
  ['oversize UTF-8 payload', data => { data.padding = 'é'.repeat(1024 * 1024); }],
];

test('invalid remote metadata never replaces a valid cache', async t => {
  for (const [name, mutate] of malformed) await t.test(name, async t => {
    const cached = payload();
    const data = payload();
    const returned = mutate(data);
    const env = await harness(t, {stored:{[cacheKey]:cached, [fetchedKey]:start - week}, respond:() => json(returned === null ? null : data)});
    assert.equal(await env.fonts.refreshCatalog(), null);
    assert.deepEqual(await env.fonts.getCatalog(), cached.families);
    assert.deepEqual(env.store[cacheKey], cached);
    assert.equal(env.store[fetchedKey], start - week);
  });
});

test('corrupt downloaded metadata falls back to the bundled catalog without a backend request', async t => {
  for (const [name, mutate] of malformed) await t.test(name, async t => {
    const data = payload();
    const returned = mutate(data);
    const env = await harness(t, {stored:{[cacheKey]:returned === null ? null : data, [fetchedKey]:start}});
    assert.deepEqual(await env.fonts.getCatalog(), bundled.families);
    assert.equal(env.requests.length, 0);
    assert.equal(env.writes.length, 0);
  });
});

test('an invalid cached payload triggers refresh despite a recent successful timestamp, while attempt cooldown still applies', async t => {
  for (const cooldown of [false, true]) await t.test(cooldown ? 'recent attempt' : 'eligible attempt', async t => {
    const env = await harness(t, {stored:{[cacheKey]:{source, updated:'2026-10-09', families:[]}, [fetchedKey]:start, ...(cooldown ? {[attemptedKey]:start} : {})}});
    assert.deepEqual(await env.fonts.getCatalog(), bundled.families);
    assert.deepEqual(await env.fonts.refreshCatalog(), cooldown ? null : downloaded().families);
    assert.equal(env.requests.length, cooldown ? 0 : 1);
  });
});

test('truncation validation uses the newer downloaded family count as well as the bundled count', async t => {
  const cached = payload();
  const extra = bundled.families.map((_, i) => ({family:`Additional Family ${i}`, category:'serif', variants:['regular'], popularity:i}));
  cached.families.push(...extra);
  const env = await harness(t, {stored:{[cacheKey]:cached, [fetchedKey]:start - week}});
  assert.equal(await env.fonts.refreshCatalog(), null);
  assert.deepEqual(env.store[cacheKey], cached);
  assert.equal(env.store[fetchedKey], start - week);
  env.now += hour;
  const accepted = structuredClone(cached);
  accepted.families.length = Math.ceil(cached.families.length * 0.9);
  env.respond = () => json(accepted);
  assert.deepEqual(await env.fonts.refreshCatalog(), accepted.families);
  assert.deepEqual(env.store[cacheKey], accepted);
});

test('valid boundary metadata preserves actual names, categories, variants and popularity', async t => {
  const data = payload();
  data.updated = '2024-02-29';
  data.families.length = Math.ceil(bundled.families.length * 0.9);
  data.families[0] = {family:'😀'.repeat(100), category:'display', variants:['regular','italic','1','1000','1italic','1000italic'], popularity:0};
  const env = await harness(t, {respond:() => json(data)});
  assert.deepEqual(await env.fonts.refreshCatalog(), data.families);
  assert.deepEqual(env.store[cacheKey], data);
  assert.deepEqual(await env.fonts.getCatalog(), data.families);
});

test('the maximum allowed family count is inclusive', async t => {
  const data = payload();
  const additional = 10000 - data.families.length;
  data.families.push(...Array.from({length:additional}, (_, i) => ({family:`Boundary Family ${i}`, category:'serif', variants:['regular'], popularity:i})));
  const env = await harness(t, {respond:() => json(data)});
  assert.deepEqual(await env.fonts.refreshCatalog(), data.families);
  assert.deepEqual(env.store[cacheKey], data);
});

test('remembered font restoration can use bundled metadata omitted by a refreshed catalog', async t => {
  const omitted = bundled.families.find(item => item.family === 'Inter');
  assert.ok(omitted, 'bundled fixture should contain Inter');
  const data = payload();
  data.families = data.families.filter(item => item.family !== omitted.family);
  const env = await harness(t, {stored:{[cacheKey]:data, [fetchedKey]:start - week}});
  const fontRequests = [];
  const savedResponses = new Map();
  globalThis.caches = {open:async () => ({
    match:async url => savedResponses.get(url)?.clone(),
    put:async (url, response) => { savedResponses.set(url, response.clone()); },
    keys:async () => [...savedResponses.keys()],
    delete:async url => savedResponses.delete(url),
  })};
  env.otherFetch = url => {
    fontRequests.push(url);
    if (new URL(url).origin === 'https://fonts.googleapis.com') return new Response('@font-face {font-weight:400;font-style:normal;src:url(https://fonts.gstatic.com/test-inter.woff2);}');
    if (url === 'https://fonts.gstatic.com/test-inter.woff2') return new Response(new Uint8Array([1,2,3]));
    throw new Error(`Unexpected font request: ${url}`);
  };
  const result = await env.fonts.loadGoogleFont(omitted.family);
  assert.equal(result.family, omitted.family);
  assert.equal(result.faces.length, 1);
  assert.equal(result.binaries['https://fonts.gstatic.com/test-inter.woff2'], 'AQID');
  assert.equal(fontRequests.length, 2);
  assert.equal(env.requests.length, 0);
  assert.equal(env.writes.length, 0);
});
