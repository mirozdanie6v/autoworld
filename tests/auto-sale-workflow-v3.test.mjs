import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedTeam} from './fixtures/auto-sale-business.mjs';

const set=(root,selector,value)=>{const el=root.querySelector(selector);assert.ok(el,`missing ${selector}`);el.value=value;return el;};
const submit=(dom,form)=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));

test('USA Mini App workflow preserves separate preliminary and agreed contract totals',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://auto-sale.viiversion.com/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,
    sessionStorage:dom.window.sessionStorage,FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent});
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  await import('../public/auto-sale-app-v3.mjs?scenario='+Date.now());
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const root=document.querySelector('#app');
  root.querySelector('[data-open-request]').click();
  let form=root.querySelector('#requestForm');
  for(const [name,value] of Object.entries({name:'Тестовый клиент',contact:'@validated_client',model:'Audi Q5 2023',
    origin:'США',budget:'30000',yearFrom:'2020',yearTo:'2024',deliveryCity:'Москва'}))set(form,'[name="'+name+'"]',value);
  submit(dom,form);await tick();
  let lead=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(x=>x.contact==='@validated_client');
  assert.ok(lead);
  assert.equal(lead.budget,30000);assert.equal(lead.yearFrom,'2020');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="'+lead.id+'"]').click();
  form=root.querySelector('#leadEditForm');
  set(form,'[name="status"]','В работе');set(form,'[name="manager"]','Анна');
  set(form,'[name="nextAction"]','2026-10-27');
  submit(dom,form);await tick();
  root.querySelector('[data-create-quote="'+lead.id+'"]').click();
  form=root.querySelector('#quoteForm');
  assert.equal(form.elements.ageCategory,undefined);
  assert.equal(form.elements.verificationVin,undefined);
  for(const [name,value] of Object.entries({model:'Audi Q5 Premium Plus 2023',lot:'26000',repair:'1200',
    vin:'WAUZZZTEST1234567',engineLiters:'2',cbrRubRate:'100',exchangeRateDate:'2026-10-22',
    customsAndRecyclingRub:'620000',status:'Отправлен'}))set(form,'[name="'+name+'"]',value);
  submit(dom,form);await tick();await tick();
  let quote=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(x=>x.leadId===lead.id);
  assert.ok(quote,'new USA preliminary quote must save');
  assert.equal(quote.total,27200);
  assert.equal(quote.engineCc,2000);
  assert.equal(quote.customsAndRecyclingRub,620000);
  assert.equal(quote.cryptoFee,0);
  root.querySelector('[data-id="'+quote.id+'"][data-quote-action="На согласовании"]').click();
  root.querySelector('[data-id="'+quote.id+'"][data-quote-action="Согласован"]').click();
  await tick();
  quote=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(x=>x.id===quote.id);
  assert.equal(quote.status,'Согласован');
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="'+lead.id+'"]').click();
  form=root.querySelector('#leadEditForm');
  for(const [name,value] of Object.entries({agreedOrderTotal:'30000',depositDate:'2026-10-26',paymentMethod:'Банк'}))set(form,'[name="'+name+'"]',value);
  submit(dom,form);await tick();
  const convert=root.querySelector('[data-convert-order="'+lead.id+'"]');
  assert.ok(convert);
  assert.equal(convert.disabled,false);
  convert.click();await tick();
  let order=JSON.parse(localStorage.getItem('auto-sale-orders-v2')).find(x=>x.leadId===lead.id);
  assert.ok(order);
  assert.equal(order.total,30000);
  assert.equal(order.preliminaryTotal,27200);
  assert.equal(order.priceBasis,'agreed_contract');
  assert.equal(order.paid,15000);
  assert.equal(order.advancePercent,50);
  assert.deepEqual(order.paymentPlan.map(x=>x.amount),[15000,15000,0,0]);
  assert.equal(order.vin,'WAUZZZTEST1234567');
  form=root.querySelector('#orderForm');
  for(const [name,value] of Object.entries({stage:'Подготовка к отправке',lot:'998877',eta:'2026-11-15',
    location:'Long Beach, CA',paymentAmount:'15000',paymentDate:'2026-10-27',paymentMethod:'Банк'}))set(form,'[name="'+name+'"]',value);
  submit(dom,form);await tick();
  order=JSON.parse(localStorage.getItem('auto-sale-orders-v2')).find(x=>x.id===order.id);
  assert.equal(order.stage,'Подготовка к отправке');
  assert.equal(order.paid,30000);
  assert.equal(order.payments.length,2);
  assert.equal(order.paymentPlan[3].amount,0);
  root.querySelector('[data-role="client"]').click();
  root.querySelector('[data-go="orders"]').click();
  assert.match(root.textContent,/Audi Q5 Premium Plus 2023/);
  dom.window.close();
});
