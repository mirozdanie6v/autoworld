import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function setup(suffix){
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>',{url:'https://vk-test.awgcars.ru/'});
  globalThis.window=dom.window;
  globalThis.document=dom.window.document;
  globalThis.localStorage=dom.window.localStorage;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.FormData=dom.window.FormData;
  globalThis.Event=dom.window.Event;
  globalThis.CustomEvent=dom.window.CustomEvent;
  globalThis.MutationObserver=dom.window.MutationObserver;
  globalThis.HTMLFormElement=dom.window.HTMLFormElement;
  globalThis.EventTarget=dom.window.EventTarget;
  globalThis.Element=dom.window.Element;
  globalThis.Node=dom.window.Node;
  window.__AUTO_SALE_ACCESS__={role:'client',authenticated:true,authType:'vk-web',identity:{provider:'vk',id:'42',key:'vk:42'}};
  localStorage.setItem('auto-sale-leads-v2','[]');
  localStorage.setItem('auto-sale-quotes-v2','[]');
  localStorage.setItem('auto-sale-orders-v2','[]');
  localStorage.setItem('auto-sale-team-v1','[]');
  localStorage.setItem('auto-sale-catalog-v1','[]');
  await import('../public/auto-sale-app-v3.mjs?request-submit-'+suffix);
  await import('../public/auto-sale-request-submit-feedback.mjs?request-submit-'+suffix);
  const root=document.getElementById('app');
  root.querySelector('[data-open-request]').click();
  const form=root.querySelector('#requestForm');
  assert.ok(form);
  return{dom,root,form};
}

test('invalid browser VK request button shows actionable field error instead of silent no-op',async()=>{
  const {dom,form}=await setup('invalid');
  let batches=0;
  window.__AUTO_SALE_ENTITY_BATCH__=async()=>{batches++;return{ok:true}};
  const button=form.querySelector('button[type="submit"]');
  button.click();
  await tick();
  assert.equal(batches,0);
  assert.match(form.querySelector('[data-client-submit-feedback]')?.textContent||'',/марку|имя|обязательное/);
  assert.ok(form.querySelector('input[name="name"]').classList.contains('auto-field-blocked'));
  dom.window.close();
});

test('valid VK browser request reaches entity API and navigates to own orders',async()=>{
  const {dom,root,form}=await setup('valid');
  const submitted=[];
  window.__AUTO_SALE_ENTITY_BATCH__=async ops=>{submitted.push(ops);await tick();return{ok:true,revision:100}};
  form.elements.namedItem('name').value='Тестовый пользователь';
  form.elements.namedItem('contact').value='https://vk.com/id42';
  form.elements.namedItem('model').value='Toyota Camry — тест VK ID';
  form.elements.namedItem('origin').value='Грузия';
  form.elements.namedItem('budget').value='15000';
  assert.equal(form.checkValidity(),true);
  const button=form.querySelector('button[type="submit"]');
  button.click();
  assert.equal(button.disabled,true,'double-submit is blocked during pending API call');
  await tick();
  await tick();
  assert.equal(submitted.length,1);
  assert.deepEqual(submitted[0].map(x=>x.resource),['lead','note']);
  assert.equal(submitted[0][0].input.contact,'https://vk.com/id42');
  assert.equal(root.querySelector('#requestForm'),null);
  const leads=JSON.parse(localStorage.getItem('auto-sale-leads-v2')||'[]');
  assert.equal(leads.length,1);
  assert.equal(leads[0].origin,'Грузия');
  dom.window.close();
});

test('rejected VK web request displays error and reenables submit for retry',async()=>{
  const {dom,form}=await setup('rejected');
  window.__AUTO_SALE_ENTITY_BATCH__=async()=>{throw Object.assign(new Error('unauthorized'),{code:'telegram_auth_required'})};
  form.elements.namedItem('name').value='Тестовый пользователь';
  form.elements.namedItem('contact').value='https://vk.com/id42';
  form.elements.namedItem('model').value='Toyota';
  form.elements.namedItem('origin').value='Грузия';
  form.elements.namedItem('budget').value='15000';
  assert.equal(form.checkValidity(),true);
  const button=form.querySelector('button[type="submit"]');
  button.click();
  await tick();
  assert.equal(button.disabled,false);
  assert.match(form.querySelector('.auto-form-error')?.textContent||'',/Авторизация не подтверждена/);
  dom.window.close();
});
