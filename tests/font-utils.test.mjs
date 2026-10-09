import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../extension/font-utils.js';
const U=globalThis.FSFontUtils;
test('CSS family names preserve quoted commas and escaped quotes',()=>{
 assert.deepEqual(U.parseStack('"A, B", "A\\"B", serif'),['A, B','A"B','serif']);
});
test('replacement matches primary family only, never partial names or fallbacks',()=>{
 assert.equal(U.matches('"Inter Display", Inter, sans-serif','Inter'),false);
 assert.equal(U.matches('Roboto, Inter, sans-serif','Inter'),false);
 assert.equal(U.matches('"INTER", sans-serif','Inter'),true);
});
test('fallbacks preserve usable CSS and exclude the swapped source',()=>{
 assert.equal(U.fallback('Inter, "A, B", system-ui, sans-serif','Inter'),'"A, B", system-ui, sans-serif');
 assert.equal(U.quote('A"B\\C\n'),'"A\\"B\\\\C "');
});
test('icon fonts and private-use characters are protected',()=>{
 assert.equal(U.protectedFont('Material Symbols Rounded','home'),true);
 assert.equal(U.protectedFont('Font Awesome 6 Free','x'),true);
 assert.equal(U.protectedFont('Custom','\ue900'),true);
 assert.equal(U.protectedFont('Custom','Hello हिंदी 中文'),false);
});

test('page font destinations preserve generic keyword semantics',()=>{
 assert.equal(U.familyCSS('serif'),'serif');
 assert.equal(U.familyCSS('System-UI'),'system-ui');
 assert.equal(U.familyCSS('Inter'),'\"Inter\"');
});

test('tag scopes keep old swaps unrestricted, normalize custom tags and reject selectors',()=>{
 assert.equal(U.normalizeTags(undefined),null);
 assert.deepEqual(U.normalizeTags(['P','h1','p','my-label']),['h1','my-label','p']);
 assert.deepEqual(U.normalizeTags([]),[]);
 for (const tags of ['p', ['p, a'], ['*'], [null], Array(101).fill('p')]) assert.throws(()=>U.normalizeTags(tags));
});
