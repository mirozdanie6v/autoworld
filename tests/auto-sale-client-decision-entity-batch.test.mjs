import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AWG_US_SIMPLE_SCHEMA,AWG_US_SIMPLE_TARIFF} from '../public/auto-sale-quote-v2.mjs';
import {validateQuote as serverValidateQuote} from '../server/auto-sale-rules.mjs';
import {sanitizeClientOperations} from '../server/auto-sale-access.mjs';
import {canSafelyRebaseEntityBatch} from '../public/auto-sale-entity-safe-retry.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const quote=(overrides={})=>({
  id:'Q-CLIENT-51172',leadId:'L-CLIENT',model:'BMW X5 2025',origin:'США',
  quoteSchema:AWG_US_SIMPLE_SCHEMA,tariffVersion:AWG_US_SIMPLE_TARIFF,
  lot:50172.92,repair:1000,total:51172.92,auction:0,inland:0,ocean:0,
  partsCost:0,customs:0,recyclingFee:0,legalization:0,service:0,georgiaDelivery:0,
  turnkeyDeliveryUsd:0,cryptoFee:0,customsAndRecyclingRub:0,
  status:'Отправлен',version:1,updatedAt:'2026-10-27T08:00:00.000Z',
  ...overrides
});
const lead={id:'L-CLIENT',name:'Тестовый клиент',contact:'@buyer',
  status:'Ожидает клиента',model:'BMW X5 2025',telegramUserId:'991177'};

async function boot(tag,{handler}={}){
  const dom=new JSDOM('<!doctype html><html><head></head><body><div data-client-detail-bg><div class="auto-tg-modal"><div class="auto-client-order-grid"></div><div class="auto-guide"><span></span></div><button data-tg-manager="L-CLIENT">Написать менеджеру</button></div></div></body></html>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,MutationObserver:dom.window.MutationObserver,
    CustomEvent:dom.window.CustomEvent});
  globalThis.confirm=()=>true;
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([quote()]));
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify([lead]));
  localStorage.setItem('auto-sale-notes-v2','{}');
  window.__AUTO_SALE_ENTITY_BATCH__=handler;
  await import('../public/auto-sale-client-quote.mjs?decision-entity='+tag);
  await tick();
  const root=document.querySelector('.auto-client-quote');
  assert.ok(root&&root.querySelector('[data-client-quote-agree]'),'client can see quote and approve');
  return{dom,root};
}

test('server accepts the preliminary $51,172.92 US approval quote',()=>{
  assert.deepEqual(serverValidateQuote({...quote(),status:'Согласован'}),[]);
});

test('entity mode approves without coupling the decision to lead-note row version',async()=>{
  const batches=[];
  const{dom}=await boot('agreed',{handler:async operations=>{
    batches.push(operations);
    assert.equal(operations.length,1);
    assert.equal(operations[0].resource,'quote');
    assert.equal(operations[0].operation,'patch');
    assert.equal(operations[0].id,'Q-CLIENT-51172');
    assert.equal(operations[0].input.status,'Согласован');
    assert.equal(operations[0].input.clientDecision,'agreed');
    assert.ok(!('total' in operations[0].input),'price must not be writable by client');
    return{ok:true,revision:42,rowVersions:{'quote:Q-CLIENT-51172':42}};
  }});
  document.querySelector('[data-client-quote-agree]').click();
  for(let i=0;i<4;i++)await tick();
  assert.equal(batches.length,1);
  const saved=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0];
  assert.equal(saved.status,'Согласован');
  assert.equal(saved.clientDecision,'agreed');
  assert.equal(saved.total,51172.92);
  assert.deepEqual(JSON.parse(localStorage.getItem('auto-sale-notes-v2')),{});
  assert.match(document.querySelector('.auto-client-quote').textContent,/Расчёт согласован/);
  const server=sanitizeClientOperations({leads:[lead],quotes:[quote()]},batches[0],{id:991177});
  assert.equal(server.ok,true);
  assert.equal(server.operations.length,1);
  dom.window.close();
});

test('changes requested update quote decision independently and preserve comment',async()=>{
  const batches=[];
  const{dom}=await boot('changes',{handler:async operations=>{batches.push(operations);return{ok:true}}});
  document.querySelector('[data-client-quote-change]').click();
  const input=document.querySelector('[data-client-quote-comment]');
  input.value='Уточните доставку';
  document.querySelector('[data-client-quote-send-change]').click();
  for(let i=0;i<4;i++)await tick();
  assert.equal(batches.length,1);
  assert.deepEqual(batches[0].map(x=>x.resource),['quote']);
  assert.equal(batches[0][0].input.clientDecision,'changes_requested');
  assert.equal(batches[0][0].input.clientComment,'Уточните доставку');
  const saved=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0];
  assert.equal(saved.status,'На согласовании');
  assert.equal(saved.clientComment,'Уточните доставку');
  assert.match(document.querySelector('.auto-client-quote').textContent,/Запрошены изменения/);
  dom.window.close();
});

test('server rejects a decision: no false success and client can retry',async()=>{
  let attempts=0;
  const{dom}=await boot('failure',{handler:async()=>{attempts++;if(attempts===1)throw Object.assign(new Error('entity_conflict'),{code:'entity_conflict'});return{ok:true}}});
  document.querySelector('[data-client-quote-agree]').click();
  for(let i=0;i<4;i++)await tick();
  let saved=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0];
  assert.equal(saved.status,'Отправлен');
  assert.match(document.querySelector('[role="alert"]').textContent,/Расчёт обновился на сервере/);
  assert.ok(document.querySelector('[data-client-quote-agree]'));
  document.querySelector('[data-client-quote-agree]').click();
  for(let i=0;i<4;i++)await tick();
  saved=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0];
  assert.equal(saved.clientDecision,'agreed');
  assert.equal(attempts,2);
  dom.window.close();
});

test('noncommitted batch result never marks the quote as agreed',async()=>{
  const{dom}=await boot('not-ok',{handler:async()=>({ok:false,error:'invalid_quote'})});
  document.querySelector('[data-client-quote-agree]').click();
  for(let i=0;i<4;i++)await tick();
  assert.equal(JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0].status,'Отправлен');
  assert.match(document.querySelector('[role="alert"]').textContent,/Сервер отклонил состояние расчёта/);
  dom.window.close();
});

test('consent may rebase across unchanged quote, never across changed price or manager comment',()=>{
  const old={leads:[lead],quotes:[quote()]};
  const op=[{resource:'quote',operation:'patch',id:'Q-CLIENT-51172',input:{
    status:'Согласован',clientDecision:'agreed',clientDecisionAt:'2026-10-27T08:20:00.000Z'}}];
  assert.equal(canSafelyRebaseEntityBatch(op,old,{leads:[{...lead,status:'Расчёт'}],quotes:[quote()]}),true);
  assert.equal(canSafelyRebaseEntityBatch(op,old,{leads:[lead],quotes:[quote({lot:50173.92,total:51173.92})]}),false);
  assert.equal(canSafelyRebaseEntityBatch(op,old,{leads:[lead],quotes:[quote({publicComment:'Другие условия'})]}),false);
  assert.equal(canSafelyRebaseEntityBatch(op,old,{leads:[lead],quotes:[quote({status:'Согласован'})]}),false);
});
