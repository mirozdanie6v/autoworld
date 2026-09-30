import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedQuotes,seedOrders,seedTeam} from './fixtures/auto-sale-business.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('direct submit bridge reaches the core quote saver and persists a draft',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://auto-sale.viiversion.com/'});
  globalThis.window=dom.window;
  globalThis.document=dom.window.document;
  globalThis.localStorage=dom.window.localStorage;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.FormData=dom.window.FormData;
  globalThis.Event=dom.window.Event;
  globalThis.CustomEvent=dom.window.CustomEvent;
  globalThis.MutationObserver=dom.window.MutationObserver;
  globalThis.HTMLFormElement=dom.window.HTMLFormElement;
  globalThis.EventTarget=dom.window.EventTarget;
  globalThis.Element=dom.window.Element;
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads()));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));

  await import(`../public/auto-sale-submit-bridge.mjs?bridge=${Date.now()}-${Math.random()}`);
  await import(`../public/auto-sale-app-v3.mjs?app=${Date.now()}-${Math.random()}`);
  await import(`../public/auto-sale-ui-business-guard.mjs?guard=${Date.now()}-${Math.random()}`);
  await import(`../public/auto-sale-quote-save-fix.mjs?fix=${Date.now()}-${Math.random()}`);
  await tick();

  const root=document.querySelector('#app');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-108"]').click();
  await tick();
  root.querySelector('[data-create-quote="L-108"]').click();
  await tick();
  const form=root.querySelector('#quoteForm');
  assert.ok(form);
  assert.equal(form.elements.leadId.value,'L-108');
  assert.equal(form.elements.status.value,'Черновик');
  assert.equal(typeof window.__AUTO_SALE_INVOKE_ROOT_SUBMIT__,'function');
  assert.equal(window.__AUTO_SALE_INVOKE_ROOT_SUBMIT__(form),true);
  await tick();

  const saved=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(q=>q.leadId==='L-108');
  assert.ok(saved);
  assert.equal(saved.status,'Черновик');
  assert.equal(saved.service,1500);
  assert.equal(root.querySelector('#quoteForm'),null);
  dom.window.close();
});


test('submit bridge preserves a changed lead status from the live form',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://auto-sale.viiversion.com/'});
  globalThis.window=dom.window;
  globalThis.document=dom.window.document;
  globalThis.localStorage=dom.window.localStorage;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.FormData=dom.window.FormData;
  globalThis.Event=dom.window.Event;
  globalThis.CustomEvent=dom.window.CustomEvent;
  globalThis.MutationObserver=dom.window.MutationObserver;
  globalThis.HTMLFormElement=dom.window.HTMLFormElement;
  globalThis.EventTarget=dom.window.EventTarget;
  globalThis.Element=dom.window.Element;
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads()));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));

  await import(`../public/auto-sale-submit-bridge.mjs?lead-bridge=${Date.now()}-${Math.random()}`);
  await import(`../public/auto-sale-app-v3.mjs?lead-app=${Date.now()}-${Math.random()}`);
  await tick();

  const root=document.querySelector('#app');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-106"]').click();
  const form=root.querySelector('#leadEditForm');
  assert.ok(form);
  assert.equal(form.elements.status.value,'Новый');
  form.elements.status.value='В работе';
  form.elements.note.value='Bridge live value test';
  form.querySelector('button[type="submit"]').click();
  await tick();

  const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(x=>x.id==='L-106');
  assert.equal(saved.status,'В работе');
  assert.equal(saved.note,'Bridge live value test');
  dom.window.close();
});
