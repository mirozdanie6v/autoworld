import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/auto-sale-photo-catalog.mjs',import.meta.url),'utf8');
const index=await readFile(new URL('../index.html',import.meta.url),'utf8');

test('legacy photo module contains no replacement vehicle map',()=>{
  assert.doesNotMatch(source,/verifiedPhotos=\[/);
  assert.doesNotMatch(source,/bmw-x5-22|tesla-y-23|cadillac-xt5-22/);
  assert.match(source,/__AUTO_SALE_VERIFIED_PHOTOS__=\[\]/);
});

test('entry page no longer loads legacy photo substitution module',()=>{
  assert.doesNotMatch(index,/auto-sale-photo-catalog\.mjs/);
});
