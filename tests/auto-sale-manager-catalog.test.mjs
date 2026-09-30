import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {seedCatalog} from './fixtures/auto-sale-business.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

async function setup(tag,{emptyCatalog=false,catalogSeed=null}={}){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://auto-sale-demo.viiversion.com/'});
  globalThis.window=dom.window;
  globalThis.document=dom.window.document;
  globalThis.localStorage=dom.window.localStorage;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.FormData=dom.window.FormData;
  globalThis.Event=dom.window.Event;
  globalThis.CustomEvent=dom.window.CustomEvent;
  globalThis.confirm=()=>true;
  dom.window.confirm=()=>true;
  if(emptyCatalog)localStorage.setItem('auto-sale-catalog-v1','[]');
  else localStorage.setItem('auto-sale-catalog-v1',JSON.stringify(Array.isArray(catalogSeed)?catalogSeed:seedCatalog()));
  await import(`../public/auto-sale-app-v3.mjs?manager-catalog=${tag}-${Date.now()}-${Math.random()}`);
  await tick();
  return{dom,root:document.querySelector('#app')};
}

test('manager navigation exposes catalog and can add a published vehicle',async()=>{
  const {dom,root}=await setup('add');
  root.querySelector('[data-role="manager"]').click();await tick();
  const nav=[...root.querySelectorAll('.auto-bottom [data-go]')].map(x=>x.textContent.trim());
  assert.ok(nav.some(x=>x.includes('Каталог')));
  root.querySelector('[data-go="catalogAdmin"]').click();await tick();
  root.querySelector('[data-catalog-add]').click();await tick();
  const form=root.querySelector('#catalogCarForm');assert.ok(form);
  form.elements.brand.value='Kia';
  form.elements.model.value='Telluride SX';
  form.elements.year.value='2024';
  form.elements.origin.value='Грузия';
  form.elements.mileage.value='12 000 км';
  form.elements.engine.value='3.8 бензин';
  form.elements.drive.value='AWD';
  form.elements.auction.value='Manheim';
  form.elements.auctionDate.value='30.09.2026';
  form.elements.price.value='42000';
  form.elements.delivery.value='8–11 недель';
  form.elements.tag.value='Family SUV';
  form.elements.image.value='https://example.com/kia-telluride.jpg';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();

  const catalog=JSON.parse(localStorage.getItem('auto-sale-catalog-v1'));
  const car=catalog.find(x=>x.brand==='Kia'&&x.model==='Telluride SX');
  assert.ok(car);
  assert.equal(car.active,true);
  assert.equal(car.origin,'Грузия');
  assert.equal(car.price,42000);
  assert.equal(car.auctionDate,'30.09.2026');

  root.querySelector('[data-role="client"]').click();await tick();
  root.querySelector('[data-go="catalog"]').click();await tick();
  assert.match(root.textContent,/Kia Telluride SX/);
  dom.window.close();
});

test('manager can edit and hide a catalog vehicle from clients',async()=>{
  const {dom,root}=await setup('edit');
  root.querySelector('[data-role="manager"]').click();await tick();
  root.querySelector('[data-go="catalogAdmin"]').click();await tick();
  const first=root.querySelector('[data-catalog-edit]');assert.ok(first);
  const id=first.dataset.catalogEdit;
  first.click();await tick();
  const form=root.querySelector('#catalogCarForm');assert.ok(form);
  form.elements.price.value='49999';
  form.elements.active.checked=false;
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();

  const catalog=JSON.parse(localStorage.getItem('auto-sale-catalog-v1'));
  const car=catalog.find(x=>x.id===id);
  assert.equal(car.price,49999);
  assert.equal(car.active,false);

  root.querySelector('[data-role="client"]').click();await tick();
  root.querySelector('[data-go="catalog"]').click();await tick();
  assert.equal(root.querySelector(`[data-detail="${id}"]`),null);
  dom.window.close();
});


test('empty server catalog stays empty instead of restoring demo vehicles',async()=>{
  const {dom,root}=await setup('empty',{emptyCatalog:true});
  root.querySelector('[data-role="manager"]').click();await tick();
  root.querySelector('[data-go="catalogAdmin"]').click();await tick();
  assert.equal(root.querySelectorAll('[data-catalog-edit]').length,0);
  assert.equal(JSON.parse(localStorage.getItem('auto-sale-catalog-v1')).length,0);
  dom.window.close();
});


test('manager catalog form supports local main, interior and other photo sets',async()=>{
  const {dom,root}=await setup('photos');
  root.querySelector('[data-role="manager"]').click();await tick();
  root.querySelector('[data-go="catalogAdmin"]').click();await tick();
  root.querySelector('[data-catalog-add]').click();await tick();
  const form=root.querySelector('#catalogCarForm');assert.ok(form);
  assert.equal(form.querySelectorAll('[data-catalog-photo-upload]').length,3);
  assert.ok(form.querySelector('[data-catalog-photo-upload="main"]'));
  assert.ok(form.querySelector('[data-catalog-photo-upload="interior"][multiple]'));
  assert.ok(form.querySelector('[data-catalog-photo-upload="other"][multiple]'));

  form.elements.brand.value='Ford';
  form.elements.model.value='Bronco Photo Demo';
  form.elements.year.value='2024';
  form.elements.origin.value='США';
  form.elements.mileage.value='9 000 км';
  form.elements.engine.value='2.7 бензин';
  form.elements.drive.value='4WD';
  form.elements.auction.value='Manheim';
  form.elements.price.value='45000';
  form.elements.delivery.value='8–11 недель';
  form.elements.tag.value='Photo demo';
  form.elements.image.value='data:image/jpeg;base64,MAIN';
  form.elements.interiorPhotos.value=JSON.stringify(['data:image/jpeg;base64,INT1','data:image/jpeg;base64,INT2']);
  form.elements.otherPhotos.value=JSON.stringify(['data:image/jpeg;base64,OTH1']);
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();

  const catalog=JSON.parse(localStorage.getItem('auto-sale-catalog-v1'));
  const car=catalog.find(x=>x.model==='Bronco Photo Demo');
  assert.ok(car);
  assert.equal(car.image,'data:image/jpeg;base64,MAIN');
  assert.deepEqual(car.interiorPhotos,['data:image/jpeg;base64,INT1','data:image/jpeg;base64,INT2']);
  assert.deepEqual(car.otherPhotos,['data:image/jpeg;base64,OTH1']);
  dom.window.close();
});


test('manager can edit an imported source-priced car without losing source metadata',async()=>{
  const imported=[{
    id:'AWG-999',brand:'Kia',model:'K4',year:2026,mileage:'393 mi',engine:'2.0L',
    drive:'FWD',auction:'AutoWorld Georgia',price:0,priceRub:2970000,delivery:'Срок по запросу',
    tag:'EX',image:'https://example.com/k4.jpg',interiorPhotos:[],otherPhotos:[],active:true,
    source:'AutoWorld_Georgia',sourcePostId:'999',sourceUrl:'https://t.me/AutoWorld_Georgia/999',vin:'VINTEST1234567890'
  }];
  const {dom,root}=await setup('source-price',{catalogSeed:imported});
  root.querySelector('[data-role="manager"]').click();await tick();
  root.querySelector('[data-go="catalogAdmin"]').click();await tick();
  root.querySelector('[data-catalog-edit="AWG-999"]').click();await tick();
  const form=root.querySelector('#catalogCarForm');assert.ok(form);
  assert.equal(form.elements.price.value,'0');
  assert.equal(form.elements.priceRub.value,'2970000');
  form.elements.priceRub.value='3000000';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();
  const updated=JSON.parse(localStorage.getItem('auto-sale-catalog-v1')).find(x=>x.id==='AWG-999');
  assert.equal(updated.priceRub,3000000);
  assert.equal(updated.source,'AutoWorld_Georgia');
  assert.equal(updated.sourcePostId,'999');
  assert.equal(updated.vin,'VINTEST1234567890');
  dom.window.close();
});


test('catalog sorts by the closest auction date and shows it on client cards',async()=>{
  const fmt=days=>{
    const d=new Date();d.setDate(d.getDate()+days);
    return [String(d.getDate()).padStart(2,'0'),String(d.getMonth()+1).padStart(2,'0'),d.getFullYear()].join('.');
  };
  const near=fmt(2),far=fmt(8);
  const seed=[
    {id:'FAR',brand:'Kia',model:'Far',year:2024,mileage:'1 км',engine:'2.0',drive:'FWD',auction:'Copart',auctionDate:far,price:10000,delivery:'8 недель',tag:'Test',image:'https://example.com/far.jpg',active:true},
    {id:'NONE',brand:'Kia',model:'No Date',year:2023,mileage:'2 км',engine:'2.0',drive:'FWD',auction:'Copart',auctionDate:'',price:10000,delivery:'8 недель',tag:'Test',image:'https://example.com/none.jpg',active:true},
    {id:'NEAR',brand:'Kia',model:'Near',year:2025,mileage:'3 км',engine:'2.0',drive:'FWD',auction:'IAAI',auctionDate:near,price:10000,delivery:'8 недель',tag:'Test',image:'https://example.com/near.jpg',active:true}
  ];
  const {dom,root}=await setup('auction-sort',{catalogSeed:seed});
  root.querySelector('[data-role="client"]').click();await tick();
  root.querySelector('[data-go="catalog"]').click();await tick();
  const ids=[...root.querySelectorAll('[data-detail]')].map(x=>x.dataset.detail);
  assert.deepEqual(ids,['NEAR','FAR','NONE']);
  const nearCard=root.querySelector('[data-detail="NEAR"]').closest('.auto-car');
  assert.match(nearCard.textContent,/Дата аукциона/);
  assert.match(nearCard.textContent,new RegExp(near.replaceAll('.','\\.')));
  dom.window.close();
});

test('manager can permanently delete a vehicle from the catalog',async()=>{
  const seed=[{id:'DELETE-ME',brand:'Ford',model:'Escape',year:2022,mileage:'10 км',engine:'2.0',drive:'AWD',auction:'Copart',auctionDate:'01.10.2026',price:18000,delivery:'8 недель',tag:'Test',image:'https://example.com/delete.jpg',active:true}];
  const {dom,root}=await setup('delete',{catalogSeed:seed});
  root.querySelector('[data-role="manager"]').click();await tick();
  root.querySelector('[data-go="catalogAdmin"]').click();await tick();
  root.querySelector('[data-catalog-edit="DELETE-ME"]').click();await tick();
  const deleteButton=root.querySelector('[data-catalog-delete="DELETE-ME"]');assert.ok(deleteButton);
  deleteButton.click();await tick();
  const catalog=JSON.parse(localStorage.getItem('auto-sale-catalog-v1'));
  assert.equal(catalog.some(x=>x.id==='DELETE-ME'),false);
  assert.equal(root.querySelector('[data-catalog-edit="DELETE-ME"]'),null);
  dom.window.close();
});

test('mobile manager catalog labels origin, year and auction date correctly',async()=>{
  const css=await readFile(new URL('../public/auto-sale-mobile-admin.css',import.meta.url),'utf8');
  assert.match(css,/\.auto-data-table\.catalog \.auto-data-row>span:nth-child\(2\)::before\{content:'Локация'\}/);
  assert.match(css,/\.auto-data-table\.catalog \.auto-data-row>span:nth-child\(3\)::before\{content:'Год выпуска'\}/);
  assert.match(css,/\.auto-data-table\.catalog \.auto-data-row>span:nth-child\(6\)::before\{content:'Дата аукциона'\}/);
  assert.match(css,/:not\(\.catalog\)/);
});

test('client catalog filters vehicles by origin',async()=>{
  const seed=[
    {id:'USA-1',brand:'Nissan',model:'Kicks USA',year:2025,origin:'США',mileage:'1 mi',engine:'2.0',drive:'FWD',auction:'Copart',auctionDate:'30.09.2026',price:15000,delivery:'8 недель',tag:'USA',image:'https://example.com/usa.jpg',active:true},
    {id:'GE-1',brand:'Kia',model:'Sportage Georgia',year:2025,origin:'Грузия',mileage:'10 км',engine:'2.0',drive:'AWD',auction:'',auctionDate:'',price:18000,delivery:'7 дней',tag:'GE',image:'https://example.com/ge.jpg',active:true}
  ];
  const {dom,root}=await setup('origin-filter',{catalogSeed:seed});
  root.querySelector('[data-role="client"]').click();await tick();
  root.querySelector('[data-go="catalog"]').click();await tick();
  const filter=root.querySelector('#originFilter');assert.ok(filter);
  filter.value='Грузия';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
  assert.ok(root.querySelector('[data-detail="GE-1"]'));
  assert.equal(root.querySelector('[data-detail="USA-1"]'),null);
  dom.window.close();
});

test('new published catalog records require a canonical USA or Georgia scenario',async()=>{
  const {dom,root}=await setup('canonical-origin',{emptyCatalog:true});
  root.querySelector('[data-role="manager"]').click();await tick();
  root.querySelector('[data-go="catalogAdmin"]').click();await tick();
  root.querySelector('[data-catalog-add]').click();await tick();
  const form=root.querySelector('#catalogCarForm');
  form.elements.brand.value='BMW';
  form.elements.model.value='X5 Canon';
  form.elements.year.value='2024';
  form.elements.mileage.value='10 000 км';
  form.elements.engine.value='3.0';
  form.elements.drive.value='AWD';
  form.elements.delivery.value='Срок по запросу';
  form.elements.image.value='data:image/jpeg;base64,MAIN';
  form.elements.origin.value='';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();
  assert.equal(JSON.parse(localStorage.getItem('auto-sale-catalog-v1')).some(x=>x.model==='X5 Canon'),false);
  form.elements.origin.value='Грузия';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();
  const car=JSON.parse(localStorage.getItem('auto-sale-catalog-v1')).find(x=>x.model==='X5 Canon');
  assert.ok(car);
  assert.equal(car.origin,'Грузия');
  dom.window.close();
});


test('client catalog shows crossed source price and current discounted price',async()=>{
  const discounted=[{
    id:'AWG-3990',brand:'Nissan',model:'Kicks',year:2023,origin:'Грузия',
    mileage:'59 000 км',engine:'1.6L',drive:'FWD',auction:'AutoWorld Georgia',
    price:0,priceBeforeDiscountRub:1870000,priceAfterDiscountRub:1720000,priceRub:1720000,
    delivery:'Срок по запросу',tag:'SV',image:'https://example.com/kicks.jpg',
    interiorPhotos:[],otherPhotos:[],active:true,source:'AutoWorld_Georgia'
  }];
  const {dom,root}=await setup('discount-price',{catalogSeed:discounted});
  root.querySelector('[data-role="client"]').click();await tick();
  root.querySelector('[data-go="catalog"]').click();await tick();
  const card=root.querySelector('[data-detail="AWG-3990"]').closest('.auto-car');
  assert.ok(card);
  const old=card.querySelector('s.auto-price-old');
  assert.ok(old);
  assert.match(old.textContent,/1\s*870\s*000/);
  assert.match(card.querySelector('.auto-price b').textContent,/1\s*720\s*000/);
  assert.match(card.querySelector('.auto-price span').textContent,/цена со скидкой/i);
  dom.window.close();
});

test('manager can edit before and after discount prices',async()=>{
  const discounted=[{
    id:'AWG-3990',brand:'Nissan',model:'Kicks',year:2023,origin:'Грузия',
    mileage:'59 000 км',engine:'1.6L',drive:'FWD',auction:'AutoWorld Georgia',
    price:0,priceBeforeDiscountRub:1870000,priceAfterDiscountRub:1720000,priceRub:1720000,
    delivery:'Срок по запросу',tag:'SV',image:'https://example.com/kicks.jpg',
    interiorPhotos:[],otherPhotos:[],active:true,source:'AutoWorld_Georgia'
  }];
  const {dom,root}=await setup('discount-edit',{catalogSeed:discounted});
  root.querySelector('[data-role="manager"]').click();await tick();
  root.querySelector('[data-go="catalogAdmin"]').click();await tick();
  root.querySelector('[data-catalog-edit="AWG-3990"]').click();await tick();
  const form=root.querySelector('#catalogCarForm');assert.ok(form);
  assert.equal(form.elements.priceBeforeDiscountRub.value,'1870000');
  assert.equal(form.elements.priceRub.value,'1720000');
  form.elements.priceBeforeDiscountRub.value='1900000';
  form.elements.priceRub.value='1690000';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();
  const updated=JSON.parse(localStorage.getItem('auto-sale-catalog-v1')).find(x=>x.id==='AWG-3990');
  assert.equal(updated.priceBeforeDiscountRub,1900000);
  assert.equal(updated.priceRub,1690000);
  assert.equal(updated.priceAfterDiscountRub,1690000);
  dom.window.close();
});
