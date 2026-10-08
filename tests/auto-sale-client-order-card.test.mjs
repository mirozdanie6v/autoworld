import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

test('client order card renders details action in the first core render',async()=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>',{url:'https://example.test/'});
  for(const key of ['window','document','localStorage','sessionStorage','FormData','Event','MouseEvent','CustomEvent','MutationObserver','HTMLFormElement','EventTarget','Element','Storage']){
    globalThis[key]=key==='window'?dom.window:dom.window[key];
  }

  localStorage.setItem('auto-sale-leads-v2',JSON.stringify([{
    id:'L-IMMEDIATE',
    name:'VK Client',
    contact:'https://vk.com/id1',
    model:'Buick Encore',
    budget:10000,
    source:'Mini App',
    manager:'',
    status:'Ожидает клиента',
    priority:'Средний',
    createdAt:'2026-10-08T06:05:29.848Z',
    nextAction:'2026-10-09',
    clientCreated:true,
    clientProvider:'vk',
    clientProviderUserId:'1',
    clientIdentityKey:'vk:1',
    origin:'Грузия',
    yearFrom:2021,
    yearTo:2026,
    mileageMax:''
  }]));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([{
    id:'Q-IMMEDIATE',
    leadId:'L-IMMEDIATE',
    model:'Buick Encore',
    origin:'Грузия',
    status:'Отправлен',
    version:1,
    lot:20000,
    auction:0,
    inland:500,
    ocean:1000,
    customs:1000,
    repair:0,
    service:1000,
    total:23500,
    validUntil:'2026-10-15'
  }]));
  localStorage.setItem('auto-sale-orders-v2','[]');
  localStorage.setItem('auto-sale-notes-v2','{}');
  localStorage.setItem('auto-sale-team-v1','[]');
  localStorage.setItem('auto-sale-catalog-v1','[]');

  await import(`../public/auto-sale-app-v3.mjs?immediate=${Date.now()}`);
  const ordersTab=document.querySelector('[data-go="orders"]');
  assert.ok(ordersTab);
  ordersTab.click();

  const card=document.querySelector('.auto-order-card[data-client-lead="L-IMMEDIATE"]');
  assert.ok(card);
  assert.equal(card.getAttribute('role'),'button');
  assert.equal(card.getAttribute('tabindex'),'0');
  assert.match(card.textContent,/Открыть подробности/);
  assert.equal(card.querySelectorAll('.auto-order-open-hint').length,1);

  dom.window.close();
});
