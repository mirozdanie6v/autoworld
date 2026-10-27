import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedTeam} from './fixtures/auto-sale-business.mjs';
import {syncYdbState} from '../server/ydb-sync.mjs';
import {advancePercentForLead,advanceAmountFromPercent} from '../public/auto-sale-payment-balance.mjs';
import {buildUsPaymentPlan} from '../public/auto-sale-business-rules.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const quote=(origin='США')=>origin==='США'
 ?{id:'Q-3',leadId:'L-103',model:'Audi Q3',origin,status:'Согласован',version:1,
   quoteSchema:'awg-quote-us-simple-2026-10-26',
   tariffVersion:'2026-10-26-us-car-plus-repair',lot:50172.92,repair:1000,
   total:51172.92,customsAndRecyclingRub:0,auction:0,inland:0,ocean:0,
   cryptoFee:0,partsCost:0,customs:0,recyclingFee:0,legalization:0,
   service:0,georgiaDelivery:0,turnkeyDeliveryUsd:0}
 :{id:'Q-3',leadId:'L-103',model:'Audi Q3',origin,status:'Согласован',version:1,
   lot:1000,auction:200,inland:300,ocean:800,customs:500,repair:0,service:1400,
   total:4200,validUntil:'2026-12-30'};
const makeLead=(origin='США',overrides={})=>{
 const old=seedLeads().find(item=>item.id==='L-103');
 return{...old,id:'L-103',name:'Dmitrii Vladimirov',contact:'@dmitrii',model:'Audi Q3',
   origin,status:'Ожидает клиента',manager:'Дмитрий',source:'Telegram',
   nextAction:'2026-11-01',agreedOrderTotal:origin==='США'?60000:0,
   deposit:origin==='США'?30000:1000,depositPercent:origin==='США'?50:null,
   depositDate:'2026-10-27',paymentMethod:'Банк',...overrides};
};

test('50% default, editable percentage, and saved legacy deposit are cent-accurate',()=>{
 assert.equal(advancePercentForLead({},60000),50);
 assert.equal(advancePercentForLead({deposit:30000},60000),50);
 assert.equal(advanceAmountFromPercent(60000,50),30000);
 assert.equal(advanceAmountFromPercent(60000,40),24000);
 assert.equal(advanceAmountFromPercent(51172.92,50),25586.46);
 assert.equal(advancePercentForLead({depositPercent:40,deposit:30000},60000),40);
});

function makeStore(initial){
 let state=structuredClone(initial);
 return {
  async loadState(){return structuredClone(state)},
  async replaceState(next,{expectedRevision=null}={}){
   if(expectedRevision!==null&&Number(expectedRevision)!==Number(state.revision))
    return{status:409,data:{error:'revision_conflict',currentRevision:state.revision}};
   state={...structuredClone(next),revision:Number(state.revision)+1,initialized:true};
   return{status:200,data:{ok:true,revision:state.revision}};
  },
  snapshot(){return structuredClone(state)}
 };
}
for(const origin of ['США','Грузия']){
 test(origin+': server accepts first order from agreed quote and correctly recorded advance',async()=>{
  const lead=makeLead(origin),q=quote(origin),total=origin==='США'?60000:4200;
  const paymentPlan=origin==='США'?buildUsPaymentPlan({...q,total},lead.deposit):[];
  const order={
   id:'O-ORDER',leadId:lead.id,model:q.model,origin,stage:'Выкуп',
   total,cost:total,paid:lead.deposit,manager:'Дмитрий',riskType:'Нет',
   payments:[{id:'PAY-1',amount:lead.deposit,date:lead.depositDate,
     method:lead.paymentMethod,paymentStage:paymentPlan.length?'auction_deposit':''}],
   paymentPlan
  };
  const oldState={revision:7,initialized:true,leads:[lead],quotes:[q],orders:[],notes:{},
    catalog:[],team:[]};
  const store=makeStore(oldState);
  const input={...oldState,baseRevision:7,
    leads:[{...lead,status:'Сделка'}],orders:[order]};
  const response=await syncYdbState(store,input);
  assert.equal(response.status,200,JSON.stringify(response.data));
  assert.equal(store.snapshot().orders.length,1);
  assert.equal(store.snapshot().orders[0].stage,'Выкуп');
  assert.equal(store.snapshot().orders[0].total,total);
  assert.equal(store.snapshot().leads[0].status,'Сделка');
 });
}
test('server rejects mismatched agreed order total or fabricated advance percentage',async()=>{
 const lead=makeLead(),q=quote('США');
 const plan=buildUsPaymentPlan({...q,total:60000},lead.deposit);
 const order={id:'O-1',leadId:lead.id,model:q.model,origin:'США',stage:'Выкуп',
   total:51172.92,cost:51172.92,paid:30000,riskType:'Нет',
   paymentPlan:plan,payments:[{id:'PAY-1',amount:30000,date:'2026-10-27',
     method:'Банк',paymentStage:'auction_deposit'}]};
 const initial={revision:9,initialized:true,leads:[lead],quotes:[q],orders:[],notes:{},team:[],catalog:[]};
 const badPrice=await syncYdbState(makeStore(initial),{...initial,baseRevision:9,
   leads:[{...lead,status:'Сделка'}],orders:[order]});
 assert.equal(badPrice.data.error,'agreed_order_total_mismatch');
 const badPct=await syncYdbState(makeStore(initial),{...initial,baseRevision:9,
   leads:[{...lead,status:'Сделка',depositPercent:40}],
   orders:[{...order,total:60000,cost:60000}]});
 assert.equal(badPct.data.error,'auction_advance_percent_mismatch');
});

async function boot(origin,legacy=false){
 const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,
   localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
   FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
   MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,
   HTMLFormElement:dom.window.HTMLFormElement,EventTarget:dom.window.EventTarget,
   Element:dom.window.Element,Storage:dom.window.Storage});
 window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true,member:{name:'Дмитрий'}};
 const lead=makeLead(origin,legacy?{deposit:0,depositPercent:null}:{});
 localStorage.setItem('auto-sale-leads-v2',JSON.stringify([lead]));
 localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([quote(origin)]));
 localStorage.setItem('auto-sale-orders-v2','[]');
 localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
 localStorage.setItem('auto-sale-notes-v2','{}');
 localStorage.setItem('auto-sale-catalog-v1','[]');
 await import('../public/auto-sale-app-v3.mjs?create-order-'+origin+'-'+legacy);
 const root=document.querySelector('#app');
 root.querySelector('[data-go="leads"]').click();
 root.querySelector('[data-lead="L-103"]').click();
 const form=root.querySelector('#leadEditForm');
 assert.ok(form);
 return {dom,root,form};
}
test('USA: manager can change 50% advance to 40%; dollar amount updates and saves',async()=>{
 const{dom,root,form}=await boot('США',true);
 assert.equal(form.elements.depositPercent.value,'50');
 assert.equal(form.elements.deposit.value,'0');
 const calls=[];
 window.__AUTO_SALE_ENTITY_BATCH__=async ops=>{calls.push(ops);return{ok:true}};
 form.elements.agreedOrderTotal.value='60000';
 form.elements.agreedOrderTotal.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(form.elements.deposit.value,'30000');
 form.elements.depositPercent.value='40';
 form.elements.depositPercent.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(form.elements.deposit.value,'24000');
 form.elements.paymentMethod.value='Банк';
 form.querySelector('button[type="submit"]').click();
 await tick();await tick();
 const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2'))[0];
 assert.equal(saved.depositPercent,40);
 assert.equal(saved.deposit,24000);
 assert.equal(saved.agreedOrderTotal,60000);
 assert.equal(calls.length,1);
 delete window.__AUTO_SALE_ENTITY_BATCH__;dom.window.close();
});
for(const origin of ['США','Грузия']){
 test(origin+': first Create order click persists order, enters logistics, rejects duplicate clicks',async()=>{
  const{dom,root}=await boot(origin);
  const button=root.querySelector('[data-convert-order]');
  assert.equal(button.disabled,false,origin+': button is enabled');
  const batches=[];
  window.__AUTO_SALE_ENTITY_BATCH__=async ops=>{
   batches.push(ops);
   if(ops.some(x=>x.resource==='order')){await tick();assert.equal(ops.length,2)}
   return{ok:true};
  };
  button.click();button.click();
  for(let i=0;i<8;i++)await tick();
  const created=batches.filter(ops=>ops.some(x=>x.resource==='order'));
  assert.equal(created.length,1,origin+': only one order create');
  assert.deepEqual(created[0].map(x=>x.resource),['order','lead']);
  const order=JSON.parse(localStorage.getItem('auto-sale-orders-v2'))[0];
  assert.ok(order);
  assert.equal(order.stage,'Выкуп');
  assert.equal(order.total,origin==='США'?60000:4200,'contract total used for USA, quote total for Georgia');
  if(origin==='США'){
    assert.equal(order.advancePercent,50);
    assert.equal(order.payments[0].amount,30000);
    assert.equal(order.paymentPlan[0].amount,30000);
  }
  assert.ok(root.querySelector('#orderForm'),origin+': order modal opened');
  assert.equal(JSON.parse(localStorage.getItem('auto-sale-leads-v2'))[0].status,'Сделка');
  delete window.__AUTO_SALE_ENTITY_BATCH__;dom.window.close();
 });
}
test('server rejection appears beside Create order and does not scroll away/reset the form',async()=>{
 const{dom,root,form}=await boot('США');
 window.__AUTO_SALE_ENTITY_BATCH__=async()=>{const error=new Error('agreed_order_total_mismatch');error.code='agreed_order_total_mismatch';throw error};
 const button=root.querySelector('[data-convert-order]');
 button.click();await tick();await tick();
 assert.ok(button.isConnected);
 assert.equal(root.querySelector('#leadEditForm'),form);
 assert.match(root.querySelector('[data-order-create-feedback]')?.textContent||'',/Договорная цена отличается/);
 assert.equal(JSON.parse(localStorage.getItem('auto-sale-orders-v2')).length,0);
 assert.equal(button.disabled,false);
 delete window.__AUTO_SALE_ENTITY_BATCH__;dom.window.close();
});
