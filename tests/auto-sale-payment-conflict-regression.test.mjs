import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedTeam} from './fixtures/auto-sale-business.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function boot(origin,tag){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,
    HTMLFormElement:dom.window.HTMLFormElement,Element:dom.window.Element,
    EventTarget:dom.window.EventTarget,Storage:dom.window.Storage});
  window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true,member:{name:'Дмитрий'}};
  const id='O-PAY-'+tag;
  const order={
    id,leadId:'L-103',customer:'Тест оплаты',model:'Toyota RAV4',
    origin,manager:'Дмитрий',stage:'Доставка',source:'Telegram',
    total:12000,cost:11000,paid:6801,
    lot:origin==='США'?'12345':'',vin:'JH4KA9650MC001234',
    eta:'2026-11-27',location:origin==='США'?'Порт прибытия':'Тбилиси',
    riskType:'Нет',riskNote:'',risk:'Нет',
    paymentPlan:[],payments:[{id:'PAY-1',amount:6801,date:'2026-10-20',method:'Банк'}]
  };
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify([order]));
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads().filter(x=>x.id==='L-103').map(x=>({...x,origin,status:'Сделка'}))));
  localStorage.setItem('auto-sale-quotes-v2','[]');
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  localStorage.setItem('auto-sale-notes-v2','{}');
  await import('../public/auto-sale-app-v3.mjs?pay409-'+tag);
  const root=document.querySelector('#app');
  root.querySelector('[data-go="shipping"]').click();
  root.querySelector('[data-order="'+id+'"]').click();
  const form=root.querySelector('#orderForm');
  assert.ok(form);
  assert.equal(form.elements.paymentAmount.value,'0');
  return{dom,root,form,order};
}

for(const origin of ['США','Грузия']){
  test(origin+': payment save creates one child, not redundant order and lead patches',async()=>{
    const {dom,root,form,order}=await boot(origin,'save-'+origin);
    const batches=[];
    window.__AUTO_SALE_ENTITY_BATCH__=async operations=>{
      batches.push(operations);
      return{ok:true,rowVersions:{['order:'+order.id]:4}};
    };
    form.elements.paymentAmount.value='5199';
    form.elements.paymentNote.value='Окончательный платёж';
    form.querySelector('button[type="submit"]').click();
    await tick();await tick();
    assert.equal(batches.length,1);
    assert.deepEqual(batches[0].map(x=>x.resource),['payment'],'payment-only cannot update unrelated lead');
    assert.equal(batches[0][0].input.amount,5199);
    const saved=JSON.parse(localStorage.getItem('auto-sale-orders-v2'))[0];
    assert.equal(saved.paid,12000);
    assert.equal(saved.payments.length,2);
    assert.equal(saved.payments[1].amount,5199);
    assert.equal(saved.stage,'Доставка');
    assert.ok(root.querySelector('#orderForm'));
    delete window.__AUTO_SALE_ENTITY_BATCH__;
    dom.window.close();
  });

  test(origin+': 409 preserves the entered amount and manager order modal',async()=>{
    const {dom,root,form,order}=await boot(origin,'conflict-'+origin);
    const rejected=[];
    window.__AUTO_SALE_ENTITY_BATCH__=async operations=>{
      rejected.push(operations);
      // A 409 handler fetches a fresh server snapshot while the save is pending.
      window.dispatchEvent(new dom.window.CustomEvent('auto-sale-server-synced'));
      await tick();
      window.dispatchEvent(new dom.window.CustomEvent('auto-sale-entity-conflict'));
      const err=new Error('entity_conflict');err.code='entity_conflict';throw err;
    };
    form.elements.paymentAmount.value='5199';
    form.elements.paymentNote.value='Оплата наличными';
    form.querySelector('button[type="submit"]').click();
    await tick();await tick();await tick();
    const live=root.querySelector('#orderForm');
    assert.ok(live,'modal must remain open after conflict');
    assert.equal(live.elements.paymentAmount.value,'5199','unsaved payment amount must not reset');
    assert.equal(live.elements.paymentNote.value,'Оплата наличными');
    assert.match(live.querySelector('.auto-form-error')?.textContent||'',/Данные на сервере обновились/);
    assert.equal(rejected.length,1);
    assert.equal(JSON.parse(localStorage.getItem('auto-sale-orders-v2'))[0].paid,6801,'failed payment must not be added');
    delete window.__AUTO_SALE_ENTITY_BATCH__;
    dom.window.close();
  });
}
