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

test('tag scopes stop at text boundaries while keeping inline and shadow text together',()=>{
 const node=(localName,parentElement=null,host)=>({localName,parentElement,getRootNode:()=>({host})});
 const div=node('div'), h1=node('h1',div), span=node('span',h1), strong=node('strong',span);
 assert.equal(U.matchesTags(h1,['div']),false);
 assert.equal(U.matchesTags(strong,['div']),false);
 assert.equal(U.matchesTags(strong,['h1']),true);
 assert.equal(U.matchesTags(strong,['span']),true);
 assert.deepEqual([...U.ancestors(strong)].map(n=>n.localName),['strong','span','h1']);
 for(const tag of ['p','button','a','li','summary']) assert.equal(U.matchesTags(node('em',node(tag,div)),['div']),false);
 const shadowText=node('span',null,node('p',div));
 assert.equal(U.matchesTags(shadowText,['p']),true);
 assert.equal(U.matchesTags(shadowText,['div']),false);
 assert.equal(U.matchesTags(node('my-label',div),['div']),true);
 assert.equal(U.matchesTags(h1,null),true);
 assert.equal(U.matchesTags(h1,[]),false);
});
