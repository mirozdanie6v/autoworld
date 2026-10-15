import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const globals=['window','document','localStorage','sessionStorage','FormData','Event',
  'CustomEvent','MutationObserver','HTMLFormElement','fetch'];
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
function setup(url,access){
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>',{url});
  const saved=new Map(globals.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const key of globals){if(key!=='fetch')globalThis[key]=dom.window[key]}
  globalThis.fetch=async()=>({ok:true,json:async()=>({enabled:true,messagingEnabled:true,groupId:'242103542'})});
  window.__AUTO_SALE_ACCESS__=access;
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify([{
    id:'L-42',name:'ТЕСТ',model:'Toyota',manager:'Дмитрий',status:'В работе',clientCreated:true
  }]));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([{
    id:'Q-42',leadId:'L-42',status:'Отправлен',version:1,model:'Toyota',total:15000
  },{
    id:'Q-DRAFT',leadId:'L-42',status:'Черновик',version:2,model:'Toyota'
  }]));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify([{
    id:'O-42',leadId:'L-42',stage:'В пути',customer:'ТЕСТ',model:'Toyota',
    manager:'Дмитрий',payments:[],paymentPlan:[],total:15000,paid:0
  }]));
  return {
    dom,
    restore(){
      dom.window.close();
      for(const [k,descriptor]of saved){
        if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];
      }
    }
  };
}
const imported=name=>import(new URL('../public/'+name+'?e2e='+Date.now()+'-'+Math.random(),import.meta.url).href);
const telegramUrl=hash=>'https://awgcars.ru/?awg_notification='+encodeURIComponent(hash)+'#tgWebAppData=telegram-internal';

test('Telegram manager notification opens exact lead, quote, order via query even when Telegram owns the hash',async()=>{
  const access={role:'admin',authenticated:true,identity:{provider:'telegram',id:'800',key:'telegram:800'},
    member:{name:'Дмитрий',role:'Менеджер'},user:{id:'800'}};
  const env=setup(telegramUrl('auto-mir/lead/L-42'),access);
  try{
    await imported('auto-sale-app-v3.mjs');
    await imported('auto-sale-telegram.mjs');
    await imported('auto-sale-vk-notification-navigation.mjs');
    await tick();
    assert.ok(document.querySelector('#leadEditForm'),'lead modal must open');
    assert.equal(document.querySelector('#leadEditForm input[name=id]')?.value,'L-42');

    env.dom.reconfigure({url:telegramUrl('auto-mir/quote/Q-42')});
    window.dispatchEvent(new Event('hashchange'));await tick();
    assert.ok(document.querySelector('#quoteForm'),'quote modal must open');
    assert.equal(document.querySelector('#quoteForm input[name=id]')?.value,'Q-42');

    env.dom.reconfigure({url:telegramUrl('auto-mir/order/O-42')});
    window.dispatchEvent(new Event('hashchange'));await tick();
    assert.ok(document.querySelector('#orderForm'),'order modal must open');
    assert.equal(document.querySelector('#orderForm input[name=id]')?.value,'O-42');

    env.dom.reconfigure({url:telegramUrl('auto-mir/quote/Q-DRAFT')});
    window.dispatchEvent(new Event('hashchange'));await tick();
    assert.equal(document.querySelector('#quoteForm'),null,'draft quote must not open from a notice');
    assert.equal(document.querySelector('#orderForm input[name=id]')?.value,'O-42','rejects invalid link without redirect');
  }finally{env.restore()}
});

test('Unsigned Telegram notification URL cannot grant admin access',async()=>{
  const env=setup(telegramUrl('auto-mir/lead/L-42'),{role:'public',authenticated:false});
  try{
    await imported('auto-sale-app-v3.mjs');
    await imported('auto-sale-telegram.mjs');
    await imported('auto-sale-vk-notification-navigation.mjs');
    await tick();
    assert.equal(document.querySelector('#leadEditForm'),null);
    assert.equal(document.querySelector('#orderForm'),null);
    assert.equal(document.querySelector('#quoteForm'),null);
  }finally{env.restore()}
});

test('Telegram client opens only owned entity via query and rejects foreign lead after authorization',async()=>{
  const env=setup(telegramUrl('auto-mir/quote/Q-42'),{role:'public',authenticated:false});
  try{
    await imported('auto-sale-app-v3.mjs');
    await imported('auto-sale-telegram.mjs');
    await imported('auto-sale-vk-notification-navigation.mjs');
    await tick();assert.equal(document.querySelector('[data-client-detail-bg]'),null);
    window.__AUTO_SALE_ACCESS__={role:'client',authenticated:true,identity:{provider:'telegram',id:'700',key:'telegram:700'}};
    window.dispatchEvent(new Event('auto-sale-server-synced'));await tick();await tick();
    const modal=document.querySelector('[data-client-detail-bg]');
    assert.ok(modal,'owned quote opened after hydration');
    assert.equal(modal.dataset.notificationQuote,'Q-42');
    env.dom.reconfigure({url:telegramUrl('auto-mir/quote/FOREIGN')});
    window.dispatchEvent(new Event('hashchange'));await tick();
    assert.equal(document.querySelector('[data-client-detail-bg]'),null,'foreign detail hidden');
  }finally{env.restore()}
});
