import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('lead save handler remains wired and D1 is the source of truth for every card',()=>{
  const app=fs.readFileSync('public/auto-sale-app-v3.mjs','utf8');
  assert.match(app,/function submitLead\(/);
  assert.match(app,/getAttribute\?\.\('id'\)/);
  assert.doesNotMatch(app,/form\.id==='leadEditForm'/);
  const bootstrap=fs.readFileSync('public/auto-sale-bootstrap.mjs','utf8');
  assert.match(bootstrap,/applyServerState/);
  assert.match(bootstrap,/state\.leads\|\|\[\]/);
  assert.doesNotMatch(bootstrap,/mergeDemoRows/);
  assert.doesNotMatch(bootstrap,/state\.demoBusiness/);
});
