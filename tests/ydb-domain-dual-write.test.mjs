import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDomainDiff,summarizeDomainDiff} from '../server/ydb-domain-dual-write.mjs';

const base=()=>({
  revision:10,
  initialized:true,
  leads:[
    {id:'L-1',name:'A',contact:'@a',model:'BMW',status:'Новый',manager:'',source:'Mini App',nextAction:'2026-10-01'},
    {id:'L-2',name:'B',contact:'@b',model:'Kia',status:'В работе',manager:'Дмитрий',source:'Mini App',nextAction:'2026-10-02'}
  ],
  quotes:[{id:'Q-1',leadId:'L-2',status:'Черновик',version:1,total:10}],
  orders:[{
    id:'O-1',leadId:'L-2',stage:'Выкуп',manager:'Дмитрий',riskType:'Нет',
    payments:[{id:'P-1',amount:100,date:'2026-09-28',method:'Банк'}]
  }],
  notes:{'L-1':[],'L-2':[{id:'N-1',at:'2026-09-28T10:00:00Z',text:'note'}]},
  team:[{id:'TM-1',name:'Дмитрий',role:'Менеджер',active:true}],
  catalog:[
    {id:'CAR-1',brand:'BMW',model:'X5',origin:'США',active:true},
    {id:'CAR-2',brand:'Kia',model:'K5',origin:'Грузия',active:true}
  ]
});

test('single lead edit does not rewrite unrelated normalized collections',()=>{
  const previous=base();
  const next=structuredClone(previous);
  next.revision=11;
  next.leads[0].priority='Высокий';
  const summary=summarizeDomainDiff(buildDomainDiff(previous,next));
  assert.deepEqual(summary.leads,{upserts:1,deletes:0});
  for(const key of ['quotes','orders','payments','notes','team','catalog','telegramBindings']){
    assert.deepEqual(summary[key],{upserts:0,deletes:0},key);
  }
});

test('payment append updates payment row and owner order version',()=>{
  const previous=base();
  const next=structuredClone(previous);
  next.orders[0].payments.push({id:'P-2',amount:50,date:'2026-09-29',method:'Банк'});
  const summary=summarizeDomainDiff(buildDomainDiff(previous,next));
  assert.deepEqual(summary.payments,{upserts:1,deletes:0});
  assert.deepEqual(summary.orders,{upserts:1,deletes:0});
  assert.deepEqual(summary.catalog,{upserts:0,deletes:0});
});

test('Telegram link creates binding and updates only owning lead payload',()=>{
  const previous=base();
  const next=structuredClone(previous);
  Object.assign(next.leads[0],{
    telegramUserId:'700',
    telegramUsername:'client',
    telegramFirstName:'Client',
    telegramLinkedAt:'2026-09-28T11:00:00Z'
  });
  const summary=summarizeDomainDiff(buildDomainDiff(previous,next));
  assert.deepEqual(summary.leads,{upserts:1,deletes:0});
  assert.deepEqual(summary.telegramBindings,{upserts:1,deletes:0});
  assert.deepEqual(summary.catalog,{upserts:0,deletes:0});
});

test('entity deletion produces targeted deletes including its Telegram binding',()=>{
  const previous=base();
  Object.assign(previous.leads[0],{telegramUserId:'700',telegramUsername:'client'});
  const next=structuredClone(previous);
  next.leads=next.leads.filter(x=>x.id!=='L-1');
  delete next.notes['L-1'];
  const summary=summarizeDomainDiff(buildDomainDiff(previous,next));
  assert.deepEqual(summary.leads,{upserts:1,deletes:1}); // L-2 is reindexed after L-1 removal
  assert.deepEqual(summary.telegramBindings,{upserts:0,deletes:1});
  assert.deepEqual(summary.catalog,{upserts:0,deletes:0});
});

test('catalog edit never rewrites CRM rows',()=>{
  const previous=base();
  const next=structuredClone(previous);
  next.catalog[1].active=false;
  const summary=summarizeDomainDiff(buildDomainDiff(previous,next));
  assert.deepEqual(summary.catalog,{upserts:1,deletes:0});
  for(const key of ['leads','quotes','orders','payments','notes','team','telegramBindings']){
    assert.deepEqual(summary[key],{upserts:0,deletes:0},key);
  }
});
