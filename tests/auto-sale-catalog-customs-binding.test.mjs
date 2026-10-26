import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {catalogCustomsFacts,catalogCustomsForLead} from '../public/auto-sale-catalog-customs.mjs';
import {catalogVehicleSnapshot} from '../public/auto-sale-catalog-lead.mjs';
import {validateLead as validateServerLead} from '../server/auto-sale-rules.mjs';

const CAR={id:'AWG-CUSTOMS-39',brand:'Toyota',model:'Camry',origin:'Грузия',
  year:2022,manufactureDate:'2022-06',mileage:'51 000 км',
  engine:'Бензин 1998 см³',power:'150 л.с.',drive:'FWD',priceRub:2500000,
  vin:'JTNB11HK0J3000001',image:'https://example.com/car.jpg',active:true};
const tick=()=>new Promise(r=>setTimeout(r,0));

test('prefills verified year/month, exact cm³, metric horsepower, fuel type, VIN and mileage',()=>{
 const facts=catalogCustomsFacts(CAR,'2026-10-22');
 assert.equal(facts.year,2022);
 assert.equal(facts.manufactureDate,'2022-06');
 assert.equal(facts.engineCc,1998);
 assert.equal(facts.powerHp,150);
 assert.equal(facts.engineType,'petrol');
 assert.equal(facts.ageCategory,'3to5');
 assert.equal(facts.vin,CAR.vin);
 assert.equal(facts.mileage,CAR.mileage);
});
test('does not invent exact cm³ from 2.5L, diesel/fuel from unspecified hybrid, manufacture month, or ambiguous tariff age',()=>{
 const facts=catalogCustomsFacts({year:2023,engine:'2.5 Hybrid',mileage:'25 000 км',power:'—'},'2026-10-22');
 assert.equal(facts.engineCc,0);
 assert.equal(facts.powerHp,0);
 assert.equal(facts.engineType,'');
 assert.equal(facts.manufactureDate,'');
 assert.equal(facts.ageCategory,'');
 assert.ok(facts.missing.length>=4);
 const conflicting=catalogCustomsFacts({year:2023,manufactureDate:'2022-09',engineCc:1800,powerHp:120,engineType:'petrol'},'2026-10-22');
 assert.equal(conflicting.manufactureDate,'','mismatched source year and month must not be trusted');
 assert.equal(conflicting.ageCategory,'','uncertain year boundary requires manual review');
});
test('explicit source attributes win and snapshots survive catalog updates and disappearance',()=>{
 const raw={...CAR,engine:'2.5 Hybrid',engineCc:2487,powerHp:178,engineType:'petrol_electric'};
 const snap=catalogVehicleSnapshot(raw);
 const c=catalogCustomsForLead({carId:raw.id,catalogVehicle:snap},[{...raw,year:2019,engineCc:0}],'2026-10-22');
 assert.equal(c.car.id,raw.id);
 assert.equal(c.facts.year,2022);
 assert.equal(c.facts.engineCc,2487);
 assert.equal(c.facts.powerHp,178);
 assert.equal(c.facts.engineType,'petrol_electric');
 assert.equal(catalogCustomsForLead({carId:raw.id,catalogVehicle:snap},[]).car.id,raw.id);
});
test('unbound generic leads cannot import unrelated catalog specs',()=>{
 assert.equal(catalogCustomsForLead({model:'Toyota Camry'},[CAR]).car,null);
 assert.equal(catalogCustomsForLead({carId:'UNKNOWN'},[CAR]).car,null);
});
test('catalog selected request must preserve original id and cannot silently become a general lead',async()=>{
 const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
 FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,MutationObserver:dom.window.MutationObserver});
 localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([CAR]));
 await import('../public/auto-sale-app-v3.mjs?catalog-bind-required='+Date.now());
 const root=document.querySelector('#app');
 root.querySelector('[data-go="catalog"]').click();
 root.querySelector('[data-request-car="AWG-CUSTOMS-39"]').click();
 const form=root.querySelector('#requestForm');
 assert.equal(form.elements.catalogIntent.value,'catalog');
 assert.equal(form.elements.carId.value,CAR.id);
 form.elements.name.value='Клиент';
 form.elements.contact.value='@client';
 form.elements.carId.value='';
 form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await tick();await tick();
 assert.match(form.textContent,/Связь с выбранным автомобилем потеряна/);
 assert.equal(JSON.parse(localStorage.getItem('auto-sale-leads-v2')||'[]').filter(x=>x.name==='Клиент').length,0);
 form.elements.carId.value=CAR.id;
 form.elements.budget.value='20000';
 form.elements.model.value='Модель клиента, отличающаяся от каталога';
 form.elements.yearFrom.value='2019';
 form.elements.yearTo.value='2019';
 form.elements.mileageMax.value='999999';
 form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await tick();await tick();
 const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2')||'[]').find(x=>x.name==='Клиент');
 assert.ok(saved,'catalog request saved after restoring id');
 assert.equal(saved.catalogRequest,true);
 assert.equal(saved.carId,CAR.id);
 assert.equal(saved.catalogVehicle.id,CAR.id);
 assert.equal(saved.model,'Toyota Camry');
 assert.equal(saved.year,'2022');
 assert.equal(saved.mileage,'51 000 км');
 dom.window.close();
});
test('manager Georgia calculation autofills customs parameters from linked lead, without fabricated customs fees',async()=>{
 const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
 FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,MutationObserver:dom.window.MutationObserver});
 const lead={id:'L-GEO-CUSTOMS',name:'Клиент',contact:'@client',model:'Toyota Camry',origin:'Грузия',
 carId:CAR.id,catalogVehicle:catalogVehicleSnapshot(CAR),clientCreated:true,year:'2022',mileage:CAR.mileage,manager:'Дмитрий',
 status:'Новый',source:'Mini App',priority:'Средний',nextAction:'2026-10-22',budget:25000,deposit:0};
 localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([CAR]));
 localStorage.setItem('auto-sale-leads-v2',JSON.stringify([lead]));
 localStorage.setItem('auto-sale-quotes-v2','[]');
 await import('../public/auto-sale-app-v3.mjs?quote-customs-prefill='+Date.now());
 const root=document.querySelector('#app');
 root.querySelector('[data-role="manager"]').click();
 root.querySelector('[data-go="leads"]').click();
 root.querySelector('[data-lead="L-GEO-CUSTOMS"]').click();
 root.querySelector('[data-create-quote="L-GEO-CUSTOMS"]').click();
 const form=root.querySelector('#quoteForm');
 assert.equal(form.dataset.awgQuoteV2,'true');
 assert.equal(form.elements.leadId.value,'L-GEO-CUSTOMS');
 assert.equal(form.elements.manufactureDate.value,'','month-only source cannot generate an invented manufacture day');
 assert.equal(form.elements.engineLiters.value,'1.998');
 assert.equal(form.elements.powerHp.value,'150');
 assert.equal(form.elements.engineType.value,'petrol');
 assert.equal(form.elements.ageCategory.value,'3to5');
 assert.equal(form.elements.catalogSourceId.value,CAR.id);
 assert.equal(form.elements.catalogVin.value,CAR.vin);
 assert.equal(form.elements.customsAndRecyclingRub.value,String(CAR.customsRub||0));
 dom.window.close();
});


test('backend rejects new catalog requests with lost or mismatched card snapshot, but not generic or historical leads',()=>{
 const base={id:'L-BIND-1',name:'Клиент',contact:'@client',model:'Toyota Camry',origin:'Грузия',status:'Новый',nextAction:'2026-10-22'};
 assert.deepEqual(validateServerLead({...base,catalogRequest:true,carId:CAR.id,catalogVehicle:catalogVehicleSnapshot(CAR)}),[]);
 assert.ok(validateServerLead({...base,catalogRequest:true,carId:'',catalogVehicle:null}).includes('catalog_car_binding_required'));
 assert.ok(validateServerLead({...base,catalogRequest:true,carId:'ANOTHER',catalogVehicle:catalogVehicleSnapshot(CAR)}).includes('catalog_car_binding_required'));
 assert.deepEqual(validateServerLead({...base,clientCreated:true,carId:''}),[]);
});
