import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function boot({valid=true,flush}={}){
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="app"></div><div data-client-detail-bg><div class="auto-tg-modal"><div class="auto-client-order-grid"></div><div class="auto-guide"><span></span></div><button data-tg-manager="L-TEST">Менеджер</button></div></div></body></html>',{url:'https://example.test/'});
  for(const key of ['window','document','localStorage','sessionStorage','FormData','Event','MouseEvent','CustomEvent','MutationObserver','HTMLFormElement','EventTarget','Element','Storage'])globalThis[key]=key==='window'?dom.window:dom.window[key];
  globalThis.confirm=()=>true;
  const quote={id:'Q-TEST',leadId:'L-TEST',model:'TEST BMW',origin:'США',status:'Отправлен',version:1,lot:10000,auction:500,inland:500,ocean:1000,customs:1000,repair:0,service:1000,total:14000,validUntil:'2026-12-01',verification:valid?{lotNumber:'TEST',vin:'TESTVIN1234567890',year:2022,mileage:1000,damage:'Тест',photos:['https://example.test/test.jpg'],history:'Тестовые данные',checkedAt:'2026-09-28',result:'Одобрен к покупке'}:{}};
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify([{id:'L-TEST',name:'TEST',contact:'@Flyer_Flyer',model:'TEST BMW',status:'Ожидает клиента',nextAction:'2026-10-01',clientCreated:true}]));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([quote]));
  for(const key of ['auto-sale-orders-v2','auto-sale-team-v1'])localStorage.setItem(key,'[]');
  localStorage.setItem('auto-sale-notes-v2','{}');
  window.__AUTO_SALE_FLUSH__=flush||(async()=>({ok:true}));
  const tag=Math.random();
  await import(`../public/auto-sale-app-v3.mjs?integration=${tag}`);
  await import(`../public/auto-sale-client-quote.mjs?integration=${tag}`);
  await tick();
  return dom;
}

test('client approval with the real app persists decision and survives later manager saves',async()=>{
  const dom=await boot();
  document.querySelector('[data-client-quote-agree]').click();await tick();
  let quote=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0];
  assert.equal(quote.status,'Согласован');assert.equal(quote.clientDecision,'agreed');
  assert.equal(document.querySelector('#quoteForm'),null);
  assert.match(document.querySelector('.auto-client-quote').textContent,/Расчёт согласован/);
  document.querySelector('[data-role="manager"]').click();
  document.querySelector('[data-go="leads"]').click();
  document.querySelector('[data-lead="L-TEST"]').click();
  document.querySelector('#leadEditForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  quote=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0];
  assert.equal(quote.clientDecision,'agreed');
  dom.window.close();
});

test('incomplete dossier shows client error without changing status or opening a manager form',async()=>{
  const dom=await boot({valid:false});
  document.querySelector('[data-client-quote-agree]').click();await tick();
  assert.equal(JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0].status,'Отправлен');
  assert.match(document.querySelector('[role="alert"]').textContent,/Менеджеру нужно завершить проверку/);
  assert.equal(document.querySelector('#quoteForm'),null);
  dom.window.close();
});

test('server rejection restores an actionable quote and displays a retry error',async()=>{
  const dom=await boot({flush:async()=>({ok:false,error:'offline'})});
  document.querySelector('[data-client-quote-agree]').click();
  for(let i=0;i<12;i++){
    await tick();
    if(JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0].status==='Отправлен')break;
  }
  assert.equal(JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0].status,'Отправлен');
  assert.ok(document.querySelector('[data-client-quote-agree]'));
  assert.match(document.querySelector('[role="alert"]').textContent,/не сохранено на сервере/);
  dom.window.close();
});
