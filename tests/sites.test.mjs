import test from 'node:test';
import assert from 'node:assert/strict';
import {siteOrigin,sitePattern,savedPairs} from '../extension/sites.js';

test('site identity separates paths from origins and keeps schemes, subdomains and ports distinct',()=>{
 assert.equal(siteOrigin('https://Example.com/article?a=1#title'),'https://example.com');
 assert.notEqual(siteOrigin('https://example.com'),siteOrigin('http://example.com'));
 assert.notEqual(siteOrigin('https://www.example.com'),siteOrigin('https://example.com'));
 assert.notEqual(siteOrigin('http://localhost:3000'),siteOrigin('http://localhost:3001'));
 for(const url of ['chrome://settings','file:///tmp/test','not a URL']) assert.equal(siteOrigin(url),'');
 assert.equal(sitePattern('https://example.com:8080'),'https://example.com/*');
});
test('saved pairs exclude embedded frames, single elements, text and DOM references',()=>{
 const pair={source:'Arial',destination:{kind:'google',family:'Inter'}};
 assert.deepEqual(savedPairs([{...pair,frameId:0,scope:'all',text:'private text',element:{id:'secret'}},{...pair,frameId:5,scope:'all'},{...pair,frameId:0,scope:'element'}]),[pair]);
});
