import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {catalogVehicleSnapshot,catalogLeadSpecsText,renderCatalogLeadVehicle} from '../public/auto-sale-catalog-lead.mjs';

const car={
  id:'CAR-AUDIT-2026',brand:'Toyota',model:'RAV4',origin:'Грузия',
  year:2024,mileage:'42 500 км',engine:'2.5 Hybrid',drive:'4WD',
  price:18500,priceRub:2570000,priceBeforeDiscountRub:2670000,discountExplicit:true,
  auction:'',auctionDate:'',delivery:'5–10 дней',tag:'В наличии',
  image:'https://example.com/car.jpg',interiorPhotos:['https://example.com/interior.jpg'],
  otherPhotos:[],active:true
};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tick=()=>new Promise(r=>setTimeout(r,0));

test('all customer-visible catalog facts are snapshotted independently of catalog edits',()=>{
  const source={...car};
  const snapshot=catalogVehicleSnapshot(source);
  assert.equal(snapshot.id,source.id);
  for(const key of ['brand','model','year','mileage','engine','drive','origin','price','priceRub','priceBeforeDiscountRub','delivery','tag','image'])
    assert.equal(String(snapshot[key]),String(source[key]),key);
  assert.deepEqual(snapshot.interiorPhotos,['https://example.com/interior.jpg']);
  source.year=2018;source.mileage='100 000 км';
  assert.equal(snapshot.year,'2024');
  assert.equal(snapshot.mileage,'42 500 км');
  const lead={carId:car.id,year:'2024',mileage:car.mileage,engine:car.engine,drive:car.drive,catalogVehicle:snapshot};
  const summary=renderCatalogLeadVehicle(lead,{escape:esc,money:x=>'$'+x,rubMoney:x=>x+' ₽'});
  for(const text of ['Год выпуска','2024','Пробег автомобиля','42 500 км','2.5 Hybrid','4WD','5–10 дней','2 670'])assert.ok(summary.includes(text.replace('2 670','2670000'))||summary.includes(text),text);
  assert.match(summary,/car\.jpg/);
  assert.match(catalogLeadSpecsText(lead),/Год выпуска: 2024 · Пробег: 42 500 км/);
  assert.doesNotMatch(catalogLeadSpecsText(lead),/Год: —–—/);
});

test('catalog card -> client form -> saved lead -> manager edit preserves exact engine and mileage',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,
    sessionStorage:dom.window.sessionStorage,FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent});
  localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([car]));
  await import('../public/auto-sale-app-v3.mjs?car-details-e2e='+Date.now());
  const root=document.querySelector('#app');
  root.querySelector('[data-go="catalog"]').click();
  root.querySelector('[data-request-car="CAR-AUDIT-2026"]').click();
  const form=root.querySelector('#requestForm');
  assert.equal(form.elements.carId.value,car.id);
  assert.equal(form.elements.yearFrom.value,'2024');
  assert.equal(form.elements.yearTo.value,'2024');
  assert.equal(form.elements.mileageMax.value,'42500');
  assert.equal(form.elements.engine.value,'2.5 Hybrid');
  assert.equal(form.elements.drive.value,'Полный');
  form.elements.name.value='Клиент Проверка';
  form.elements.contact.value='@catalog_audit';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  let rows=JSON.parse(localStorage.getItem('auto-sale-leads-v2'));
  let lead=rows.find(x=>x.carId===car.id);
  assert.ok(lead,'lead created with catalog id');
  assert.equal(lead.catalogVehicle.year,'2024');
  assert.equal(lead.catalogVehicle.mileage,car.mileage);
  assert.equal(lead.catalogVehicle.priceRub,car.priceRub);
  assert.equal(lead.catalogVehicle.delivery,car.delivery);
  assert.match(root.textContent,/Год выпуска: 2024/);
  assert.match(root.textContent,/Пробег: 42 500 км/);

  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="'+lead.id+'"]').click();
  const edit=root.querySelector('#leadEditForm');
  assert.ok(edit,'CRM manager form rendered');
  const summary=root.querySelector('[data-catalog-lead-details]');
  assert.ok(summary,'catalog facts visible separately from editable CRM fields');
  for(const field of ['Год выпуска','Пробег автомобиля','Двигатель','Привод','Стоимость из карточки','Срок доставки'])
    assert.match(summary.textContent,new RegExp(field));
  assert.equal(edit.elements.year.value,'2024');
  assert.equal(edit.elements.mileage.value,'42 500 км');
  assert.equal(edit.elements.engine.value,'2.5 Hybrid');
  assert.equal(edit.elements.drive.value,'Полный');
  edit.elements.year.value='2023';
  edit.elements.mileage.value='42 600 км';
  edit.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  rows=JSON.parse(localStorage.getItem('auto-sale-leads-v2'));
  lead=rows.find(x=>x.carId===car.id);
  assert.equal(lead.year,'2023');
  assert.equal(lead.mileage,'42 600 км');
  assert.equal(lead.engine,'2.5 Hybrid');
  assert.equal(lead.drive,'Полный');
  assert.equal(lead.catalogVehicle.year,'2024','original catalog snapshot remains unmodified');
  dom.window.close();
});

test('legacy linked leads show saved year and mileage even when no new snapshot exists',()=>{
  const lead={carId:'OLD-CAR',model:'Legacy car',year:2022,mileage:'12 000 км',engine:'3.0 дизель',drive:'AWD'};
  assert.match(renderCatalogLeadVehicle(lead,{escape:esc}),/Год выпуска/);
  assert.match(renderCatalogLeadVehicle(lead,{escape:esc}),/12 000 км/);
  const generic={yearFrom:2020,yearTo:2024,mileageMax:70000,engine:'Бензин',drive:'AWD'};
  assert.match(catalogLeadSpecsText(generic),/Год: 2020–2024/);
  assert.doesNotMatch(renderCatalogLeadVehicle(generic,{escape:esc}),/Год выпуска/);
});
