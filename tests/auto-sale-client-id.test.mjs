import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {distributedId,nextId} from '../public/auto-sale-core.mjs';

test('client lead IDs are collision-resistant across isolated Telegram viewers',()=>{
  assert.equal(nextId('L',[]),'L-1');
  const ids=new Set(Array.from({length:500},()=>distributedId('L')));
  assert.equal(ids.size,500);
  for(const id of ids)assert.match(id,/^L-[A-Za-z0-9-]+$/);
});

test('client request does not derive its ID from viewer-owned leads',async()=>{
  const app=await readFile(new URL('../public/auto-sale-app-v3.mjs',import.meta.url),'utf8');
  assert.match(app,/id:managerMode\?nextId\('L',leads\):distributedId\('L'\)/);
});
