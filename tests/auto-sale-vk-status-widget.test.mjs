import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {deriveVkStatus,isVkStatusSupportedHost,isAutoSaleMiniAppLaunch,initializeVkStatusWidget} from '../public/auto-sale-vk-status-widget.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const fakeBrowser=(url='https://vk-test.awgcars.ru/')=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="app"><div class="auto-shell"><header class="auto-topbar"><button>АвтоМир</button></header></div></div></body></html>',{url});
  globalThis.MutationObserver=dom.window.MutationObserver;
  const events=new Map();
  const routes=[];
  const win={
    location:{hostname:new URL(url).hostname,href:url,hash:new URL(url).hash,search:new URL(url).search,assign:path=>routes.push(path)},
    addEventListener(name,fn){events.set(name,fn)},
    removeEventListener(name){events.delete(name)},
    emit(name){events.get(name)?.()}
  };
  return{dom,win,routes};
};
const config=(enabled,authenticated)=>({ok:true,json:async()=>({enabled,authenticated})});
const profile=(id='42',firstName='Иван',lastName='Петров')=>({ok:true,json:async()=>({authenticated:true,user:{id,firstName,lastName}})});

test('widget is available on AWG production + staging, excluded on unrelated sites',async()=>{
  assert.equal(isVkStatusSupportedHost('vk-test.awgcars.ru'),true);
  assert.equal(isVkStatusSupportedHost('awgcars.ru'),true);
  assert.equal(isVkStatusSupportedHost('www.awgcars.ru'),true);
  assert.equal(isVkStatusSupportedHost('evil-awgcars.ru'),false);
  assert.equal(isVkStatusSupportedHost('example.net'),false);
  const {dom,win}=fakeBrowser('https://evil-awgcars.ru/');
  assert.equal(initializeVkStatusWidget({win,doc:dom.window.document}),null);
  assert.equal(dom.window.document.querySelector('[data-vk-status-widget]'),null);
  dom.window.close();
});

test('production site shows VK login status without credentialed access when anonymous',async()=>{
  const {dom,win,routes}=fakeBrowser('https://awgcars.ru/');
  const controller=initializeVkStatusWidget({win,doc:dom.window.document,fetchImpl:async path=>{
    assert.equal(path,'/api/auto-sale/vk/web/config');
    return config(true,false);
  }});
  await tick();
  const badge=dom.window.document.querySelector('[data-vk-status-widget]');
  assert.equal(badge.dataset.vkStatus,'out');
  badge.querySelector('[data-vk-status-trigger]').click();
  assert.deepEqual(routes,['/api/auto-sale/vk/web/start']);
  controller.destroy();dom.window.close();
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

test('VK Mini App never renders VK ID web widget, even before its launch signature is verified',async()=>{
  for(const address of [
    'https://awgcars.ru/?vk_app_id=54811927&vk_user_id=42&sign=untrusted',
    'https://awgcars.ru/?vk_app_id=54811927',
    'https://vk-test.awgcars.ru/?vk_app_id=54811927&vk_platform=mobile_web&vk_user_id=42&sign=untrusted'
  ]){
    const {dom,win}=fakeBrowser(address);
    let calls=0;
    win.__AUTO_SALE_ACCESS__={role:'client',authenticated:true,authType:'vk',identity:{provider:'vk',id:'42'}};
    assert.equal(isAutoSaleMiniAppLaunch(win),true);
    const widget=initializeVkStatusWidget({win,doc:dom.window.document,fetchImpl:async()=>{calls++;throw Error('VK Mini App must not fetch VK Web config')}});
    assert.equal(widget,null,'VK launch parameters must suppress web-only widget');
    assert.equal(dom.window.document.querySelector('[data-vk-status-widget]'),null);
    assert.equal(dom.window.document.querySelector('[data-vk-status-style]'),null);
    assert.equal(calls,0);
    dom.window.close();
  }
});

test('Telegram Mini App suppresses VK ID widget for query, fragment and SDK initData launch',async()=>{
  for(const address of [
    'https://awgcars.ru/?tgWebAppVersion=8.0&tgWebAppPlatform=android',
    'https://awgcars.ru/#tgWebAppData=query_id%3Dtest&tgWebAppThemeParams=%7B%7D',
    'https://vk-test.awgcars.ru/?tgWebAppPlatform=ios',
    'https://awgcars.ru/?tgWebAppData=anything'
  ]){
    const {dom,win}=fakeBrowser(address);
    assert.equal(isAutoSaleMiniAppLaunch(win),true);
    let calls=0;
    const widget=initializeVkStatusWidget({win,doc:dom.window.document,fetchImpl:async()=>{calls++;throw Error('Telegram Mini App must not fetch VK Web config')}});
    assert.equal(widget,null);
    assert.equal(dom.window.document.querySelector('[data-vk-status-widget]'),null);
    assert.equal(calls,0);
    dom.window.close();
  }
  const {dom,win}=fakeBrowser('https://awgcars.ru/');
  win.Telegram={WebApp:{initData:'auth_date=123&hash=untrusted'}};
  assert.equal(isAutoSaleMiniAppLaunch(win),true);
  assert.equal(initializeVkStatusWidget({win,doc:dom.window.document}),null);
  dom.window.close();
});

test('ordinary browser retains VK ID even when Telegram SDK is loaded without launch data',async()=>{
  const {dom,win}=fakeBrowser('https://awgcars.ru/');
  win.Telegram={WebApp:{initData:''}};
  assert.equal(isAutoSaleMiniAppLaunch(win),false);
  const widget=initializeVkStatusWidget({win,doc:dom.window.document,fetchImpl:async()=>config(true,false)});
  await tick();
  assert.equal(dom.window.document.querySelector('[data-vk-status-widget]')?.dataset.vkStatus,'out');
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
