import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const compat=fs.readFileSync(new URL('../src/auto-sale/demo-business.ts',import.meta.url),'utf8');
const cleanup=fs.readFileSync(new URL('../migrations/0010_auto_sale_remove_demo_cards.sql',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../src/auto-sale-worker.ts',import.meta.url),'utf8');

test('production demo compatibility exports contain no business records',()=>{
  assert.doesNotMatch(compat,/L-DEMO|Q-DEMO|O-DEMO|Demo Delivery|Demo Handoff/);
  assert.match(compat,/demoLeads:AnyRecord\[\]=\[\]/);
  assert.match(compat,/demoQuotes:AnyRecord\[\]=\[\]/);
  assert.match(compat,/demoOrders:AnyRecord\[\]=\[\]/);
});

test('latest D1 migration removes historical demo CRM entities',()=>{
  for(const token of ["O-DEMO-%","L-DEMO-%","Q-DEMO-%"])assert.ok(cleanup.includes(token),token);
  for(const table of ['auto_sale_leads','auto_sale_quotes','auto_sale_orders','auto_sale_payments','auto_sale_notes'])assert.ok(cleanup.includes(table),table);
  assert.match(cleanup,/schema_meta \(version\) VALUES \(10\)/);
});

test('worker reports current schema without persistent demo cards',()=>{
  assert.match(worker,/schemaVersion:10/);
  assert.match(worker,/demoCardsPersistent:false/);
});
