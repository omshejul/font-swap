import { chromium } from 'playwright';
import { mkdtemp, cp, readFile, writeFile, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const temp = await mkdtemp(path.join(tmpdir(), 'swapfont-tag-inheritance-'));
const extension = path.join(temp, 'extension');
await cp('extension', extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json')));
manifest.host_permissions.push('http://127.0.0.1/*');
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
const fixture = `<!doctype html><style>body{font-family:Arial,sans-serif;padding:30px}</style>
<div id="wrapper">Container text<h1 id="heading">Heading <span id="inline">inline text</span></h1>
<p id="paragraph">Paragraph <em id="emphasis">formatted text</em></p>
<p id="shadow-host">Shadow paragraph</p><span id="different" style="font-family:serif">Different family</span>
<span id="icon">&#xe900;</span></div>
<div id="empty-wrapper"><h2 id="nested-only"><span id="nested-text">Nested heading only</span></h2></div>
<p style="font-family:monospace">Destination font</p>`;
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html'); response.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  let executablePath = process.env.CHROME_PATH;
  const localChrome = '/Users/omshejul/.cache/puppeteer/chrome/mac_arm-152.0.7977.75/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  if (!executablePath) try { await access(localChrome); executablePath = localChrome; } catch {}
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    executablePath, channel: executablePath ? undefined : 'chromium', headless: process.env.HEADED !== '1',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => {
    const text = document.createElement('span'); text.id = 'shadow-text'; text.textContent = 'Inherited shadow text';
    document.querySelector('#shadow-host').attachShadow({ mode: 'open' }).append(text);
  });
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
  const ok = async (action, payload = {}) => {
    const result = await panel.evaluate(message => chrome.runtime.sendMessage(message), { type: 'PANEL', action, tabId, ...payload });
    assert.equal(result.ok, true, result.error); return result;
  };
  const font = selector => page.locator(selector).evaluate(element => getComputedStyle(element).fontFamily);
  const original = await font('#heading');
  const unchanged = ['#heading', '#inline', '#paragraph', '#emphasis', '#shadow-host', '#shadow-text', '#nested-only', '#nested-text', '#icon'];
  await ok('connect'); await ok('pick', { mode: 'source' }); await page.locator('#heading').click();
  const { state } = await ok('preview', { destination: { kind: 'page', family: 'monospace' }, scope: 'all' });
  const target = { ruleId: state.rules[0].id, frameId: 0 };
  await ok('tags', { ...target, tags: ['div'] });
  console.log('Div only:', JSON.stringify({ container: await font('#wrapper'), heading: await font('#heading'), original }));
  assert.match(await font('#wrapper'), /^monospace/);
  for (const selector of unchanged) assert.equal(await font(selector), original, `${selector} must not inherit a div-only swap`);
  assert.equal(await font('#different'), 'serif');
  for (let i = 0; i < 3; i++) {
    await ok('tags', { ...target, tags: [] });
    assert.equal(await font('#wrapper'), original);
    await ok('tags', { ...target, tags: ['div'] });
    assert.equal(await font('#heading'), original);
  }
  await ok('tags', { ...target, tags: ['h1', 'p'] });
  for (const selector of ['#heading', '#inline', '#paragraph', '#emphasis', '#shadow-host', '#shadow-text']) assert.match(await font(selector), /^monospace/);
  assert.equal(await font('#wrapper'), original);
  await ok('tags', { ...target, tags: ['div', 'span'] });
  assert.equal(await font('#heading'), original);
  assert.match(await font('#inline'), /^monospace/);
  await ok('tags', { ...target, tags: ['div'] });
  await page.evaluate(() => {
    const heading = document.createElement('h1'); heading.id = 'dynamic'; heading.textContent = 'New heading';
    document.querySelector('#wrapper').append(heading);
  });
  await page.waitForTimeout(350);
  assert.equal(await font('#dynamic'), original, 'New unchecked headings must remain unchanged');
  await ok('pick', { mode: 'source' }); await page.locator('#heading').click();
  const independent = await ok('preview', { destination: { kind: 'page', family: 'serif' }, scope: 'all' });
  assert.equal(independent.state.rules.length, 2);
  await ok('tags', { ...target, tags: [] });
  assert.match(await font('#heading'), /^serif/);
  await ok('tags', { ...target, tags: ['div'] });
  assert.match(await font('#heading'), /^serif/, 'Inheritance guards must not overwrite another selected rule');
  await ok('compare', { enabled: true });
  for (const selector of ['#wrapper', '#heading', '#inline', '#shadow-text']) assert.equal(await font(selector), original);
  await ok('compare', { enabled: false });
  assert.match(await font('#wrapper'), /^monospace/);
  assert.match(await font('#heading'), /^serif/);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/tag-inheritance.png' });
  await ok('undo');
  for (const selector of ['#wrapper', ...unchanged, '#dynamic']) assert.equal(await font(selector), original);
  assert.equal(await page.locator('#shadow-text').evaluate(element => element.style.fontFamily), '');
  console.log('PASS tag boundaries, inheritance guards, repeated toggles, inline/shadow text, new headings, independent rules, Compare and Undo');
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
