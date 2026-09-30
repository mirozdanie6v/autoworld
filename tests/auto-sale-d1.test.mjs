import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration5=await readFile(new URL('../migrations/0005_auto_sale_crm.sql',import.meta.url),'utf8');
const migration6=await readFile(new URL('../migrations/0006_auto_sale_demo_cleanup.sql',import.meta.url),'utf8');
const migration7=await readFile(new URL('../migrations/0007_auto_sale_legacy_backfill.sql',import.meta.url),'utf8');
const migration8=await readFile(new URL('../migrations/0008_auto_sale_persistent_demo_cards.sql',import.meta.url),'utf8');
const migration9=await readFile(new URL('../migrations/0009_auto_sale_team.sql',import.meta.url),'utf8');
const migration10=await readFile(new URL('../migrations/0010_auto_sale_remove_demo_cards.sql',import.meta.url),'utf8');
const worker=await readFile(new URL('../src/auto-sale-worker.ts',import.meta.url),'utf8');
const stateApi=await readFile(new URL('../src/auto-sale/state-api.ts',import.meta.url),'utf8');
const storage=await readFile(new URL('../src/auto-sale/storage.ts',import.meta.url),'utf8');
const rules=await readFile(new URL('../src/auto-sale/rules.ts',import.meta.url),'utf8');
const bootstrap=await readFile(new URL('../public/auto-sale-bootstrap.mjs',import.meta.url),'utf8');
const apiAudit=await readFile(new URL('../public/auto-sale-api-audit.js',import.meta.url),'utf8');
const wrangler=await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8');

test('AUTO SALE migration chain ends with demo cleanup and director team in schema 10',()=>{
  for(const table of ['auto_sale_leads','auto_sale_quotes','auto_sale_orders','auto_sale_payments','auto_sale_notes','auto_sale_state_meta']) assert.ok(migration5.includes(table),table);
  assert.match(migration6,/O-DEMO-%/);assert.match(migration6,/Q-DEMO-%/);assert.match(migration6,/L-DEMO-%/);assert.match(migration6,/schema_meta \(version\) VALUES \(6\)/);
  assert.match(migration7,/validUntil/);assert.match(migration7,/riskType/);assert.match(migration7,/riskNote/);assert.match(migration7,/PAY-LEGACY/);assert.match(migration7,/schema_meta \(version\) VALUES \(7\)/);
  for(const id of ['L-DEMO-205','L-DEMO-206','Q-DEMO-205','Q-DEMO-206','O-DEMO-205','O-DEMO-206'])assert.ok(migration8.includes(id),id);
  assert.match(migration8,/auto_sale_payments/);assert.match(migration8,/auto_sale_notes/);assert.match(migration8,/schema_meta \(version\) VALUES \(8\)/);
  assert.match(migration9,/auto_sale_team/);assert.match(migration9,/schema_meta \(version\) VALUES \(9\)/);
  for(const token of ['L-DEMO-%','Q-DEMO-%','O-DEMO-%'])assert.ok(migration10.includes(token),token);
  assert.match(migration10,/schema_meta \(version\) VALUES \(10\)/);
});

test('AUTO SALE branch deploys its own Worker entry',()=>{
  assert.match(wrangler,/src\/auto-sale-worker\.ts/);assert.match(wrangler,/auto-sale-db/);assert.match(wrangler,/AUTO_SALE_DEMO_MODE/);
});

test('Worker exposes schema 10 D1 state API without persistent demo cards',()=>{
  assert.match(worker,/\/api\/auto-sale\/state/);assert.match(worker,/schemaVersion:10/);assert.match(worker,/demoCardsPersistent:false/);assert.match(worker,/teamManagement:true/);assert.doesNotMatch(worker,/withDemoBusiness/);assert.match(worker,/syncState/);
  assert.match(storage,/auto_sale_team/);assert.match(storage,/putTeamMember/);assert.match(storage,/teamR/);
  assert.match(stateApi,/const team=arr\(input\.team\)/);assert.match(stateApi,/invalid_team_member/);assert.match(stateApi,/putTeamMember/);
});

test('state API treats demo ids like normal entities and enforces transitions before writes',()=>{
  assert.doesNotMatch(stateApi,/demoId/);
  for(const token of ['leadTransitionAllowed','quoteTransitionAllowed','validateOrder','quote_lead_locked','locked_quote_changed','locked_order_field_changed','new_order_must_start_at_purchase','order_prerequisites_missing']) assert.ok(stateApi.includes(token),token);
  const validationEnd=stateApi.indexOf('for(const member of team)await putTeamMember');
  for(const token of ['invalid_lead_transition','invalid_quote_transition','invalid_order']) assert.ok(stateApi.indexOf(token)>=0&&stateApi.indexOf(token)<validationEnd,token);
  assert.ok(stateApi.indexOf('for(const member of team)await putTeamMember')<stateApi.indexOf('return{status:200'));
});

test('server requires full payment before handoff',()=>{
  assert.match(rules,/stage==='Выдача'/);assert.match(rules,/full_payment_required_for_handoff/);assert.match(rules,/paid<num\(order\.total\)/);
});

test('browser hydrates team from server state and persists later saves through entity API',()=>{
  assert.match(bootstrap,/fetch\('\/api\/auto-sale\/state'/);
  assert.match(bootstrap,/team:'auto-sale-team-v1'/);
  assert.match(bootstrap,/writeCache\(DATA_KEYS\.team,state\.team\|\|\[\]\)/);
  assert.match(bootstrap,/\/api\/auto-sale\/entities\/batch/);
  assert.match(bootstrap,/response\.status===409&&data\.error==='entity_conflict'/);
  assert.match(bootstrap,/auto-sale-entity-rejected/);
  assert.match(bootstrap,/await pullInitialState\(\)/);
  assert.match(bootstrap,/auto-sale-director-team\.mjs/);
  assert.doesNotMatch(bootstrap,/method:'PUT'/);
  assert.doesNotMatch(bootstrap,/location\.reload\s*\(/);
  assert.doesNotMatch(bootstrap,/reloadPending|refreshUiWhenSafe|mergeDemoRows/);
});

test('live API audit accepts empty business state and rejects demo record residue',()=>{
  assert.match(apiAudit,/api-audit-result/);assert.match(apiAudit,/API_AUDIT_OK/);
  assert.match(apiAudit,/demoCardsPersistent/);assert.match(apiAudit,/demo-record-residue/);
  assert.doesNotMatch(apiAudit,/demo-leads-missing|demo-quotes-missing|demo-delivery-missing|demo-handoff-missing|demo-payments-missing/);
});