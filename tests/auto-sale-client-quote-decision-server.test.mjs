import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {canSafelyRebaseEntityBatch} from '../public/auto-sale-entity-safe-retry.mjs';
import {sanitizeClientOperations} from '../server/auto-sale-access.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const quoteFor=origin=>origin==='США'?{
  id:'Q-US-APPROVAL',leadId:'L-CLIENT',model:'Test USA car',origin,
  status:'Отправлен',version:1,quoteSchema:'awg-quote-us-simple-2026-10-26',
  tariffVersion:'2026-10-26-us-car-plus-repair',
  lot:50172.92,repair:1000,total:51172.92,
  customsAndRecyclingRub:0,auction:0,inland:0,ocean:0,
  cryptoFee:0,partsCost:0,customs:0,recyclingFee:0,legalization:0,
  service:0,georgiaDelivery:0,turnkeyDeliveryUsd:0
}:{
  id:'Q-GE-APPROVAL',leadId:'L-CLIENT',model:'Test Georgia car',origin,
  status:'Отправлен',version:1,lot:1000,auction:200,inland:300,
  ocean:800,customs:500,repair:0,service:1400,total:4200,
  validUntil:'2026-12-30'
};
async function boot(origin,scenario){
  const dom=new JSDOM('<!doctype html><html><head></head><body><div data-client-detail-bg><div class="auto-tg-modal"><div class="auto-client-order-grid"></div><div class="auto-guide"><span></span></div><button data-tg-manager="L-CLIENT">Менеджер</button></div></div></body></html>',{url:'https://awgcars.ru/'});
  for(const key of ['window','document','localStorage','sessionStorage','FormData','Event','MouseEvent','CustomEvent','MutationObserver','HTMLFormElement','EventTarget','Element','Storage'])
    globalThis[key]=key==='window'?dom.window:dom.window[key];
  globalThis.confirm=()=>true;
  const quote=quoteFor(origin);
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([quote]));
  localStorage.setItem('auto-sale-notes-v2',JSON.stringify({'L-CLIENT':[]}));
  await import('../public/auto-sale-client-quote.mjs?decision-batch='+scenario+'-'+encodeURIComponent(origin));
  await tick();
  assert.ok(document.querySelector('.auto-client-quote'));
  return {dom,quote};
}
for(const origin of ['США','Грузия']){
  test(origin+': approval saves ONLY quote decision and leaves lead notes untouched',async()=>{
    const {dom,quote}=await boot(origin,'approve');
    const calls=[];
    window.__AUTO_SALE_ENTITY_BATCH__=async operations=>{
      calls.push(operations);
      assert.equal(operations.length,1);
      assert.equal(operations[0].resource,'quote');
      assert.equal(operations[0].operation,'patch');
      assert.equal(operations[0].id,quote.id);
      assert.equal(operations[0].input.clientDecision,'agreed');
      assert.equal(operations[0].input.status,'Согласован');
      assert.equal(operations[0].input.total,undefined);
      // Simulate another manager appending a note between approval and save.
      localStorage.setItem('auto-sale-notes-v2',JSON.stringify({'L-CLIENT':[{id:'N-OTHER',text:'Менеджер обновил заметку'}]}));
      return {ok:true};
    };
    document.querySelector('[data-client-quote-agree]').click();
    for(let i=0;i<4;i++)await tick();
    assert.equal(calls.length,1);
    const saved=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0];
    assert.equal(saved.clientDecision,'agreed');
    assert.equal(saved.status,'Согласован');
    assert.equal(saved.total,quote.total);
    assert.equal(JSON.parse(localStorage.getItem('auto-sale-notes-v2'))['L-CLIENT'].length,1);
    assert.match(document.querySelector('.auto-client-quote').textContent,/Расчёт согласован/);
    delete window.__AUTO_SALE_ENTITY_BATCH__;
    dom.window.close();
  });

  test(origin+': changes request writes quote-only patch with comment',async()=>{
    const {dom,quote}=await boot(origin,'changes');
    const calls=[];
    window.__AUTO_SALE_ENTITY_BATCH__=async ops=>{calls.push(ops);return{ok:true}};
    document.querySelector('[data-client-quote-change]').click();
    await tick();
    document.querySelector('[data-client-quote-comment]').value='Уточнить стоимость и доставку';
    document.querySelector('[data-client-quote-send-change]').click();
    for(let i=0;i<4;i++)await tick();
    assert.equal(calls.length,1);
    assert.equal(calls[0].length,1);
    assert.equal(calls[0][0].id,quote.id);
    assert.equal(calls[0][0].input.clientDecision,'changes_requested');
    assert.equal(calls[0][0].input.clientComment,'Уточнить стоимость и доставку');
    assert.equal(JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0].clientDecision,'changes_requested');
    delete window.__AUTO_SALE_ENTITY_BATCH__;
    dom.window.close();
  });

  test(origin+': failed server decision does not pretend it was approved',async()=>{
    const {dom}=await boot(origin,'failure');
    window.__AUTO_SALE_ENTITY_BATCH__=async()=>{const e=new Error('entity_conflict');e.code='entity_conflict';throw e};
    document.querySelector('[data-client-quote-agree]').click();
    for(let i=0;i<4;i++)await tick();
    assert.equal(JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0].status,'Отправлен');
    assert.match(document.querySelector('[role="alert"]')?.textContent||'',/Расчёт обновился на сервере/);
    assert.ok(document.querySelector('[data-client-quote-agree]'));
    delete window.__AUTO_SALE_ENTITY_BATCH__;
    dom.window.close();
  });
}
test('decision access controls still require a quote belonging to the verified client',()=>{
  const lead={id:'L-CLIENT',clientProvider:'telegram',clientProviderUserId:'501',clientIdentityKey:'telegram:501'};
  const quote=quoteFor('США');
  const state={leads:[lead],quotes:[quote]};
  const request=[{resource:'quote',operation:'patch',id:quote.id,input:{clientDecision:'agreed',status:'Согласован',total:1}}];
  const accepted=sanitizeClientOperations(state,request,{id:501},{provider:'telegram',id:'501'});
  assert.equal(accepted.ok,true);
  assert.equal(accepted.operations[0].input.total,undefined,'client cannot forge the quote price');
  const denied=sanitizeClientOperations(state,request,{id:999},{provider:'telegram',id:'999'});
  assert.equal(denied.ok,false);
  assert.equal(denied.status,403);
});
test('consent rebase cannot approve an edited manager quote',()=>{
  const initial=quoteFor('США');
  const changed={...initial,total:55000,lot:54000,updatedAt:'2026-10-27T10:01:00Z'};
  const ops=[{resource:'quote',operation:'patch',id:initial.id,input:{status:'Согласован',clientDecision:'agreed'}}];
  const old={quotes:[initial]};
  assert.equal(canSafelyRebaseEntityBatch(ops,old,{quotes:[changed]}),false);
  assert.equal(canSafelyRebaseEntityBatch(ops,old,{quotes:[initial]}),true);
});
