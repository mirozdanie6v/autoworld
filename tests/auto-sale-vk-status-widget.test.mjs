import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {deriveVkStatus,isVkStatusStagingHost,initializeVkStatusWidget} from '../public/auto-sale-vk-status-widget.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const fakeBrowser=(url='https://vk-test.awgcars.ru/')=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="app"><div class="auto-shell"><header class="auto-topbar"><button>АвтоМир</button></header></div></div></body></html>',{url});
  globalThis.MutationObserver=dom.window.MutationObserver;
  const events=new Map();
  const routes=[];
  const win={
    location:{hostname:new URL(url).hostname,search:new URL(url).search,assign:path=>routes.push(path)},
    addEventListener(name,fn){events.set(name,fn)},
    removeEventListener(name){events.delete(name)},
    emit(name){events.get(name)?.()}
  };
  return{dom,win,routes};
};
const config=(enabled,authenticated)=>({ok:true,json:async()=>({enabled,authenticated})});
const profile=(id='42',firstName='Иван',lastName='Петров')=>({ok:true,json:async()=>({authenticated:true,user:{id,firstName,lastName}})});

test('widget is explicitly staging-only, never imported into production UI',async()=>{
  assert.equal(isVkStatusStagingHost('vk-test.awgcars.ru'),true);
  assert.equal(isVkStatusStagingHost('awgcars.ru'),false);
  assert.equal(isVkStatusStagingHost('www.awgcars.ru'),false);
  const {dom,win}=fakeBrowser('https://awgcars.ru/');
  assert.equal(initializeVkStatusWidget({win,doc:dom.window.document}),null);
  assert.equal(dom.window.document.querySelector('[data-vk-status-widget]'),null);
  dom.window.close();
});

test('plain web signed cookie logged out shows small red VK Войти badge; click starts VK login',async()=>{
  const {dom,win,routes}=fakeBrowser();
  const controller=initializeVkStatusWidget({win,doc:dom.window.document,fetchImpl:async path=>{
    assert.equal(path,'/api/auto-sale/vk/web/config');
    return config(true,false);
  }});
  await tick();
  const badge=dom.window.document.querySelector('[data-vk-status-widget]');
  assert.equal(badge.parentElement.className,'auto-topbar');
  assert.equal(badge.dataset.vkStatus,'out');
  assert.equal(badge.querySelector('[data-vk-status-caption]').textContent,'Войти');
  assert.match(badge.querySelector('button').getAttribute('aria-label'),/не выполнен вход/);
  badge.querySelector('[data-vk-status-trigger]').click();
  assert.deepEqual(routes,['/api/auto-sale/vk/web/start']);
  controller.destroy();
  dom.window.close();
});

test('plain web validated VK profile displays logged in status and name in expandable panel',async()=>{
  const {dom,win}=fakeBrowser();
  const calls=[];
  const controller=initializeVkStatusWidget({win,doc:dom.window.document,fetchImpl:async path=>{
    calls.push(path);
    return path.endsWith('/config')?config(true,true):profile();
  }});
  await tick();
  const badge=dom.window.document.querySelector('[data-vk-status-widget]');
  assert.equal(badge.dataset.vkStatus,'in');
  assert.equal(badge.querySelector('[data-vk-status-caption]').textContent,'Вошли');
  assert.match(badge.querySelector('button').getAttribute('aria-label'),/Иван Петров/);
  badge.querySelector('[data-vk-status-trigger]').click();
  assert.equal(badge.querySelector('[data-vk-status-panel]').hidden,false);
  assert.match(badge.querySelector('[data-vk-status-message]').textContent,/Иван Петров/);
  assert.equal(badge.querySelectorAll('[data-vk-status-logout]').length,1);
  assert.deepEqual(calls,['/api/auto-sale/vk/web/config','/api/auto-sale/vk/web/profile']);
  controller.destroy();
  dom.window.close();
});

test('mini app signed-looking URL never authorizes by itself; only backend verified VK access enables badge',async()=>{
  const {dom,win}=fakeBrowser('https://vk-test.awgcars.ru/?vk_app_id=777&vk_user_id=42&sign=untrusted');
  win.__AUTO_SALE_ACCESS__={role:'public',authenticated:false,authType:'public'};
  win.__AUTO_SALE_SERVER__={online:true};
  const widget=initializeVkStatusWidget({win,doc:dom.window.document,fetchImpl:async()=>{throw Error('mini app must not call VK web config')}});
  await tick();
  const badge=dom.window.document.querySelector('[data-vk-status-widget]');
  assert.equal(badge.dataset.vkStatus,'out');
  assert.equal(badge.querySelector('[data-vk-status-caption]').textContent,'Войти');
  win.__AUTO_SALE_ACCESS__={role:'client',authenticated:true,authType:'vk',identity:{provider:'vk',id:'42'},user:{first_name:'Анна',last_name:'Тест'}};
  win.__AUTO_SALE_VK_USER__={displayName:'Анна Тест'};
  win.emit('auto-sale-server-synced');
  assert.equal(badge.dataset.vkStatus,'in');
  assert.match(badge.querySelector('button').getAttribute('aria-label'),/Анна Тест/);
  assert.equal(badge.querySelector('[data-vk-status-logout]'),null,'mini app should not offer unrelated web-cookie logout');
  widget.destroy();
  dom.window.close();
});

test('status indicator persists when application header is rerendered',async()=>{
  const {dom,win}=fakeBrowser();
  const widget=initializeVkStatusWidget({win,doc:dom.window.document,fetchImpl:async()=>config(true,false)});
  await tick();
  const old=dom.window.document.querySelector('[data-vk-status-widget]');
  dom.window.document.getElementById('app').innerHTML='<header class="auto-topbar"><button>Новая страница</button></header>';
  await tick();
  assert.strictEqual(dom.window.document.querySelector('[data-vk-status-widget]'),old);
  assert.equal(old.parentElement.className,'auto-topbar');
  widget.destroy();
  dom.window.close();
});

test('backend-verified VK only, never a server public or Telegram session',()=>{
  assert.equal(deriveVkStatus({mode:'mini',access:{authenticated:true,authType:'telegram',identity:{provider:'telegram',id:'42'}}}).status,'pending');
  assert.equal(deriveVkStatus({mode:'mini',access:{authenticated:true,authType:'vk',identity:{provider:'vk',id:'42'}}}).status,'in');
  assert.equal(deriveVkStatus({mode:'web',config:{enabled:false,authenticated:false}}).status,'unavailable');
  assert.equal(deriveVkStatus({mode:'web',config:{enabled:true,authenticated:false}}).status,'out');
});
