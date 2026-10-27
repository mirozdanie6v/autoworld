import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedTeam} from './fixtures/auto-sale-business.mjs';
import {orderPaymentBalance,usdCents,usdMoney} from '../public/auto-sale-payment-balance.mjs';
import {validateOrder} from '../server/auto-sale-rules.mjs';
import {paymentStageState,nextPaymentStage,paymentsTotal} from '../public/auto-sale-business-rules.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const paidPayments=[
  {id:'PAY-1',amount:10000,date:'2026-10-20',method:'Банк'},
  {id:'PAY-2',amount:5000,date:'2026-10-27',method:'Наличные'},
  {id:'PAY-3',amount:5199,date:'2026-10-27',method:'Наличные'}
];
const makeOrder=(origin,override={})=>({
  id:'O-HANDOFF',leadId:'L-103',customer:'Клиент',model:'BMW X5',origin,
  manager:'Дмитрий',stage:'Доставка',total:20199,cost:19500,
  paid:20198.999999996, // old cached floating-point balance
  payments:paidPayments.map(p=>({...p})),paymentPlan:[],
  lot:origin==='США'?'111111':'',vin:'JH4KA9650MC001234',
  eta:'2026-11-02',location:origin==='США'?'Москва, автовоз':'Тбилиси, склад',
  risk:'Нет',riskType:'Нет',riskNote:'',...override
});

test('cent-accurate ledger prevents phantom $0 remaining and displays real cents',()=>{
  const full=makeOrder('Грузия');
  assert.deepEqual([orderPaymentBalance(full).paidCents,orderPaymentBalance(full).remainingCents],[2019900,0]);
  assert.equal(orderPaymentBalance(full).fullyPaid,true);
  const short=makeOrder('США',{payments:[...paidPayments.slice(0,2),{...paidPayments[2],amount:5198.99}]});
  assert.equal(orderPaymentBalance(short).remainingCents,1);
  assert.equal(orderPaymentBalance(short).fullyPaid,false);
  assert.equal(usdMoney(orderPaymentBalance(short).remaining),'$0.01');
  assert.equal(usdCents(0.1+0.2),30);
  assert.equal(usdMoney(20199),'$20,199');
});
test('server validates exact ledger amount for USA and Georgia final delivery',()=>{
  for(const origin of ['США','Грузия']){
    assert.deepEqual(validateOrder({...makeOrder(origin),stage:'Выдача'},'Доставка'),[],origin+' full payment');
    assert.ok(validateOrder({...makeOrder(origin,{payments:[...paidPayments.slice(0,2),{...paidPayments[2],amount:5198.99}]}),stage:'Выдача'},'Доставка').includes('full_payment_required_for_handoff'),origin+' one-cent short');
  }
});
test('payment plan fractions do not leave phantom incomplete stage',()=>{
  const stage={id:'auction_balance',amount:0.3};
  const payments=[{paymentStage:'auction_balance',amount:0.1},{paymentStage:'auction_balance',amount:0.2}];
  assert.equal(paymentStageState(stage,payments).remaining,0);
  assert.equal(nextPaymentStage([stage],payments),null);
  assert.equal(paymentsTotal(payments),0.3);
});

async function boot(origin,short=false){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,
    HTMLFormElement:dom.window.HTMLFormElement,Element:dom.window.Element,
    EventTarget:dom.window.EventTarget,Storage:dom.window.Storage});
  window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true,member:{name:'Дмитрий'}};
  const payments=short?[...paidPayments.slice(0,2),{...paidPayments[2],amount:5198.99}]:paidPayments;
  const order=makeOrder(origin,{payments});
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads().filter(x=>x.id==='L-103').map(x=>({...x,status:'Сделка',origin}))));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify([order]));
  localStorage.setItem('auto-sale-quotes-v2','[]');
  localStorage.setItem('auto-sale-notes-v2','{}');
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  localStorage.setItem('auto-sale-catalog-v1','[]');
  await import('../public/auto-sale-app-v3.mjs?handoff-'+origin+'-'+short);
  await import('../public/auto-sale-ui-business-guard.mjs?handoff-'+origin+'-'+short);
  const root=document.querySelector('#app');
  root.querySelector('[data-go="shipping"]').click();
  root.querySelector('[data-order="O-HANDOFF"]').click();
  await tick();await tick();
  const form=root.querySelector('#orderForm'),btn=root.querySelector('[data-order-next="O-HANDOFF"]');
  assert.ok(form&&btn);
  return{dom,root,form,btn,order};
}

for(const origin of ['США','Грузия']){
  test(origin+': full ledger unlocks first-click handoff and saves one stage update',async()=>{
    const{dom,root,btn}=await boot(origin);
    assert.equal(btn.disabled,false,'$0 remaining must not disable handoff');
    assert.match(root.querySelector('.auto-order-help')?.textContent||'',/Можно переходить в «Выдача»/);
    const batches=[];window.__AUTO_SALE_ENTITY_BATCH__=async ops=>{batches.push(ops);return{ok:true}};
    btn.click();await tick();await tick();
    assert.equal(batches.length,1);
    assert.equal(batches[0].find(x=>x.resource==='order')?.input?.stage,'Выдача');
    assert.equal(JSON.parse(localStorage.getItem('auto-sale-orders-v2'))[0].stage,'Выдача');
    assert.ok(root.querySelector('#orderForm'));
    delete window.__AUTO_SALE_ENTITY_BATCH__;
    dom.window.close();
  });
  test(origin+': real one-cent remainder blocks handoff and explains $0.01',async()=>{
    const{dom,root,btn}=await boot(origin,true);
    assert.equal(btn.disabled,true);
    assert.match(root.querySelector('.auto-order-help')?.textContent||'',/\$0\.01/);
    assert.match(root.textContent,/\$0\.01/);
    dom.window.close();
  });
}
