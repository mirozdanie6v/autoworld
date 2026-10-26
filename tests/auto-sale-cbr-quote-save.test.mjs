import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {quoteV2RubToUsd} from '../public/auto-sale-quote-v2.mjs';
import {catalogVehicleSnapshot} from '../public/auto-sale-catalog-lead.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const car={id:'AWG-FX-1',brand:'Toyota',model:'Camry',year:2022,
  origin:'Грузия',priceRub:1700000,price:0,active:true,mileage:'23000 км',
  engine:'2.5',drive:'Передний'};
const lead={id:'L-FX-1',name:'Тест',contact:'@test',model:'Toyota Camry',
  origin:'Грузия',status:'В работе',source:'Mini App',priority:'Средний',
  nextAction:'2026-10-26',carId:car.id,catalogRequest:true,
  catalogVehicle:catalogVehicleSnapshot(car),year:'2022',manager:'Дмитрий'};
async function boot(suffix){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,
    CustomEvent:dom.window.CustomEvent,MutationObserver:dom.window.MutationObserver,
    HTMLElement:dom.window.HTMLElement,HTMLFormElement:dom.window.HTMLFormElement,
    Element:dom.window.Element});
  window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true,member:{name:'Дмитрий'}};
  localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([car]));
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify([lead]));
  localStorage.setItem('auto-sale-quotes-v2','[]');
  localStorage.setItem('auto-sale-orders-v2','[]');
  localStorage.setItem('auto-sale-team-v1',JSON.stringify([{id:'TM-1',role:'Менеджер',name:'Дмитрий',active:true}]));
  const today=new Date().toISOString();
  const calls=[];
  globalThis.fetch=async(url)=>{calls.push(String(url));return{ok:true,json:async()=>({
    Date:today,Valute:{USD:{Value:80.5381}}
  })}};
  await import('../public/auto-sale-app-v3.mjs?currency-test-'+suffix+'-'+Date.now());
  await import('../public/auto-sale-quote-save-fix.mjs?currency-test-'+suffix+'-'+Date.now());
  const root=document.getElementById('app');
  root.querySelector('[data-go="quotes"]').click();
  root.querySelector('[data-new-quote]').click();
  const form=root.querySelector('#quoteForm');
  assert.ok(form,'new Georgia V2 quote editor is open');
  for(let i=0;i<12&&!Number(form.elements.cbrRubRate.value);i++)await tick();
  return{dom,root,form,calls};
}

test('official CBR rate fills automatically and source car price converts immediately, including manual rate update',async()=>{
  const {dom,form,calls}=await boot('rate');
  try{
    assert.equal(Number(form.elements.cbrRubRate.value),80.5381);
    assert.ok(form.elements.exchangeRateDate.value,'date comes from published CBR feed');
    assert.equal(form.elements.exchangeRateSource.value,'cbr');
    assert.ok(calls.some(url=>url.includes('cbr-xml-daily.ru')));
    assert.equal(Number(form.elements.lot.value),quoteV2RubToUsd(car.priceRub,80.5381));
    assert.match(form.querySelector('#quoteTotal').textContent,/\$/);
    form.elements.cbrRubRate.value='90';
    form.elements.cbrRubRate.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.equal(Number(form.elements.lot.value),quoteV2RubToUsd(car.priceRub,90),'rate change recalculates catalog car price in same event');
    form.elements.lot.value='12345';
    form.elements.lot.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    form.elements.cbrRubRate.value='95';
    form.elements.cbrRubRate.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.equal(Number(form.elements.lot.value),12345,'manager manual lot edit must never be overwritten');
    assert.doesNotMatch(form.querySelector('#quoteCostPreview').textContent,/\+4%/);
  }finally{dom.window.close()}
});

test('invalid sent quote resets the saving button and shows the error instead of freezing',async()=>{
  const {dom,form}=await boot('invalid');
  try{
    await tick();
    form.elements.status.value='Отправлен';
    const button=form.querySelector('button[type="submit"]');
    form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    await tick();await tick();
    assert.equal(button.getAttribute('aria-busy'),null);
    assert.equal(button.textContent,'Сохранить расчёт');
    assert.ok(form.querySelector('.auto-form-error')?.textContent?.length>0,'validation errors visible');
  }finally{dom.window.close()}
});

test('rejected network save also resets button and reports the failure',async()=>{
  const {dom,form}=await boot('network');
  try{
    window.__AUTO_SALE_ENTITY_BATCH__=async()=>{throw Object.assign(new Error('network'),{code:'entity_request_timeout'})};
    await tick();
    const button=form.querySelector('button[type="submit"]');
    form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    await tick();await tick();
    assert.equal(button.getAttribute('aria-busy'),null);
    assert.equal(button.textContent,'Сохранить расчёт');
    assert.ok(form.querySelector('.auto-form-error')?.textContent?.length>0);
  }finally{dom.window.close()}
});

test('customer quote copy never discloses the private spread percentage or internal exchange rate',async()=>{
  const src=await readFile(new URL('../public/auto-sale-client-quote.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/\+4%|расчётный курс/);
  assert.match(src,/Официальный курс ЦБ РФ/);
});
