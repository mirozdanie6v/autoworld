import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/auto-sale-catalog-extra.mjs',import.meta.url),'utf8');
const bootstrap=await readFile(new URL('../public/auto-sale-bootstrap.mjs',import.meta.url),'utf8');

test('legacy catalog extension injects no vehicles',()=>{
  assert.doesNotMatch(source,/const extraCars=\[/);
  assert.doesNotMatch(source,/images\.unsplash\.com/);
  assert.doesNotMatch(source,/bmw-x3-23|cadillac-xt5-22/);
});

test('current bootstrap does not load the legacy catalog extension',()=>{
  assert.doesNotMatch(bootstrap,/await import\('\.\/auto-sale-catalog-extra\.mjs/);
});

test('Telegram enhancements are loaded directly by current bootstrap',()=>{
  assert.match(bootstrap,/auto-sale-telegram\.mjs/);
  assert.match(bootstrap,/auto-sale-telegram-id\.mjs/);
});
