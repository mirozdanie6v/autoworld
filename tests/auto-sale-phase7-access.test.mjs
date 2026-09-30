import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  MAX_ADMIN_ACCOUNTS,accessForState,stateForAccess,rowVersionsForAccess,
  sanitizeClientOperations,sanitizeAdminOperations
} from '../server/auto-sale-access.mjs';

const state={
  initialized:true,revision:10,
  team:[
    {id:'T1',name:'A',role:'Менеджер',active:true,telegram:'@one',telegramUserId:'101'},
    {id:'T2',name:'B',role:'Менеджер',active:true,telegram:'@two',telegramUserId:'202'},
    {id:'T3',name:'C',role:'Директор',active:true,telegram:'@three',adminAccess:true},
    {id:'T4',name:'D',role:'Логист',active:true,telegram:'@four'}
  ],
  leads:[
    {id:'L1',status:'Новый',telegramUserId:'501',name:'Own'},
    {id:'L2',status:'В работе',telegramUserId:'502',name:'Other'}
  ],
  quotes:[
    {id:'Q1',leadId:'L1',status:'Отправлен',total:39000},
    {id:'Q2',leadId:'L2',status:'Отправлен',total:44000}
  ],
  orders:[{id:'O1',leadId:'L1'},{id:'O2',leadId:'L2'}],
  notes:{L1:[{id:'N1',text:'internal'}]},
  catalog:[{id:'C1',active:true},{id:'C2',active:false}]
};

test('Phase 7 fixes admin access to exactly three invited Telegram usernames',async()=>{
  assert.equal(MAX_ADMIN_ACCOUNTS,3);
  const server=await readFile(new URL('../server/yandex-server.mjs',import.meta.url),'utf8');
  const workflow=await readFile(new URL('../.github/workflows/deploy-awg-production.yml',import.meta.url),'utf8');
  for(const username of ['Flyer_Flyer','smit44744','Ivan_AWG']){
    assert.ok(server.includes(username),username+' server invite');
    assert.ok(workflow.includes(username),username+' workflow invite');
  }
  assert.match(server,/claimAdminAccess\(username,String\(user\.id\)\)/);
  assert.match(server,/adminAccessByUserId/);
});

test('Phase 7 pins invited usernames to immutable Telegram user IDs in YDB',async()=>{
  const stateStore=await readFile(new URL('../server/ydb-state.mjs',import.meta.url),'utf8');
  assert.match(stateStore,/CREATE TABLE IF NOT EXISTS auto_sale_admin_access/);
  assert.match(stateStore,/adminAccessByUserId/);
  assert.match(stateStore,/adminAccessByUsername/);
  assert.match(stateStore,/adminAccessList/);
  assert.match(stateStore,/claimAdminAccess/);
  assert.match(stateStore,/admin_username_already_claimed/);
  assert.match(stateStore,/admin_user_already_claimed/);
});

test('Phase 7 CRM team role and admin authorization are independent',async()=>{
  const teamUi=await readFile(new URL('../public/auto-sale-director-team.mjs',import.meta.url),'utf8');
  assert.match(teamUi,/Админ-доступ не задаётся ролью сотрудника/);
  assert.match(teamUi,/@Flyer_Flyer/);
  assert.match(teamUi,/@smit44744/);
  assert.match(teamUi,/@Ivan_AWG/);
  assert.doesNotMatch(teamUi,/name="adminAccess"/);
});

test('Phase 7 viewer state never exposes other clients or staff directory',()=>{
  const clientAccess=accessForState(state,{telegramAuth:{ok:true,user:{id:'501'}}});
  assert.equal(clientAccess.role,'client');
  const visible=stateForAccess(state,clientAccess);
  assert.deepEqual(visible.leads.map(x=>x.id),['L1']);
  assert.deepEqual(visible.quotes.map(x=>x.id),['Q1']);
  assert.deepEqual(visible.orders.map(x=>x.id),['O1']);
  assert.deepEqual(visible.team,[]);
  assert.deepEqual(visible.notes,{});
  assert.deepEqual(visible.catalog.map(x=>x.id),['C1']);

  const publicVisible=stateForAccess(state,{role:'public'});
  assert.deepEqual(publicVisible.leads,[]);
  assert.deepEqual(publicVisible.team,[]);
  assert.deepEqual(publicVisible.catalog.map(x=>x.id),['C1']);
});

test('Phase 7 row versions are filtered to viewer-owned aggregates',()=>{
  const access={role:'client',user:{id:'501'}};
  const versions=rowVersionsForAccess({lead:{L1:1,L2:2},quote:{Q1:3,Q2:4},order:{O1:5,O2:6},team:{T1:7},catalog:{C1:8,C2:9}},state,access);
  assert.deepEqual(versions.lead,{L1:1});
  assert.deepEqual(versions.quote,{Q1:3});
  assert.deepEqual(versions.order,{O1:5});
  assert.deepEqual(versions.team,{});
  assert.deepEqual(versions.catalog,{C1:8});
});

test('Phase 7 client create is server-owned and cannot choose staff or status',()=>{
  const result=sanitizeClientOperations(state,[{resource:'lead',operation:'create',id:'L3',input:{
    id:'L3',name:'Client',model:'BMW',budget:40000,manager:'Hacker',status:'Сделка',priority:'Высокий',clientCreated:false
  }},{resource:'note',operation:'create',leadId:'L3',input:{id:'N3',text:'Need black'}}],{id:501,username:'client',first_name:'Anna'});
  assert.equal(result.ok,true);
  assert.equal(result.operations[0].input.telegramUserId,'501');
  assert.equal(result.operations[0].input.status,'Новый');
  assert.equal(result.operations[0].input.priority,'Средний');
  assert.equal(result.operations[0].input.source,'Mini App');
  assert.notEqual(result.operations[0].input.manager,'Hacker');
});

test('Phase 7 client can only update own new lead and decision fields of own quote',()=>{
  const patch=sanitizeClientOperations(state,[{resource:'lead',operation:'patch',id:'L1',input:{model:'Audi',status:'Сделка',manager:'X'}}],{id:501});
  assert.equal(patch.ok,true);
  assert.deepEqual(patch.operations[0].input,{model:'Audi'});
  const foreign=sanitizeClientOperations(state,[{resource:'lead',operation:'patch',id:'L2',input:{model:'Audi'}}],{id:501});
  assert.equal(foreign.error,'client_entity_forbidden');
  const quote=sanitizeClientOperations(state,[{resource:'quote',operation:'patch',id:'Q1',input:{clientDecision:'agreed',total:1,status:'Согласован'}}],{id:501});
  assert.equal(quote.ok,true);
  assert.equal(quote.operations[0].input.status,'Согласован');
  assert.equal('total' in quote.operations[0].input,false);
});

test('Phase 7 browser admins cannot self-grant Telegram identity through generic team writes',()=>{
  const cleaned=sanitizeAdminOperations([{resource:'team',operation:'patch',id:'T3',input:{name:'C',telegram:'@three',telegramUserId:'999',telegramUsername:'hacker'}}]);
  assert.equal(cleaned[0].input.telegram,'@three');
  assert.equal('telegramUserId' in cleaned[0].input,false);
  assert.equal('telegramUsername' in cleaned[0].input,false);
  const api=sanitizeAdminOperations([{resource:'team',operation:'patch',id:'T3',input:{telegramUserId:'999'}}],{apiKey:true});
  assert.equal(api[0].input.telegramUserId,'999');
});

test('Phase 7 runtime and browser use Telegram-backed RBAC instead of role-switch authorization',async()=>{
  const server=await readFile(new URL('../server/yandex-server.mjs',import.meta.url),'utf8');
  const bootstrap=await readFile(new URL('../public/auto-sale-bootstrap.mjs',import.meta.url),'utf8');
  const app=await readFile(new URL('../public/auto-sale-app-v3.mjs',import.meta.url),'utf8');
  const workflow=await readFile(new URL('../.github/workflows/deploy-awg-production.yml',import.meta.url),'utf8');
  assert.match(server,/writeMode:'telegram-rbac'/);
  assert.match(server,/sanitizeClientOperations/);
  assert.match(server,/claimAdminAccess/);
  assert.match(bootstrap,/x-telegram-init-data/);
  assert.match(app,/hasAdminAccess/);
  assert.match(app,/if\(!hasAdminAccess&&t\.dataset\.role!=='client'\)return/);
  assert.match(workflow,/AUTO_SALE_PUBLIC_DEMO_WRITE=false/);
  assert.match(workflow,/AUTO_SALE_ADMIN_TELEGRAM_USERNAMES: Flyer_Flyer,smit44744,Ivan_AWG/);
  assert.match(workflow,/Verify Telegram RBAC read\/write boundary/);
});
