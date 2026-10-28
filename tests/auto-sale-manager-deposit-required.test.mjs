import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedTeam} from './fixtures/auto-sale-business.mjs';

function setup(origin,tag){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{
    window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,
    HTMLFormElement:dom.window.HTMLFormElement,Element:dom.window.Element,
    EventTarget:dom.window.EventTarget,Storage:dom.window.Storage
  });
  window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true,member:{name:'Дмитрий'}};
  const lead={...seedLeads().find(item=>item.id==='L-103'),
    status:'Ожидает клиента',origin,deposit:0,depositDate:'',paymentMethod:'',agreedOrderTotal:60000};
  const quote={
    id:'Q-REQUIRED-'+tag,leadId:lead.id,origin,status:'Согласован',
    model:lead.model,total:origin==='США'?51172.92:44000,version:1,
    ...(origin==='США'?{
      quoteSchema:'awg-quote-us-simple-2026-10-26',
      tariffVersion:'2026-10-26-us-car-plus-repair'
    }:{})
  };
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify([lead]));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([quote]));
  localStorage.setItem('auto-sale-orders-v2','[]');
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  localStorage.setItem('auto-sale-notes-v2','{}');
  return {dom,lead,quote};
}

async function openLead(tag){
  await import('../public/auto-sale-app-v3.mjs?required-deposit-'+tag);
  const root=document.querySelector('#app');
  const manager=root.querySelector('[data-role="manager"]');
  if(manager)manager.click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-103"]').click();
  const form=root.querySelector('#leadEditForm');
  assert.ok(form,'manager lead form opens');
  return{form,root};
}

test('USA: required deposit controls visually stand out and auto-compute 50% of contract price',async()=>{
  const {dom}=setup('США','us');
  const{form}=await openLead('us');
  for(const name of ['depositPercent','deposit','depositDate','paymentMethod','agreedOrderTotal']){
    const field=form.elements[name];
    assert.ok(field,'missing '+name);
    assert.equal(field.required,true,name+' must be mandatory');
    assert.ok(field.closest('label').classList.contains('auto-required-field'),name+' must be highlighted');
    assert.ok(field.closest('label').querySelector('.auto-required-caption b'),name+' must carry an asterisk');
  }
  assert.equal(form.elements.depositPercent.value,'50');
  assert.equal(form.elements.deposit.value,'30000');
  assert.equal(form.elements.deposit.readOnly,true);
  assert.equal(form.elements.depositDate.value,'','real payment date must not be auto-invented');
  assert.equal(form.elements.paymentMethod.value,'');
  assert.equal(form.checkValidity(),false);
  form.elements.depositPercent.value='40';
  form.elements.depositPercent.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(form.elements.deposit.value,'24000');
  form.elements.agreedOrderTotal.value='45000';
  form.elements.agreedOrderTotal.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(form.elements.deposit.value,'18000');
  form.elements.depositDate.value='2026-10-27';
  form.elements.paymentMethod.value='Банк';
  assert.equal(form.checkValidity(),true);
  dom.window.close();
});

test('Georgia: amount, date and payment method are mandatory; auction percentage is absent',async()=>{
  const {dom}=setup('Грузия','ge');
  const{form}=await openLead('ge');
  assert.equal(form.elements.depositPercent,undefined);
  for(const name of ['deposit','depositDate','paymentMethod']){
    const field=form.elements[name];
    assert.ok(field,'missing '+name);
    assert.equal(field.required,true);
    assert.ok(field.closest('label').classList.contains('auto-required-field'));
  }
  assert.equal(form.elements.deposit.value,'0');
  assert.equal(form.elements.depositDate.value,'');
  assert.equal(form.checkValidity(),false);
  form.elements.deposit.value='4000';
  form.elements.depositDate.value='2026-10-27';
  form.elements.paymentMethod.value='Наличные';
  assert.equal(form.checkValidity(),true);
  dom.window.close();
});

test('ordinary lead without an agreed quote is not forced to enter a deposit',async()=>{
  const {dom}=setup('Грузия','ordinary');
  localStorage.setItem('auto-sale-quotes-v2','[]');
  const{form}=await openLead('ordinary');
  for(const name of ['deposit','depositDate','paymentMethod']){
    const field=form.elements[name];
    assert.ok(field);
    assert.equal(field.type,'hidden');
    assert.equal(field.required,false);
  }
  assert.equal(form.querySelector('.auto-required-explainer'),null);
  dom.window.close();
});
