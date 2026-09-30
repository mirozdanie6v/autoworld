import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedBusinessStorage} from './fixtures/auto-sale-business.mjs';

async function setup(tag){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://auto-sale.viiversion.com/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;globalThis.sessionStorage=dom.window.sessionStorage;globalThis.FormData=dom.window.FormData;globalThis.Event=dom.window.Event;globalThis.CustomEvent=dom.window.CustomEvent;
  seedBusinessStorage(localStorage);
  await import(`../public/auto-sale-app-v3.mjs?${tag}=${Date.now()}-${Math.random()}`);
  return{dom,root:document.querySelector('#app')};
}
const active=(root,id)=>root.querySelector(`.auto-bottom [data-go="${id}"]`)?.classList.contains('active');
const submit=(dom,form)=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));

test('every role navigation button opens its current v3 business screen',async()=>{
  const {dom,root}=await setup('routes');
  for(const id of ['home','catalog','orders','about']){root.querySelector(`.auto-bottom [data-go="${id}"]`).click();assert.equal(active(root,id),true,id)}
  root.querySelector('[data-role="manager"]').click();
  for(const id of ['work','leads','quotes','shipping']){root.querySelector(`.auto-bottom [data-go="${id}"]`).click();assert.equal(active(root,id),true,id)}
  root.querySelector('[data-role="owner"]').click();
  for(const id of ['overview','pipeline','finance','ordersAdmin']){root.querySelector(`.auto-bottom [data-go="${id}"]`).click();assert.equal(active(root,id),true,id)}
  dom.window.close();
});

test('client request detail and close buttons are wired',async()=>{
  const {dom,root}=await setup('client-buttons');
  root.querySelector('[data-open-request]').click();assert.ok(root.querySelector('#requestForm'));
  root.querySelector('[data-close]').click();assert.equal(root.querySelector('#requestForm'),null);
  root.querySelector('[data-go="catalog"]').click();
  root.querySelector('[data-detail]').click();assert.ok(root.querySelector('.auto-modal'));
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.querySelector('.auto-modal'),null);
  root.querySelector('[data-request-car]').click();const form=root.querySelector('#requestForm');assert.ok(form);assert.ok(form.querySelector('[name="model"]').value.length>0);
  dom.window.close();
});

test('manager buttons open new lead lead quote and order workflows',async()=>{
  const {dom,root}=await setup('manager-buttons');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-manager-new]').click();let form=root.querySelector('#requestForm');assert.ok(form);assert.ok(form.querySelector('[name="source"]'));root.querySelector('[data-close]').click();
  root.querySelector('[data-go="leads"]').click();root.querySelector('[data-lead="L-101"]').click();assert.ok(root.querySelector('#leadEditForm'));assert.ok(root.querySelector('[data-create-quote="L-101"]'));root.querySelector('[data-close]').click();
  root.querySelector('[data-go="quotes"]').click();root.querySelector('[data-quote="Q-501"]').click();assert.ok(root.querySelector('#quoteForm'));root.querySelector('[data-close]').click();
  root.querySelector('[data-go="shipping"]').click();root.querySelector('[data-order="O-2301"]').click();assert.ok(root.querySelector('#orderForm'));assert.ok(root.querySelector('[data-order-next="O-2301"]'));root.querySelector('[data-close]').click();
  dom.window.close();
});

test('deal and refusal lead statuses are terminal in the manager UI',async()=>{
  const {dom,root}=await setup('terminal-leads');
  root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-104"]').click();let options=[...root.querySelector('#leadStatus').options].map(x=>x.value);assert.deepEqual(options,['Сделка']);root.querySelector('[data-close]').click();
  root.querySelector('[data-lead="L-107"]').click();options=[...root.querySelector('#leadStatus').options].map(x=>x.value);assert.deepEqual(options,['Отказ']);
  dom.window.close();
});

test('terminal quote is read-only and clone creates a new draft version',async()=>{
  const {dom,root}=await setup('quote-clone');
  root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="quotes"]').click();root.querySelector('[data-quote="Q-504"]').click();
  assert.equal(root.querySelector('#quoteForm'),null);const clone=root.querySelector('[data-clone-quote="Q-504"]');assert.ok(clone);clone.click();
  const quotes=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')),original=quotes.find(x=>x.id==='Q-504'),copy=quotes.find(x=>x.revisionOf==='Q-504');
  assert.equal(original.status,'Согласован');assert.ok(copy);assert.equal(copy.status,'Черновик');assert.equal(copy.version,2);assert.ok(root.querySelector('#quoteForm'));
  dom.window.close();
});

test('order rejects payment above remaining balance',async()=>{
  const {dom,root}=await setup('overpayment');
  root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="shipping"]').click();root.querySelector('[data-order="O-2301"]').click();
  const form=root.querySelector('#orderForm'),before=JSON.parse(localStorage.getItem('auto-sale-orders-v2')).find(x=>x.id==='O-2301');
  form.querySelector('[name="paymentAmount"]').value='12000';form.querySelector('[name="paymentDate"]').value='2026-09-12';submit(dom,form);
  const after=JSON.parse(localStorage.getItem('auto-sale-orders-v2')).find(x=>x.id==='O-2301');assert.equal(after.paid,before.paid);assert.match(form.textContent,/больше остатка/);
  dom.window.close();
});

test('order next button advances exactly one stage and owner sees the same order read-only',async()=>{
  const {dom,root}=await setup('order-next');
  root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="shipping"]').click();root.querySelector('[data-order="O-2301"]').click();
  root.querySelector('[data-order-next="O-2301"]').click();const order=JSON.parse(localStorage.getItem('auto-sale-orders-v2')).find(x=>x.id==='O-2301');assert.equal(order.stage,'Таможня');
  root.querySelector('[data-role="owner"]').click();root.querySelector('[data-go="ordersAdmin"]').click();root.querySelector('[data-order="O-2301"]').click();assert.equal(root.querySelector('#orderForm'),null);assert.match(root.textContent,/КОНТРОЛЬ/);
  dom.window.close();
});
