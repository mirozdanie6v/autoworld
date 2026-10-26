import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {catalogVehicleSnapshot} from '../public/auto-sale-catalog-lead.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('manager calendar and drive/note editing keep lead modal open and save changes',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver,HTMLFormElement:dom.window.HTMLFormElement,
    Element:dom.window.Element});
  const car={id:'AWG-MODAL-1',brand:'Toyota',model:'Camry',origin:'Грузия',year:2023,
    mileage:'35 000 км',engine:'2.5 Petrol',drive:'AWD',priceRub:2100000,active:true};
  const lead={id:'L-MODAL-1',name:'Иван',contact:'@ivan',model:'Toyota Camry',
    origin:'Грузия',carId:car.id,catalogRequest:true,catalogVehicle:catalogVehicleSnapshot(car),
    year:'2023',mileage:car.mileage,engine:car.engine,drive:'AWD',budget:20000,
    clientCreated:true,source:'Mini App',status:'В работе',priority:'Средний',
    manager:'Дмитрий',nextAction:'2026-10-30',note:'Исходная заметка'};
  window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true,member:{name:'Дмитрий'}};
  localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([car]));
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify([lead]));
  localStorage.setItem('auto-sale-quotes-v2','[]');
  localStorage.setItem('auto-sale-orders-v2','[]');
  localStorage.setItem('auto-sale-team-v1',JSON.stringify([{id:'TM-DM',name:'Дмитрий',role:'Менеджер',active:true}]));
  const batches=[];
  window.__AUTO_SALE_ENTITY_BATCH__=async operations=>{batches.push(operations);return{ok:true,revision:2}};
  try{
    await import('../public/auto-sale-app-v3.mjs?manager-modal-parity='+Date.now());
    const root=document.getElementById('app');
    root.querySelector('[data-go="leads"]').click();
    root.querySelector('[data-lead="L-MODAL-1"]').click();
    const form=root.querySelector('#leadEditForm');
    assert.ok(form);
    assert.equal(form.elements.drive.value,'Полный');
    assert.equal(form.elements.note.value,'Исходная заметка');
    const date=form.elements.nextAction;
    assert.equal(date.type,'date');
    let pickerCalls=0;
    date.showPicker=()=>{pickerCalls++};
    date.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,cancelable:true}));
    assert.equal(pickerCalls,1,'clicking the manager date field invokes the browser date picker');
    assert.equal(root.querySelector('#leadEditForm'),form);
    form.elements.drive.value='Задний';
    form.elements.drive.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    form.elements.note.value='Общая заметка после проверки';
    form.elements.note.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.equal(root.querySelector('#leadEditForm'),form,'neither changing drive nor editing note closes manager modal');
    assert.equal(form.elements.drive.value,'Задний');
    assert.equal(form.elements.note.value,'Общая заметка после проверки');
    form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    await tick();await tick();
    assert.equal(batches.length,1,'updated lead saved exactly once');
    const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(x=>x.id===lead.id);
    assert.ok(saved);
    assert.equal(saved.drive,'Задний');
    assert.equal(saved.note,'Общая заметка после проверки');
    assert.equal(saved.catalogVehicle.drive,'AWD','original catalogue facts stay immutable');
  }finally{dom.window.close()}
});
