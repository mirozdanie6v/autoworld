import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
const globals=['window','document','localStorage','sessionStorage','FormData','Event','CustomEvent','MutationObserver','HTMLFormElement','fetch'];
function setup(url){
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>',{url});
  const saved=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of globals){if(key!=='fetch')globalThis[key]=dom.window[key]}
  globalThis.fetch=async()=>({ok:true,json:async()=>({enabled:true,messagingEnabled:true,groupId:'242103542'})});
  window.__AUTO_SALE_ACCESS__={role:'client',authenticated:true,authType:'vk',identity:{provider:'vk',id:'42',key:'vk:42'},user:{id:'42'}};
  return{dom,restore(){dom.window.close();for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}};
}
const importFresh=path=>import(new URL(`../public/${path}?test=${Date.now()}-${Math.random()}`,import.meta.url).href);

test('declined permission saves one request, shows a notice and supports explicit retry',async()=>{
  const env=setup('https://vk-test.awgcars.ru/?vk_app_id=54810434&vk_user_id=42&sign=test');
  let releasePermission,allowed=false,allowCalls=0;
  const operations=[];
  window.vkBridge={send:async method=>{
    if(method==='VKWebAppGetUserInfo')return{id:42,first_name:'Клиент'};
    if(method==='VKWebAppAllowMessagesFromGroup'){
      allowCalls++;
      if(!allowed)return new Promise(resolve=>{releasePermission=()=>resolve({result:false})});
      return{result:true};
    }
    return{result:true};
  }};
  window.__AUTO_SALE_ENTITY_BATCH__=async batch=>{operations.push(batch);return{ok:true}};
  try{
    await importFresh('auto-sale-vk.mjs');await importFresh('auto-sale-app-v3.mjs');
    document.querySelector('[data-open-request]').click();
    const form=document.querySelector('#requestForm');
    for(const [key,value]of Object.entries({name:'Клиент',contact:'https://vk.com/id42',model:'Toyota',origin:'Грузия',budget:'20000'}))form.elements.namedItem(key).value=value;
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await tick();assert.equal(form.querySelector('button[type="submit"]').disabled,true);
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(allowCalls,1);releasePermission();await tick();await tick();
    assert.equal(operations.length,1,'permission must not prevent saving or duplicate the request');
    assert.ok(document.querySelector('[data-client-orders]'));
    assert.match(document.querySelector('[data-vk-messages-notice]').textContent,/Включите сообщения/);
    allowed=true;document.querySelector('[data-vk-allow-messages]').click();await tick();
    assert.equal(window.__AUTO_SALE_VK_MESSAGES_STATE__.status,'allowed');
    assert.equal(document.querySelector('[data-vk-messages-notice]'),null);
    assert.equal(operations.length,1);
  }finally{env.restore()}
});

test('permission cache is scoped to the VK user and an exception remains visible',async()=>{
  const env=setup('https://vk-test.awgcars.ru/?vk_app_id=54810434&vk_user_id=42&sign=test');
  let allowCalls=0,fail=false;
  window.vkBridge={send:async method=>{
    if(method==='VKWebAppGetUserInfo')return{id:42};
    if(method==='VKWebAppAllowMessagesFromGroup'){allowCalls++;if(fail)throw new Error('user_cancelled')}
    return{result:true};
  }};
  try{
    const vk=await importFresh('auto-sale-vk.mjs');
    assert.equal((await vk.ensureVkMessagesAllowed()).ok,true);
    assert.equal((await vk.ensureVkMessagesAllowed()).cached,true);assert.equal(allowCalls,1);
    env.dom.reconfigure({url:'https://vk-test.awgcars.ru/?vk_app_id=54810434&vk_user_id=43&sign=test'});
    fail=true;
    document.getElementById('app').innerHTML='<section data-client-orders></section>';
    assert.equal((await vk.ensureVkMessagesAllowed()).ok,false);assert.equal(allowCalls,2);
    assert.match(document.querySelector('[data-vk-messages-notice]').textContent,/Включите сообщения/);
    assert.equal(sessionStorage.getItem('auto-sale-vk-messages-allowed:242103542:43'),'0');
    const fresh=await importFresh('auto-sale-vk.mjs');
    await fresh.initVkMiniAppShell();await tick();
    assert.equal(window.__AUTO_SALE_VK_MESSAGES_STATE__.status,'denied');
    assert.equal(allowCalls,2,'restoring a declined permission never opens another prompt');
  }finally{env.restore()}
});

test('notification opens the exact owned quote and rejects a foreign link after hydration',async()=>{
  const env=setup('https://vk-test.awgcars.ru/#auto-mir/quote/Q-1');
  window.__AUTO_SALE_ACCESS__={role:'public',authenticated:false};
  try{
    localStorage.setItem('auto-sale-leads-v2',JSON.stringify([{id:'L-1',name:'Клиент',model:'Toyota',clientCreated:true,status:'Расчёт',manager:'Иван'}]));
    localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([{id:'Q-1',leadId:'L-1',version:1,status:'Отправлен',model:'Toyota',total:15000},{id:'Q-2',leadId:'L-1',version:2,status:'Отправлен',model:'Toyota',total:16000}]));
    await importFresh('auto-sale-app-v3.mjs');await importFresh('auto-sale-telegram.mjs');await importFresh('auto-sale-client-quote.mjs');await importFresh('auto-sale-vk-notification-navigation.mjs');
    await tick();assert.equal(document.querySelector('[data-client-detail-bg]'),null,'unsigned URLs do not authenticate');
    window.__AUTO_SALE_ACCESS__={role:'client',authenticated:true,identity:{provider:'vk',id:'42',key:'vk:42'}};
    window.dispatchEvent(new CustomEvent('auto-sale-server-synced'));await tick();await tick();
    const modal=document.querySelector('[data-client-detail-bg]');
    assert.ok(modal);assert.equal(modal.dataset.notificationQuote,'Q-1');
    assert.equal(modal.querySelector('[data-client-quote]').dataset.clientQuote,'Q-1');
    assert.equal(modal.querySelector('[data-client-quote-agree]'),null,'old notification quotes are read-only');
    window.location.hash='auto-mir/lead/FOREIGN';await tick();
    assert.equal(document.querySelector('[data-client-detail-bg]'),null);
    assert.match(document.querySelector('[data-client-orders]').textContent,/недоступна в текущем аккаунте/);
    window.__AUTO_SALE_ACCESS__={role:'public',authenticated:false};
    window.dispatchEvent(new CustomEvent('auto-sale-server-synced'));await tick();
    assert.equal(document.querySelector('[data-client-detail-bg]'),null);
  }finally{env.restore()}
});
