import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedQuotes,seedOrders,seedTeam} from './fixtures/auto-sale-business.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

async function boot(tag){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://auto-sale.viiversion.com/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;globalThis.sessionStorage=dom.window.sessionStorage;globalThis.FormData=dom.window.FormData;globalThis.Event=dom.window.Event;globalThis.CustomEvent=dom.window.CustomEvent;globalThis.MutationObserver=dom.window.MutationObserver;globalThis.HTMLFormElement=dom.window.HTMLFormElement;globalThis.EventTarget=dom.window.EventTarget;globalThis.Element=dom.window.Element;globalThis.Storage=dom.window.Storage;
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads()));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  localStorage.setItem('auto-sale-notes-v2',JSON.stringify({}));
  await import(`../public/auto-sale-submit-bridge.mjs?${tag}`);
  await import(`../public/auto-sale-app-v3.mjs?${tag}`);
  await import(`../public/auto-sale-ui-business-guard.mjs?${tag}`);
  await import(`../public/auto-sale-quote-lead-serialization.mjs?${tag}`);
  await import(`../public/auto-sale-quote-save-fix.mjs?${tag}`);
  await tick();
  return dom;
}

test('draft quote saves on mobile-style form with exactly one serialized lead field',async()=>{
  const tag=`mobile-${Date.now()}-${Math.random()}`;
  const dom=await boot(tag);
  const root=document.querySelector('#app');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="quotes"]').click();
  const before=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).length;
  root.querySelector('[data-new-quote]').click();
  await tick();

  const form=root.querySelector('#quoteForm');
  assert.ok(form);
  const lead=form.querySelector('select[name="leadId"]');
  assert.ok(lead?.value);
  const expectedLead=lead.value;
  lead.disabled=true;
  form.querySelectorAll('input[type="hidden"][name="leadId"]').forEach(x=>x.remove());
  assert.equal(new dom.window.FormData(form).get('leadId'),null);

  assert.equal(window.__AUTO_SALE_ENSURE_QUOTE_LEAD__(form),true);
  assert.equal(lead.disabled,false);
  assert.equal(new dom.window.FormData(form).get('leadId'),expectedLead);
  assert.equal(form.querySelectorAll('input[type="hidden"][name="leadId"]').length,0);

  form.querySelector('[name="service"]').value='1600';
  form.querySelector('button[type="submit"]').click();
  await tick();

  const rows=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'));
  assert.equal(rows.length,before+1);
  const saved=rows.at(-1);
  assert.equal(saved.status,'Черновик');
  assert.equal(saved.total,1600);
  assert.equal(saved.leadId,expectedLead);
  assert.equal(root.querySelector('#quoteForm'),null);
  assert.match(root.textContent,/Калькуляции клиентам/i);
  dom.window.close();
});

test('open quote saves using the lead selected in the active form even if cached relation became stale',async()=>{
  const tag=`stale-${Date.now()}-${Math.random()}`;
  const dom=await boot(tag);
  const root=document.querySelector('#app');

  const stale=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'));
  const row=stale.find(x=>x.id==='Q-503');
  row.leadId='L-STALE-NOT-IN-APP';
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify(stale));

  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="quotes"]').click();
  root.querySelector('[data-quote="Q-503"]').click();
  await tick();

  const form=root.querySelector('#quoteForm');
  assert.ok(form);
  const lead=form.querySelector('select[name="leadId"]');
  assert.equal(lead.value,'L-103');
  form.querySelector('[name="service"]').value='1700';
  form.querySelector('button[type="submit"]').click();
  await tick();

  assert.equal(root.querySelector('#quoteForm'),null);
  const rows=JSON.parse(localStorage.getItem('auto-sale-quotes-v2'));
  const saved=rows.find(x=>x.id==='Q-503');
  assert.equal(saved.leadId,'L-103');
  assert.equal(saved.service,1700);
  assert.equal(saved.total,32000);
  dom.window.close();
});
