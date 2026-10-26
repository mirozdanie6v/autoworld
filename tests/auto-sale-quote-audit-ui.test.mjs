import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedQuotes,seedOrders,seedTeam} from './fixtures/auto-sale-business.mjs';
test('new US quote editor preserves customs inputs without exposing private markup in UI',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent});
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads()));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  await import('../public/auto-sale-app-v3.mjs?quoteV2AuditUI='+Date.now());
  const root=document.querySelector('#app');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="quotes"]').click();
  root.querySelector('[data-new-quote]').click();
  let f=root.querySelector('#quoteForm');
  if(f.elements.origin.value!=='США'){
    f.elements.origin.value='США';
    f.elements.origin.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    f=root.querySelector('#quoteForm');
  }
  assert.equal(f.dataset.awgQuoteV2,'true');
  for(const key of ['manufactureDate','engineLiters','powerHp','customsAndRecyclingRub','cbrRubRate','vin'])assert.ok(f.elements[key],key);
  assert.ok(!f.elements.legalization&&!f.elements.service);
  assert.match(f.textContent,/Таможня \+ утильсбор РФ/);
  assert.match(f.textContent,/Минеральные Воды/);
  f.elements.manufactureDate.value='2024-01-15';
  f.elements.manufactureDate.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(f.elements.ageCategory,undefined);
  f.elements.lot.value='10000';
  f.elements.cbrRubRate.value='90';
  f.elements.exchangeRateDate.value='2026-10-22';
  f.elements.customsAndRecyclingRub.value='135000';
  f.elements.customsAndRecyclingRub.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.doesNotMatch(root.querySelector('#quoteCostPreview').textContent,/\+4%/);
  assert.match(root.querySelector('#quoteTotal').textContent,/10,000/);
  dom.window.close();
});
