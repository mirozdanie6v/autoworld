import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedTeam} from './fixtures/auto-sale-business.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function prepare({existingDeposit=0,agreedOrderTotal=60000,origin='США',label='a'}={}){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,
    HTMLFormElement:dom.window.HTMLFormElement,Element:dom.window.Element,
    EventTarget:dom.window.EventTarget,Storage:dom.window.Storage});
  window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true,member:{name:'Дмитрий'}};
  const lead={...seedLeads().find(x=>x.id==='L-103'),status:'Ожидает клиента',origin,model:'Audi Q3',
    agreedOrderTotal,deposit:existingDeposit,depositDate:existingDeposit?'2026-10-26':'',paymentMethod:existingDeposit?'Банк':''};
  const quote={id:'Q-US-ADVANCE',leadId:lead.id,model:'Audi Q3',origin,version:1,status:'Согласован',
    quoteSchema:'awg-quote-us-simple-2026-10-26',tariffVersion:'2026-10-26-us-car-plus-repair',
    lot:50172.92,repair:1000,total:51172.92};
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify([lead]));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([quote]));
  localStorage.setItem('auto-sale-orders-v2','[]');
  localStorage.setItem('auto-sale-notes-v2','{}');
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  await import('../public/auto-sale-app-v3.mjs?advance-ui='+label);
  const root=document.querySelector('#app');
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-103"]').click();
  const form=root.querySelector('#leadEditForm');
  assert.ok(form,'lead edit form visible');
  return {dom,root,form,lead,quote};
}

test('manager can edit 50% default and automatic deposit without changing preliminary quote',async()=>{
  const {dom,form,root,quote}=await prepare({label:'fifty'});
  assert.equal(form.elements.depositPercent.value,'50');
  assert.equal(form.elements.deposit.value,'30000');
  assert.equal(form.elements.deposit.readOnly,true);
  form.elements.depositPercent.value='40';
  form.elements.depositPercent.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(form.elements.deposit.value,'24000');
  form.elements.agreedOrderTotal.value='51172.92';
  form.elements.agreedOrderTotal.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(form.elements.deposit.value,'20469.17');
  form.elements.agreedOrderTotal.value='60000';
  form.elements.agreedOrderTotal.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(form.elements.deposit.value,'24000');
  form.elements.depositDate.value='2026-10-27';
  form.elements.paymentMethod.value='Банк';
  const operations=[];
  window.__AUTO_SALE_ENTITY_BATCH__=async batch=>{operations.push(batch);return {ok:true}};
  form.querySelector('button[type="submit"]').click();
  await tick();await tick();
  const stored=JSON.parse(localStorage.getItem('auto-sale-leads-v2'))[0];
  assert.equal(stored.depositPercent,40);
  assert.equal(stored.deposit,24000);
  assert.equal(stored.agreedOrderTotal,60000);
  assert.equal(JSON.parse(localStorage.getItem('auto-sale-quotes-v2'))[0].total,quote.total);
  assert.ok(operations.some(batch=>batch.some(op=>op.resource==='lead')));
  delete window.__AUTO_SALE_ENTITY_BATCH__;
  dom.window.close();
});

test('the saved 50% advance creates an order at first click in logistics',async()=>{
  const {dom,root,form}=await prepare({label:'create'});
  form.elements.depositDate.value='2026-10-27';
  form.elements.paymentMethod.value='Банк';
  const batches=[];
  window.__AUTO_SALE_ENTITY_BATCH__=async operations=>{batches.push(operations);return {ok:true}};
  form.querySelector('button[type="submit"]').click();
  await tick();await tick();
  const convert=root.querySelector('[data-convert-order="L-103"]');
  assert.ok(convert);
  assert.equal(convert.disabled,false,'saved percent and sum should unlock creation');
  convert.click();
  await tick();await tick();await tick();
  const orders=JSON.parse(localStorage.getItem('auto-sale-orders-v2'));
  assert.equal(orders.length,1,'one order only');
  assert.equal(orders[0].stage,'Выкуп');
  assert.equal(orders[0].total,60000);
  assert.equal(orders[0].payments[0].amount,30000);
  assert.equal(orders[0].paymentPlan[0].amount,30000);
  assert.equal(orders[0].advancePercent,50);
  assert.ok(root.querySelector('#orderForm'),'opens order in logistics');
  assert.ok(batches.some(batch=>batch.some(x=>x.resource==='order'&&x.operation==='create')));
  delete window.__AUTO_SALE_ENTITY_BATCH__;
  dom.window.close();
});

test('existing $30,000 does not silently recalculate to 50% of original quote',async()=>{
  const {dom,form}=await prepare({existingDeposit:30000,agreedOrderTotal:51172.92,label:'historical'});
  assert.equal(form.elements.deposit.value,'30000');
  assert.ok(Math.abs(Number(form.elements.depositPercent.value)-58.624757)<0.00001);
  dom.window.close();
});
