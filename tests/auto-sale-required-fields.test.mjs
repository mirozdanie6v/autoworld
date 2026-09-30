import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function setup(html,tag){
  const dom=new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`,{url:'https://auto-sale.viiversion.com/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;globalThis.MutationObserver=dom.window.MutationObserver;globalThis.Event=dom.window.Event;
  await import(`../public/auto-sale-required-fields.mjs?required=${tag}-${Date.now()}-${Math.random()}`);
  await tick();
  return dom;
}

test('required fields are visibly marked and an empty required field is highlighted as blocking save',async()=>{
  const dom=await setup(`<form class="auto-form" id="requestForm">
    <input type="hidden" name="managerMode" value="0">
    <label>Имя<input name="name" required></label>
    <label>Контакт<input name="contact" required value="@client"></label>
    <label>Модель<input name="model" required value="BMW X5"></label>
    <label>Бюджет<input name="budget" required type="number" min="10000" value="25000"></label>
    <label>Год от<input name="yearFrom" type="number" value="2021"></label>
    <label>Год до<input name="yearTo" type="number" value="2025"></label>
  </form>`,'required-empty');
  const form=document.querySelector('#requestForm'),name=form.elements.name;
  assert.equal(name.classList.contains('auto-required-field'),true);
  assert.equal(name.classList.contains('auto-field-blocked'),true);
  assert.match(name.closest('label').textContent,/Обязательно/i);
  assert.match(name.closest('label').textContent,/обязательно для сохранения/i);
  name.value='Иван';name.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await tick();
  assert.equal(name.classList.contains('auto-field-blocked'),false);
  assert.equal(name.classList.contains('auto-required-field'),true);
  dom.window.close();
});

test('quote fields that become mandatory by business status are highlighted immediately',async()=>{
  const dom=await setup(`<form class="auto-form" id="quoteForm">
    <label>Лид<select name="leadId" required><option value="L-1" selected>L-1</option></select></label>
    <label>Автомобиль<input name="model" required value="Audi Q5"></label>
    <label>Лот<input name="lot" type="number" value="0"></label>
    <label>Аукцион<input name="auction" type="number" value="0"></label>
    <label>США<input name="inland" type="number" value="0"></label>
    <label>Море<input name="ocean" type="number" value="0"></label>
    <label>Таможня<input name="customs" type="number" value="0"></label>
    <label>Ремонт<input name="repair" type="number" value="0"></label>
    <label>Услуга<input name="service" type="number" value="0"></label>
    <label>Срок<input name="validUntil" type="date" value=""></label>
    <label>Статус<select name="status"><option selected>Черновик</option><option>Отправлен</option></select></label>
  </form>`,'quote-business');
  const form=document.querySelector('#quoteForm'),lot=form.elements.lot;
  assert.equal(lot.classList.contains('auto-required-field'),false);
  form.elements.status.value='Отправлен';form.elements.status.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
  assert.equal(lot.classList.contains('auto-required-field'),true);
  assert.equal(lot.classList.contains('auto-field-blocked'),true);
  assert.match(lot.closest('label').textContent,/сумма должна быть больше 0/i);
  assert.equal(form.elements.validUntil.classList.contains('auto-field-blocked'),true);
  lot.value='25000';lot.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await tick();
  assert.equal(lot.classList.contains('auto-field-blocked'),false);
  dom.window.close();
});

test('logistics fields and risk description are highlighted when they block the selected stage',async()=>{
  const dom=await setup(`<form class="auto-form" id="orderForm">
    <input type="hidden" name="id" value="O-1">
    <label>Этап<select name="stage"><option selected>Подготовка к отправке</option></select></label>
    <label>LOT<input name="lot"></label>
    <label>VIN<input name="vin"></label>
    <label>ETA<input name="eta" type="date"></label>
    <label>Локация<input name="location"></label>
    <label>Риск<select name="riskType"><option>Нет</option><option selected>Задержка</option></select></label>
    <label>Описание риска<input name="riskNote"></label>
    <label>Платёж<input name="paymentAmount" type="number" value="0"></label>
    <label>Дата<input name="paymentDate" type="date"></label>
  </form>`,'order-business');
  const form=document.querySelector('#orderForm');
  assert.equal(form.elements.lot.classList.contains('auto-required-field'),false,'lot');
  for(const name of ['vin','eta','location','riskNote']){
    assert.equal(form.elements[name].classList.contains('auto-required-field'),true,name);
    assert.equal(form.elements[name].classList.contains('auto-field-blocked'),true,name);
  }
  form.elements.riskNote.value='Задержка судна';form.elements.riskNote.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await tick();
  assert.equal(form.elements.riskNote.classList.contains('auto-field-blocked'),false);
  dom.window.close();
});

test('fully paid order clears stale payment value instead of validating against max zero',async()=>{
  const html=`<form class="auto-form" id="orderForm">
    <input type="hidden" name="id" value="O-PAID">
    <label>Этап<select name="stage"><option selected>Доставка</option><option>Выдача</option></select></label>
    <label>LOT<input name="lot" value="11"></label>
    <label>VIN<input name="vin" value="11"></label>
    <label>ETA<input name="eta" type="date" value="2026-09-15"></label>
    <label>Локация<input name="location" value="11"></label>
    <label>Риск<select name="riskType"><option selected>Нет</option></select></label>
    <label>Платёж<input name="paymentAmount" type="number" min="0" max="0" step="100" value="6100"></label>
    <label>Дата<input name="paymentDate" type="date" value="2026-09-14"></label>
  </form>`;
  const dom=new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`,{url:'https://auto-sale.viiversion.com/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;globalThis.MutationObserver=dom.window.MutationObserver;globalThis.Event=dom.window.Event;
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify([{id:'O-PAID',total:7100,paid:7100,payments:[{id:'PAY-1',amount:1000},{id:'PAY-2',amount:6100}]}]));
  await import(`../public/auto-sale-required-fields.mjs?required=paid-${Date.now()}-${Math.random()}`);
  await tick();
  const amount=document.querySelector('[name="paymentAmount"]');
  assert.equal(amount.value,'0');
  assert.equal(amount.disabled,true);
  assert.equal(amount.hasAttribute('max'),false);
  assert.equal(amount.classList.contains('auto-field-blocked'),false);
  assert.doesNotMatch(amount.closest('label').textContent,/Максимальное значение: 0/i);
  dom.window.close();
});
