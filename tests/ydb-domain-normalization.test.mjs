import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoSaleStateHash,
  canonicalAutoSaleState,
  compareLegacyAndDomainState,
  domainRowsToLegacyState,
  legacyStateToDomainRows
} from '../server/ydb-domain-migration.mjs';
import {
  AUTO_SALE_DOMAIN_SCHEMA_VERSION,
  AUTO_SALE_DOMAIN_TABLES
} from '../server/ydb-domain-store.mjs';

const sample=()=>({
  revision:41,
  initialized:true,
  leads:[
    {
      id:'L-1',name:'Анна',contact:'@anna',model:'BMW X5',status:'В работе',
      manager:'Дмитрий',source:'Mini App',clientCreated:true,
      telegramUserId:'700',telegramUsername:'anna',
      telegramFirstName:'Анна',telegramLastName:'Тест',
      telegramLinkedAt:'2026-09-28T10:00:00.000Z',
      createdAt:'2026-09-28T09:00:00.000Z'
    },
    {
      id:'L-2',name:'Борис',contact:'+79990000000',model:'Kia K5',status:'Новый',
      manager:'',source:'WhatsApp',clientCreated:false,
      createdAt:'2026-09-28T09:30:00.000Z'
    }
  ],
  quotes:[
    {id:'Q-1',leadId:'L-1',model:'BMW X5',status:'Согласован',version:2,total:39000,updatedAt:'2026-09-28T11:00:00.000Z'}
  ],
  orders:[
    {
      id:'O-1',leadId:'L-1',model:'BMW X5',stage:'Порт США',manager:'Дмитрий',
      riskType:'Нет',total:39000,paid:12000,updatedAt:'2026-09-28T12:00:00.000Z',
      payments:[
        {id:'PAY-1',amount:10000,date:'2026-09-28',method:'Банк',paymentStage:'auction_deposit'},
        {amount:2000,date:'2026-09-29',method:'Банк',note:'без legacy id'}
      ]
    }
  ],
  notes:{
    'L-1':[
      {at:'2026-09-28T09:00:00.000Z',text:'Лид создан.'},
      {text:'Комментарий без id и даты'}
    ]
  },
  team:[
    {
      id:'TM-1',name:'Дмитрий',role:'Менеджер',active:true,
      telegramUserId:'800',telegramUsername:'manager',
      telegramFirstName:'Дмитрий',telegramLinkedAt:'2026-09-28T08:00:00.000Z'
    }
  ],
  catalog:[
    {
      id:'CAR-2',brand:'Kia',model:'K5',origin:'Грузия',active:true,
      image:'https://example.com/k5.webp'
    },
    {
      id:'CAR-1',brand:'BMW',model:'X5',origin:'США',active:false,
      auctionDate:'2026-10-02',image:'https://example.com/x5.webp'
    }
  ]
});

test('normalized schema v1 contains all Phase 0 domain tables',()=>{
  assert.equal(AUTO_SALE_DOMAIN_SCHEMA_VERSION,1);
  for(const table of [
    'auto_sale_leads','auto_sale_quotes','auto_sale_orders','auto_sale_payments',
    'auto_sale_notes','auto_sale_team','auto_sale_catalog',
    'auto_sale_telegram_bindings','auto_sale_state_meta'
  ])assert.ok(AUTO_SALE_DOMAIN_TABLES.includes(table),table);
});

test('legacy state flattens and reconstructs without business-state loss',()=>{
  const state=sample();
  const rows=legacyStateToDomainRows(state);
  const parity=compareLegacyAndDomainState(state,rows);
  assert.equal(parity.ok,true);
  assert.equal(parity.legacyHash,parity.domainHash);
  assert.deepEqual(parity.reconstructed,state);
});

test('payments and notes get deterministic internal keys without leaking into payload',()=>{
  const state=sample();
  const rows=legacyStateToDomainRows(state);
  assert.equal(rows.payments.length,2);
  assert.match(rows.payments[1].id,/^PAY-O-1-0002$/);
  assert.equal(rows.payments[1].payload.id,undefined);
  assert.equal(rows.notes.length,2);
  assert.match(rows.notes[1].id,/^NOTE-L-1-0002$/);
  assert.equal(rows.notes[1].payload.id,undefined);
  const rebuilt=domainRowsToLegacyState(rows,{revision:state.revision,initialized:true});
  assert.equal(rebuilt.orders[0].payments[1].id,undefined);
  assert.equal(rebuilt.notes['L-1'][1].id,undefined);
});

test('array order is explicitly preserved by sort_order',()=>{
  const state=sample();
  const rows=legacyStateToDomainRows(state);
  rows.catalog.reverse();
  rows.leads.reverse();
  const rebuilt=domainRowsToLegacyState(rows,{revision:state.revision,initialized:true});
  assert.deepEqual(rebuilt.catalog.map(x=>x.id),['CAR-2','CAR-1']);
  assert.deepEqual(rebuilt.leads.map(x=>x.id),['L-1','L-2']);
});

test('Telegram identities are extracted as independent bindings',()=>{
  const rows=legacyStateToDomainRows(sample());
  assert.deepEqual(rows.telegramBindings,[
    {
      subjectType:'client',subjectId:'L-1',telegramUserId:'700',username:'anna',
      firstName:'Анна',lastName:'Тест',linkedAt:'2026-09-28T10:00:00.000Z'
    },
    {
      subjectType:'staff',subjectId:'TM-1',telegramUserId:'800',username:'manager',
      firstName:'Дмитрий',lastName:'',linkedAt:'2026-09-28T08:00:00.000Z'
    }
  ]);
});

test('parity hash ignores global revision but detects business-state changes',()=>{
  const a=sample(),b=sample();
  b.revision=999;
  assert.equal(autoSaleStateHash(a),autoSaleStateHash(b));
  b.leads[0].status='Расчёт';
  assert.notEqual(autoSaleStateHash(a),autoSaleStateHash(b));
  assert.deepEqual(canonicalAutoSaleState(a).catalog,a.catalog);
});

test('canonical parity treats missing and empty note groups as equivalent',()=>{
  const left=sample();
  left.notes['L-2']=[];
  const right=structuredClone(left);
  delete right.notes['L-2'];
  assert.equal(autoSaleStateHash(left),autoSaleStateHash(right));
});
