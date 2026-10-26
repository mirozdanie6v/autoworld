import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {sanitizeClientOperations} from '../server/auto-sale-access.mjs';

const car={id:'AWG-PARITY-ENDED-1',brand:'Chevrolet',model:'Trailblazer',
  origin:'США',year:2022,mileage:'42 500 км',engine:'2.0 Petrol',drive:'AWD',
  price:18400,priceRub:1720000,auction:'Copart',auctionDate:'2024-03-10',
  active:true,image:'https://example.test/ended-auction.jpg'};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

async function runChannel(provider){
  const isVk=provider==='vk';
  const url=isVk
    ?'https://awgcars.ru/?vk_app_id=54810434&vk_user_id=42&sign=test'
    :'https://awgcars.ru/?tgWebAppVersion=8.0';
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,
    CustomEvent:dom.window.CustomEvent,MutationObserver:dom.window.MutationObserver,
    HTMLFormElement:dom.window.HTMLFormElement,Element:dom.window.Element});
  const uid=isVk?'42':'700';
  if(!isVk)window.Telegram={WebApp:{initData:'signed-test',initDataUnsafe:{user:{id:Number(uid)}}}};
  window.__AUTO_SALE_ACCESS__={role:'client',authenticated:true,authType:provider,
    identity:{provider,id:uid,key:provider+':'+uid},user:{id:uid}};
  localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([car]));
  localStorage.setItem('auto-sale-leads-v2','[]');
  localStorage.setItem('auto-sale-quotes-v2','[]');
  localStorage.setItem('auto-sale-orders-v2','[]');
  const batches=[];
  window.__AUTO_SALE_ENTITY_BATCH__=async operations=>{batches.push(operations);return{ok:true,revision:1}};
  try{
    await import('../public/auto-sale-app-v3.mjs?parity-'+provider+'-'+Date.now());
    const root=document.getElementById('app');
    root.querySelector('[data-go="catalog"]').click();
    const cardButton=root.querySelector('[data-request-car="'+car.id+'"]');
    assert.ok(cardButton,provider+' should show the selected ended auction');
    assert.equal(cardButton.disabled,false,provider+' should allow similar-car requests for ended auctions');
    assert.match(cardButton.textContent,/Найти похожий/);
    cardButton.click();
    const form=root.querySelector('#requestForm');
    assert.ok(form);
    assert.equal(form.elements.catalogIntent.value,'catalog');
    assert.equal(form.elements.carId.value,car.id);
    assert.equal(form.elements.yearFrom.value,'2022');
    assert.equal(form.elements.yearTo.value,'2022');
    assert.equal(form.elements.mileageMax.value,'42500');
    assert.equal(form.elements.drive.value,'Полный');
    assert.equal(form.elements.budget.step,'200');
    assert.equal(form.elements.budget.required,true);
    assert.equal(form.elements.yearFrom.required,true);
    assert.equal(form.elements.yearTo.required,true);
    for(const [name,value]of Object.entries({name:'Client '+provider,contact:'@customer',
      budget:'20000',yearFrom:'2020',yearTo:'2024',mileageMax:'60000',drive:'Полный'}))
      form.elements[name].value=value;
    form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    await tick();await tick();
    assert.equal(batches.length,1,provider+' should send one persisted request');
    const op=batches[0][0];
    assert.equal(op.resource,'lead');
    assert.equal(op.input.carId,car.id);
    assert.equal(op.input.year,'2022','the selected car keeps its actual manufacture year');
    assert.equal(op.input.yearFrom,'2020','search range is kept separate from actual year');
    assert.equal(op.input.yearTo,'2024');
    assert.equal(op.input.budget,20000);
    assert.equal(op.input.drive,'Полный');
    const checked=sanitizeClientOperations({leads:[],quotes:[],catalog:[car]},
      batches[0],{provider,id:uid,username:'customer'},
      {provider,id:uid});
    assert.equal(checked.ok,true,JSON.stringify(checked));
    assert.equal(checked.operations[0].input.clientProvider,provider);
    assert.equal(checked.operations[0].input.catalogVehicle.id,car.id);
    assert.equal(checked.operations[0].input.year,'2022');
    assert.equal(checked.operations[0].input.yearFrom,'2020');
    return {button:cardButton.textContent.trim(),budgetStep:form.elements.budget.step,
      yearFrom:op.input.yearFrom,yearTo:op.input.yearTo,drive:op.input.drive,
      carId:op.input.carId,actualYear:op.input.year};
  }finally{dom.window.close()}
}

test('Telegram Mini App and VK Mini App share the same ended-auction similar-car workflow',async()=>{
  const telegram=await runChannel('telegram');
  const vk=await runChannel('vk');
  assert.deepEqual(vk,telegram);
});
