import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {advanceAmountFromPercent,advancePercentForLead,validAdvancePercent} from '../public/auto-sale-payment-balance.mjs';
import {canCreateOrder,buildUsPaymentPlan} from '../public/auto-sale-business-rules.mjs';
import {seedTeam} from './fixtures/auto-sale-business.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const quoteUSA={id:'Q-ADVANCE-1',leadId:'L-ADVANCE-1',model:'Audi Q3',origin:'США',version:1,status:'Согласован',
  quoteSchema:'awg-quote-us-simple-2026-10-26',tariffVersion:'2026-10-26-us-car-plus-repair',
  total:51172.92,lot:50172.92,repair:1000,customsAndRecyclingRub:0,
  auction:0,inland:0,ocean:0,cryptoFee:0,partsCost:0,customs:0,
  recyclingFee:0,legalization:0,service:0,georgiaDelivery:0,turnkeyDeliveryUsd:0};

function makeLead(origin,details={}){
  return{id:'L-ADVANCE-1',name:'Dmitrii Vladimirov',contact:'@client',
    model:'Audi Q3',origin,status:'Ожидает клиента',
    manager:'Дмитрий',source:'Telegram',budget:60000,priority:'Средний',
    nextAction:'2026-11-01',damage:'Минимальные',engine:'Не важно',drive:'Не важно',
    createdAt:'2026-10-27T10:00:00Z',yearFrom:'',yearTo:'',mileageMax:'',
    deliveryCity:'',agreedOrderTotal:60000,deposit:0,depositDate:'2026-10-27',
    paymentMethod:'Банк',note:'',...details};
}

async function setup(origin,details={}){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,
    HTMLFormElement:dom.window.HTMLFormElement,Element:dom.window.Element,
    EventTarget:dom.window.EventTarget,Storage:dom.window.Storage});
  window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true,member:{name:'Дмитрий'}};
  const lead=makeLead(origin,details);
  const quote=origin==='США'?{...quoteUSA}:{...quoteUSA,id:'Q-GEO-1',origin:'Грузия',quoteSchema:'',tariffVersion:'',total:42000,lot:36000,repair:1000,service:5000};
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify([lead]));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([quote]));
  localStorage.setItem('auto-sale-orders-v2','[]');
  localStorage.setItem('auto-sale-notes-v2','{}');
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  localStorage.setItem('auto-sale-catalog-v1','[]');
  const batches=[];
  window.__AUTO_SALE_ENTITY_BATCH__=async operations=>{batches.push(operations);return{ok:true};};
  await import('../public/auto-sale-app-v3.mjs?advance50-'+origin+'-'+String(details.deposit??0));
  const root=document.querySelector('#app');
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-ADVANCE-1"]').click();
  const form=root.querySelector('#leadEditForm');
  assert.ok(form);
  return{root,dom,form,batches};
}
test('50% defaults for a new lead; existing recorded advances preserve actual amount',()=>{
  assert.equal(advancePercentForLead({},60000),50);
  assert.equal(advanceAmountFromPercent(60000,50),30000);
  assert.equal(advanceAmountFromPercent(60000,40),24000);
  assert.equal(advanceAmountFromPercent(51172.92,50),25586.46);
  assert.equal(advanceAmountFromPercent(60000,58.333333),35000);
  assert.equal(advancePercentForLead({deposit:30000},60000),50);
  assert.equal(advancePercentForLead({deposit:30000},80000),37.5);
  assert.equal(validAdvancePercent(100),true);
  assert.equal(validAdvancePercent(0),false);
  assert.equal(validAdvancePercent(101),false);
});
test('USA preliminary price never determines editable advance or payment plan',()=>{
  const quote={...quoteUSA};
  assert.equal(canCreateOrder({quote,deposit:30000,depositPercent:50,agreedOrderTotal:60000}).ok,true);
  assert.equal(canCreateOrder({quote,deposit:25586.46,depositPercent:50,agreedOrderTotal:60000}).ok,false);
  const plan=buildUsPaymentPlan({...quote,total:60000},30000);
  assert.equal(plan.length,4);
  assert.equal(plan[0].amount,30000);
  assert.equal(plan[1].amount,30000);
});
test('USA manager edits 50% to 40%, recalculates amount, saves then creates ONE logistics order',async()=>{
  const {root,dom,form,batches}=await setup('США');
  assert.equal(form.elements.depositPercent.value,'50');
  assert.equal(form.elements.deposit.value,'30000');
  assert.equal(form.elements.deposit.readOnly,true);
  form.elements.depositPercent.value='40';
  form.elements.depositPercent.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(form.elements.deposit.value,'24000');
  assert.match(form.querySelector('[data-advance-calculation]').textContent,/24,000/);
  form.elements.agreedOrderTotal.value='80000';
  form.elements.agreedOrderTotal.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(form.elements.deposit.value,'32000');
  form.elements.paymentMethod.value='Банк';
  form.querySelector('button[type="submit"]').click();
  for(let i=0;i<4;i++)await tick();
  assert.equal(batches.length,1,'lead save must reach server');
  const persisted=JSON.parse(localStorage.getItem('auto-sale-leads-v2'))[0];
  assert.equal(persisted.depositPercent,40);
  assert.equal(persisted.deposit,32000);
  assert.equal(persisted.agreedOrderTotal,80000);
  const button=root.querySelector('[data-convert-order]');
  assert.ok(button,'order action is present');
  assert.equal(button.disabled,false);
  button.click();
  for(let i=0;i<5;i++)await tick();
  assert.equal(batches.length,2,'create order must send exactly one additional batch');
  const ops=batches[1];assert.deepEqual(ops.map(x=>x.resource),['order','lead']);
  assert.equal(ops[0].input.total,80000);
  assert.equal(ops[0].input.paid,32000);
  assert.equal(ops[0].input.payments[0].amount,32000);
  assert.equal(ops[0].input.advancePercent,40);
  assert.equal(ops[0].input.stage,'Выкуп');
  assert.equal(JSON.parse(localStorage.getItem('auto-sale-orders-v2')).length,1);
  assert.ok(root.querySelector('#orderForm'),'order modal should open inside logistics');
  delete window.__AUTO_SALE_ENTITY_BATCH__;
  dom.window.close();
});
test('legacy received USA advance opens at historical percentage, never overwrites it with 50%',async()=>{
  const {dom,form}=await setup('США',{deposit:30000,agreedOrderTotal:51172.92,depositPercent:null});
  assert.ok(Math.abs(Number(form.elements.depositPercent.value)-58.624)<0.02);
  assert.equal(form.elements.deposit.value,'30000');
  dom.window.close();
  delete window.__AUTO_SALE_ENTITY_BATCH__;
});
test('Georgia retains manual deposit entry and no percentage field',async()=>{
  const {dom,form}=await setup('Грузия',{deposit:4200});
  assert.equal(form.elements.depositPercent,undefined);
  assert.equal(form.elements.deposit.readOnly,false);
  assert.equal(Number(form.elements.deposit.value),4200);
  dom.window.close();
  delete window.__AUTO_SALE_ENTITY_BATCH__;
});
