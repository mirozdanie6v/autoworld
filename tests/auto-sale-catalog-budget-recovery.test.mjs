import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {catalogBudgetUsd,catalogCarForLead,catalogPriceRub,catalogVehicleSnapshot} from '../public/auto-sale-catalog-lead.mjs';
import {parseRubPerUsd,catalogRubPerUsd} from '../public/auto-sale-catalog-fx.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const selected={id:'AWG-POST-9081',brand:'Toyota',model:'RAV4 2024',origin:'Грузия',year:2024,
  mileage:'45 200 км',engine:'2.5 Hybrid',drive:'4WD',price:0,priceRub:2570000,
  priceBeforeDiscountRub:2670000,sourceUrl:'https://example.com/advert',vin:'JTMBR31V5K0000019',
  transmission:'Автомат',image:'https://example.com/rav4.jpg',active:true};
const fxData=()=>({Date:new Date().toISOString(),Valute:{USD:{Value:100}}});

test('catalog ruble price converts to nearest $500 and never uses old price',()=>{
  assert.equal(catalogPriceRub(selected),2570000);
  assert.equal(catalogBudgetUsd(selected,100),25500);
  assert.equal(catalogBudgetUsd({...selected,priceRub:2500000},100),25000);
  assert.equal(catalogBudgetUsd(selected,0),0,'no rate means no fabricated budget');
  assert.equal(catalogBudgetUsd({...selected,price:19349},0),19500,'USD-listed car needs no rate');
});
test('legacy client lead maps only to exactly one matching catalog car',()=>{
  const lead={id:'L-HISTORY',model:'Toyota RAV4 2024',clientCreated:true,origin:'Грузия',budget:0};
  assert.equal(catalogCarForLead(lead,[selected]).car?.id,selected.id);
  assert.equal(catalogCarForLead(lead,[selected,{...selected,id:'AWG-OTHER'}]).car,null,'ambiguous must not be guessed');
  assert.equal(catalogCarForLead({...lead,origin:'США'},[selected]).car,null,'origin mismatch');
  assert.equal(catalogCarForLead({...lead,clientCreated:false},[selected]).car,null,'do not match manually created manager lead');
  const identified={...lead,carId:selected.id,catalogVehicle:catalogVehicleSnapshot(selected)};
  assert.equal(catalogCarForLead(identified,[]).car.year,'2024');
});
test('dated rate source is validated and never guesses stale currency',async()=>{
  const valid=parseRubPerUsd(fxData());
  assert.equal(valid.rate,100);
  await assert.rejects(catalogRubPerUsd({fetchImpl:async()=>({ok:true,json:async()=>({Date:'2020-01-01',Valute:{USD:{Value:100}}})})}),/stale/);
});
test('client chooses catalog card → submitted lead persists original year, mileage, price and rounded USD budget',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,
    sessionStorage:dom.window.sessionStorage,FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>fxData()});
  try{
    localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([selected]));
    await import('../public/auto-sale-app-v3.mjs?catalog-budget='+Date.now());
    const root=document.querySelector('#app');
    root.querySelector('[data-go="catalog"]').click();
    root.querySelector('[data-request-car="AWG-POST-9081"]').click();
    const form=root.querySelector('#requestForm');
    assert.equal(form.elements.carId.value,selected.id);
    form.elements.name.value='Клиент';
    form.elements.contact.value='@exampleclient';
    await tick();await tick(); // Rate arrives while the customer fills the form.
    assert.equal(form.elements.catalogUsdRubRate.value,'100');
    form.querySelector('[type="submit"]').click();
    await tick();await tick();await tick();
    const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(l=>l.carId===selected.id);
    assert.ok(saved,'lead created');
    assert.equal(saved.year,'2024');
    assert.equal(saved.mileage,'45 200 км');
    assert.equal(saved.estimatedCostRub,2570000);
    assert.equal(saved.catalogVehicle.priceRub,2570000);
    assert.equal(saved.catalogVehicle.transmission,'Автомат');
    assert.equal(saved.budget,25500);
    assert.equal(saved.catalogUsdRubRate,100);
  }finally{globalThis.fetch=originalFetch;dom.window.close()}
});
test('existing client lead without carId renders selected car characteristics, rate, budget and saves with car snapshot',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,
    sessionStorage:dom.window.sessionStorage,FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>fxData()});
  try{
    localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([selected]));
    localStorage.setItem('auto-sale-leads-v2',JSON.stringify([{id:'L-HISTORY',name:'Клиент',contact:'@client',
      model:'Toyota RAV4 2024',origin:'Грузия',clientCreated:true,source:'Mini App',budget:0,manager:'Дмитрий',
      status:'Новый',priority:'Средний',nextAction:'2026-10-22',deposit:0}]));
    localStorage.setItem('auto-sale-quotes-v2','[]');
    localStorage.setItem('auto-sale-orders-v2','[]');
    await import('../public/auto-sale-app-v3.mjs?legacy-budget='+Date.now());
    const root=document.querySelector('#app');
    root.querySelector('[data-role="manager"]').click();
    root.querySelector('[data-go="leads"]').click();
    root.querySelector('[data-lead="L-HISTORY"]').click();
    await tick();await tick();
    const form=root.querySelector('#leadEditForm');
    assert.ok(form);
    assert.equal(form.elements.year.value,'2024');
    assert.equal(form.elements.mileage.value,'45 200 км');
    assert.equal(form.elements.engine.value,'2.5 Hybrid');
    assert.equal(form.elements.drive.value,'4WD');
    assert.equal(form.elements.budget.value,'25500');
    assert.equal(form.elements.catalogUsdRubRate.value,'100');
    assert.match(form.textContent,/Источник|Стоимость из карточки/);
    assert.match(form.textContent,/2.5 Hybrid/);
    form.querySelector('[type="submit"]').click();
    await tick();await tick();
    const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2'))[0];
    assert.equal(saved.carId,selected.id);
    assert.equal(saved.catalogVehicle.year,'2024');
    assert.equal(saved.year,'2024');
    assert.equal(saved.mileage,'45 200 км');
    assert.equal(saved.budget,25500);
    assert.equal(saved.catalogUsdRubRate,100);
  }finally{globalThis.fetch=originalFetch;dom.window.close()}
});
