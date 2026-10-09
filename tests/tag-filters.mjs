import assert from 'node:assert/strict';

export async function testTagFilters(page,ok,fixtureURL,passed) {
 await page.goto(fixtureURL);await ok('connect');
 await page.evaluate(()=>{
  const heading=document.createElement('h1');heading.id='tag-heading';
  heading.innerHTML='<span id="tag-nested">Nested heading text</span><span id="tag-fallback" style="font-family:Missing,Arial,sans-serif">Different primary family</span>';
  document.body.append(heading);
 });
 await ok('pick',{mode:'source'});await page.locator('#heading').click();
 let response=await ok('preview',{destination:{kind:'page',family:'monospace'},scope:'all'});
 const rule=response.state.rules.find(rule=>rule.source==='Arial'),target={ruleId:rule.id,frameId:rule.frameId};
 const font=selector=>page.locator(selector).evaluate(element=>getComputedStyle(element).fontFamily);
 response=await ok('tag-options',target);
 assert.equal(response.tags.find(choice=>choice.tag==='h1').count,2);
 assert(!response.tags.some(choice=>['html','body','swapfont-panel','svg'].includes(choice.tag)));
 await ok('tags',{...target,tags:['h1']});
 assert.match(await font('#heading'),/^monospace/);assert.match(await font('#tag-nested'),/^monospace/);
 assert.match(await font('#body'),/^Arial/);assert.match(await font('#tag-fallback'),/^Missing/);
 assert.match(await font('#inherited-icon'),/^Arial/);
 passed('tag filtering includes nested heading text while respecting original family and icon protection');
 await page.evaluate(()=>window.addNew());await page.waitForTimeout(350);assert.match(await font('#new'),/^Arial/);
 await ok('source',{family:'monospace'});response=await ok('preview',{destination:{kind:'page',family:'Arial'},scope:'all'});
 await ok('tags',{...target,tags:['h1','p']});
 assert.equal((await ok('state')).state.source,'monospace');assert.match(await font('#generic'),/^Arial/);
 assert.match(await font('#new'),/^monospace/);
 const shadow=await page.locator('#open').evaluate(e=>getComputedStyle(e.shadowRoot.firstChild).fontFamily);assert.match(shadow,/^Arial/);
 await page.evaluate(()=>{
  const host=document.querySelector('#open'),heading=document.createElement('h1');heading.id='tag-shadow-heading';
  heading.innerHTML='<span id="tag-shadow-nested">Shadow heading</span>';host.shadowRoot.append(heading);
 });
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#open').shadowRoot.querySelector('#tag-shadow-nested')).fontFamily.startsWith('monospace'));
 passed('each swap retains its own tags and new matching text, including nested shadow text, updates automatically');
 await ok('tags',{...target,tags:[]});assert.match(await font('#heading'),/^Arial/);assert.match(await font('#body'),/^Arial/);
 assert.match(await font('#generic'),/^Arial/);assert.deepEqual((await ok('state')).state.rules.find(r=>r.id===rule.id).tags,[]);
 await ok('tags',{...target,tags:['p']});await ok('select',target);
 response=await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'all'});
 assert.deepEqual(response.state.rules.find(r=>r.id===rule.id).tags,['p']);
 assert.match(await font('#body'),/FontSwap_/);assert.doesNotMatch(await font('#heading'),/FontSwap_/);
 await ok('tags',{...target,tags:null});assert.match(await font('#heading'),/FontSwap_/);
 await ok('undo');assert.match(await font('#heading'),/^Arial/);assert.match(await font('#generic'),/^monospace/);
 passed('empty tags pause one swap; changing its font keeps the scope, All tags restores full coverage, and Undo restores originals');
 await ok('pick',{mode:'source'});await page.locator('#heading').click();
 response=await ok('preview',{destination:{kind:'page',family:'monospace'},scope:'all'});
 const headingRule=response.state.rules.find(rule=>rule.source==='Arial');
 await ok('tags',{ruleId:headingRule.id,frameId:0,tags:['h1']});
 await ok('pick',{mode:'source'});await page.locator('#body').click();
 response=await ok('state');assert.equal(response.state.selectedRuleId,'');assert.equal(response.state.destination,null);assert.deepEqual(response.state.tags,['p']);
 response=await ok('preview',{destination:{kind:'google',family:'Inter'},scope:'all'});
 const paragraphRule=response.state.rules.find(rule=>rule.id!==headingRule.id && rule.source==='Arial');
 assert.equal(response.state.rules.filter(rule=>rule.source==='Arial').length,2);assert.deepEqual(paragraphRule.tags,['p']);
 const paragraphFont=await font('#body');assert.match(paragraphFont,/FontSwap_/);assert.match(await font('#heading'),/^monospace/);
 await ok('pick',{mode:'source'});await page.locator('#heading').click();
 assert.equal((await ok('state')).state.selectedRuleId,headingRule.id);
 response=await ok('preview',{destination:{kind:'google',family:'Lora'},scope:'all'});
 assert.equal(response.state.rules.filter(rule=>rule.source==='Arial').length,2);assert.equal(await font('#body'),paragraphFont);
 assert.match(await font('#heading'),/FontSwap_/);assert.notEqual(await font('#heading'),paragraphFont);
 await ok('remove',{ruleId:headingRule.id,frameId:0});assert.match(await font('#heading'),/^Arial/);assert.equal(await font('#body'),paragraphFont);
 await ok('undo');assert.match(await font('#body'),/^Arial/);
 passed('one source font supports independent heading and paragraph swaps; picking, editing and removing one preserves the other');
 await page.goto(fixtureURL);await ok('connect');
}

export async function testNativeTagFilter(panel,page,passed) {
 await panel.click('.pair-filter');await panel.wait("document.getElementById('tag-filter').matches(':popover-open') && !document.getElementById('tag-search').disabled");
 assert.equal(await panel.evaluate("document.getElementById('all-tags').getAttribute('aria-pressed')"),'true');
 assert.equal(await panel.evaluate("document.getElementById('all-tags').textContent"),'Clear');
 assert.equal(await panel.evaluate("document.getElementById('tag-filter').textContent.includes('matching elements') || document.getElementById('tag-filter').textContent.includes('Updates live')"),false);
 await panel.click('.tag-option input[data-tag="h1"]');
 await page.waitForFunction(()=>!getComputedStyle(document.querySelector('#heading')).fontFamily.includes('FontSwap_'));
 assert.match(await page.locator('#body').evaluate(e=>getComputedStyle(e).fontFamily),/FontSwap_/);
 assert.equal(await panel.evaluate("document.activeElement?.dataset.tag"),'h1');
 await panel.click('#tag-search');await panel.command('Input.insertText',{text:'heading'});
 await panel.wait("document.querySelectorAll('.tag-option').length===1");
 await panel.click('.tag-option input[data-tag="h1"]');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#heading')).fontFamily.includes('FontSwap_'));
 await panel.wait("document.getElementById('all-tags').textContent==='Clear'");
 await panel.click('#all-tags');await panel.wait("document.getElementById('all-tags').textContent==='All tags' && !document.querySelector('.tag-option input:checked')");
 await page.waitForFunction(()=>!getComputedStyle(document.querySelector('#body')).fontFamily.includes('FontSwap_'));
 await panel.click('#all-tags');await panel.wait("document.getElementById('all-tags').getAttribute('aria-pressed')==='true' && !document.querySelector('.tag-summary')");
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#body')).fontFamily.includes('FontSwap_'));
 passed('side-panel bulk action clears all tags during search and restores all with the next click');
 await panel.evaluate("(()=>{const search=document.getElementById('tag-search');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));})()");
 for (const width of [240,320]) {
  await panel.command('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  await panel.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
  assert.equal(await panel.evaluate("(()=>{const r=document.getElementById('tag-filter').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && document.documentElement.scrollWidth<=innerWidth;})()"),true);
 }
 await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
 await panel.screenshot('tag-filter-sidepanel-dark.png');
 await panel.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
 await panel.screenshot('tag-filter-sidepanel-light.png');
 await panel.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await panel.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await panel.wait("!document.getElementById('tag-filter').matches(':popover-open') && document.activeElement?.classList.contains('pair-filter')");
 passed('side-panel tag popover searches and applies without losing checkbox focus, fits 240/320px and closes with Escape');
}

export async function testNativeSameSourceTags(panel,page,choose,passed) {
 const font=selector=>page.locator(selector).evaluate(element=>getComputedStyle(element).fontFamily);
 const close=async()=>{
  await panel.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await panel.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 };
 await panel.click('.pair-filter');await panel.wait("!document.getElementById('all-tags').disabled");
 await panel.click('#all-tags');await panel.click('.tag-option input[data-tag="h1"]');
 await close();
 await panel.click('#another');await panel.wait("!!document.getElementById('view-main').dataset.picking");
 await page.locator('#body').click();await panel.wait("document.querySelector('.pair-pending .tag-summary')?.textContent==='p'");
 await choose('Lora');
 assert.equal(await panel.evaluate("[...document.querySelectorAll('.pair-from')].map(element=>element.textContent).join(',')"),'Arial,Arial');
 const bodyFont=await font('#body');assert.notEqual(await font('#heading'),bodyFont);
 await panel.click('.pair:nth-child(1) .pair-edit');await panel.wait("!!document.querySelector('.pair:nth-child(1) .pair-body:not([hidden]) #steps')");
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair-edit[aria-expanded=true]').length"),1);
 await choose('Roboto');assert.equal(await font('#body'),bodyFont);
 const headingFont=await font('#heading');
 await panel.click('.pair:nth-child(2) .pair-edit');await choose('Inter');assert.equal(await font('#heading'),headingFont);
 assert.equal(await panel.evaluate("document.querySelectorAll('.pair').length"),2);
 await panel.screenshot('same-source-sidepanel.png');
 await panel.click('.pair:nth-child(2) .pair-remove');await panel.wait("document.querySelectorAll('.pair').length===1");
 assert.equal(await font('#heading'),headingFont);assert.match(await font('#body'),/^Arial/);
 await panel.click('.pair-edit');await choose('Inter');
 await panel.click('.pair-filter');await panel.wait("!document.getElementById('all-tags').disabled");
 await panel.click('#all-tags');await panel.wait("!document.querySelector('.tag-summary')");await close();
 passed('side-panel rows with the same source font edit and remove independently with separate tag filters');
}
