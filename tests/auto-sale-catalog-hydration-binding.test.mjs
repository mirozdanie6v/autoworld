import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const car={
 id:'AWG-TRAIL-SELECTED',brand:'Chevrolet',model:'Trailblazer',origin:'Грузия',
 year:2023,mileage:'44 000 км',engine:'1,3l на 155HP',drive:'FWD',
 priceRub:1770000,price:0,image:'https://example.com/trail.jpg',active:true,
 delivery:'5–10 дней'
};
const tick=()=>new Promise(r=>setTimeout(r,0));
async function page(){
 const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
 Object.assign(globalThis,{
   window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,
   sessionStorage:dom.window.sessionStorage,FormData:dom.window.FormData,
   Event:dom.window.Event,CustomEvent:dom.window.CustomEvent
 });
 window.__AUTO_SALE_ACCESS__={role:'public',authenticated:false,member:null};
 localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([car]));
 await import('../public/auto-sale-app-v3.mjs?catalog-hydration='+Date.now()+'-'+Math.random());
 const root=document.querySelector('#app');
 root.querySelector('[data-go="catalog"]').click();
 root.querySelector('[data-request-car="'+car.id+'"]').click();
 const form=root.querySelector('#requestForm');
 assert.equal(form.elements.catalogIntent.value,'catalog');
 assert.equal(form.elements.carId.value,car.id);
 return{dom,root,form};
}

test('late production /state refresh preserves selected catalog car and customer text through submit',async()=>{
 const {dom,root,form}=await page();
 assert.match(form.textContent,/карточка №AWG-TRAIL-SELECTED/);
 form.elements.name.value='Buyer';
 form.elements.contact.value='@test_account';
 form.elements.note.value='Уточните документы';
 localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([car,{...car,id:'AWG-TRAIL-OTHER',priceRub:2160000}]));
 window.dispatchEvent(new dom.window.CustomEvent('auto-sale-server-synced',{detail:{revision:108}}));
 await tick();await tick();
 const restored=root.querySelector('#requestForm');
 assert.ok(restored,'form remains open despite server refresh');
 assert.equal(restored.elements.carId.value,car.id);
 assert.equal(restored.elements.catalogIntent.value,'catalog');
 assert.equal(restored.elements.name.value,'Buyer');
 assert.equal(restored.elements.contact.value,'@test_account');
 assert.equal(restored.elements.note.value,'Уточните документы');
 assert.equal(restored.elements.year.value,'2023');
 assert.equal(restored.elements.mileage.value,'44 000 км');
 restored.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await tick();await tick();
 const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2')||'[]').find(x=>x.name==='Buyer');
 assert.ok(saved,'lead saved after late hydration');
 assert.equal(saved.catalogRequest,true);
 assert.equal(saved.carId,car.id,'exactly clicked car, never other matching model');
 assert.equal(saved.catalogVehicle.id,car.id);
 assert.equal(saved.year,'2023');
 assert.equal(saved.mileage,'44 000 км');
 assert.equal(saved.engine,'1,3l на 155HP');
 dom.window.close();
});

test('catalog-origin request cannot be silently downgraded by clearing hidden intent or carId',async()=>{
 const {dom,root,form}=await page();
 form.elements.name.value='Buyer';
 form.elements.contact.value='@test_account';
 form.elements.catalogIntent.value='general';
 form.elements.carId.value='';
 form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await tick();await tick();
 assert.match(root.querySelector('#requestForm').textContent,/Связь с выбранным автомобилем потеряна/);
 const leads=JSON.parse(localStorage.getItem('auto-sale-leads-v2')||'[]');
 assert.equal(leads.length,0,'no generic lead with lost car may reach API');
 dom.window.close();
});

test('general client request remains general and is not assigned to a similar catalog car',async()=>{
 const {dom,root}=await page();
 root.querySelector('[data-close]').click();
 root.querySelector('[data-go="home"]').click();
 root.querySelector('[data-open-request]').click();
 const form=root.querySelector('#requestForm');
 assert.equal(form.elements.carId.value,'');
 assert.equal(form.elements.catalogIntent.value,'general');
 form.elements.name.value='Buyer';
 form.elements.contact.value='@test_account';
 form.elements.model.value='Chevrolet Trailblazer';
 form.elements.origin.value='Грузия';
 form.elements.ageRange.value='3–5 лет';
 form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await tick();await tick();
 const leads=JSON.parse(localStorage.getItem('auto-sale-leads-v2')||'[]');
 assert.equal(leads.length,1);
 assert.equal(leads[0].carId,'');
 assert.equal(leads[0].catalogRequest,false);
 dom.window.close();
});
