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

test('two isolated Telegram clients create distinct owned leads',async()=>{
  const {sanitizeClientOperations,stateForAccess}=await import('../server/auto-sale-access.mjs');
  const base={initialized:true,revision:1,team:[{id:'T1',name:'Дмитрий',role:'Менеджер',active:true}],leads:[],quotes:[],orders:[],notes:{},catalog:[]};
  const firstId=distributedId('L');
  const first=sanitizeClientOperations(base,[{resource:'lead',operation:'create',id:firstId,input:{id:firstId,name:'Client A',contact:'@client_a',model:'BMW',budget:40000}},{resource:'note',operation:'create',leadId:firstId,input:{id:'N-A',text:'Created'}}],{id:501,username:'client_a',first_name:'A'});
  assert.equal(first.ok,true);
  const firstLead=first.operations.find(x=>x.resource==='lead').input;
  const shared={...base,leads:[firstLead]};

  const secondId=distributedId('L');
  const second=sanitizeClientOperations(shared,[{resource:'lead',operation:'create',id:secondId,input:{id:secondId,name:'Client B',contact:'@client_b',model:'Audi',budget:45000}},{resource:'note',operation:'create',leadId:secondId,input:{id:'N-B',text:'Created'}}],{id:502,username:'client_b',first_name:'B'});
  assert.equal(second.ok,true);
  const secondLead=second.operations.find(x=>x.resource==='lead').input;

  assert.notEqual(firstLead.id,secondLead.id);
  assert.equal(firstLead.telegramUserId,'501');
  assert.equal(secondLead.telegramUserId,'502');

  const finalState={...shared,leads:[firstLead,secondLead]};
  assert.deepEqual(stateForAccess(finalState,{role:'client',user:{id:'501'}}).leads.map(x=>x.id),[firstLead.id]);
  assert.deepEqual(stateForAccess(finalState,{role:'client',user:{id:'502'}}).leads.map(x=>x.id),[secondLead.id]);
});


test('production smoke exercises two isolated clients and cleans up test leads',async()=>{
  const server=await readFile(new URL('../server/yandex-server.mjs',import.meta.url),'utf8');
  assert.match(server,/\/api\/auto-sale\/smoke\/two-client/);
  assert.match(server,/firstClientOwnsOnlyFirst/);
  assert.match(server,/secondClientOwnsOnlySecond/);
  assert.match(server,/managerNotificationPlannedForBoth/);
  assert.match(server,/clientConfirmationPlannedForBoth/);
  assert.match(server,/deleteAutoSaleLeadCascade/);
});
