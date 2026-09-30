import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {seedLeads,seedQuotes,seedOrders,seedTeam} from './fixtures/auto-sale-business.mjs';
import {leadTransitionAllowed as browserLeadTransitionAllowed} from '../public/auto-sale-business-rules.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

async function setup(tag){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://auto-sale.viiversion.com/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;globalThis.sessionStorage=dom.window.sessionStorage;globalThis.FormData=dom.window.FormData;globalThis.Event=dom.window.Event;globalThis.CustomEvent=dom.window.CustomEvent;globalThis.MutationObserver=dom.window.MutationObserver;globalThis.HTMLFormElement=dom.window.HTMLFormElement;
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads()));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  await import(`../public/auto-sale-app-v3.mjs?save-app=${tag}-${Date.now()}-${Math.random()}`);
  await import(`../public/auto-sale-ui-business-guard.mjs?save-guard=${tag}-${Date.now()}-${Math.random()}`);
  await import(`../public/auto-sale-quote-save-fix.mjs?save-feedback=${tag}-${Date.now()}-${Math.random()}`);
  await tick();
  return{dom,root:document.querySelector('#app')};
}

test('server and browser both allow direct work to waiting-client transition used by sent quote',()=>{
  assert.equal(browserLeadTransitionAllowed('В работе','Ожидает клиента'),true);
  const server=fs.readFileSync('src/auto-sale/rules.ts','utf8');
  assert.match(server,/['"]В работе['"]:\[['"]Новый['"],['"]Расчёт['"],['"]Ожидает клиента['"]\]/);
});

test('active AUTO SALE save stack has no automatic page reload',()=>{
  const bootstrap=fs.readFileSync('public/auto-sale-bootstrap.mjs','utf8');
  const feedback=fs.readFileSync('public/auto-sale-quote-save-fix.mjs','utf8');
  assert.doesNotMatch(bootstrap,/location\.reload\s*\(/);
  assert.doesNotMatch(feedback,/location\.reload\s*\(/);
  assert.doesNotMatch(bootstrap,/reloadPending|refreshUiWhenSafe/);
});

test('all business forms are intercepted as SPA submits',()=>{
  const app=fs.readFileSync('public/auto-sale-app-v3.mjs','utf8');
  const guard=fs.readFileSync('public/auto-sale-ui-business-guard.mjs','utf8');
  assert.match(app,/root\.addEventListener\(['"]submit['"],(?:async\s+)?event=>\{event\.preventDefault\(\)/);
  for(const id of ['requestForm','leadEditForm','quoteForm','orderForm'])assert.match(app,new RegExp(`formId===['"]${id}['"]`));
  assert.match(app,/getAttribute\?\.\('id'\)/);
  assert.match(guard,/form\.getAttribute\?\.\('id'\)===['"]clientEditForm['"]\)\{event\.preventDefault\(\)/);
});

test('quote validation error restores save button instead of leaving saving state',async()=>{
  const {dom,root}=await setup('quote-error');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="quotes"]').click();
  root.querySelector('[data-new-quote]').click();
  await tick();
  const form=root.querySelector('#quoteForm');
  assert.ok(form);
  form.elements.status.value='Отправлен';
  const button=form.querySelector('button[type="submit"]');
  button.click();
  await tick();
  assert.equal(button.textContent,'Сохранить расчёт');
  assert.match(form.textContent,/Не удалось сохранить/i);
  dom.window.close();
});

test('manager card save shows completed state after real button click without navigation',async()=>{
  const {dom,root}=await setup('lead-success');
  const before=dom.window.location.href;
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-103"]').click();
  await tick();
  const form=root.querySelector('#leadEditForm');
  form.elements.note.value='Проверка фактического сохранения карточки';
  form.querySelector('button[type="submit"]').click();
  await tick();
  const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(x=>x.id==='L-103');
  assert.equal(saved.note,'Проверка фактического сохранения карточки');
  assert.equal(dom.window.location.href,before);
  const fresh=root.querySelector('#leadEditForm');
  assert.ok(fresh);
  assert.match(fresh.textContent,/Изменения сохранены/i);
  assert.match(fresh.querySelector('button[type="submit"]').textContent,/Сохранено|Сохранить карточку/);
  dom.window.close();
});

test('customer-facing save feedback never exposes persistence implementation details',async()=>{
  const {dom,root}=await setup('public-feedback');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-103"]').click();
  await tick();
  const form=root.querySelector('#leadEditForm');
  const forbidden=/\bD1\b|сервер|синхронизац|локальн|localStorage|\bAPI\b|база данных/i;
  for(const type of ['auto-sale-server-synced','auto-sale-server-rejected','auto-sale-server-conflict','auto-sale-server-deferred']){
    window.dispatchEvent(new dom.window.CustomEvent(type,{detail:{error:'internal_code',details:['internal_field']}}));
    await tick();
    const text=form.querySelector('.auto-save-submit-feedback')?.textContent||'';
    assert.ok(text.length>0);
    assert.doesNotMatch(text,forbidden);
    assert.doesNotMatch(text,/internal_code|internal_field/i);
  }
  dom.window.close();
});

test('quote save retries as a bubbling submit when the first submit does not reach the app handler',async()=>{
  const {dom,root}=await setup('quote-non-bubbling');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="quotes"]').click();
  root.querySelector('[data-quote="Q-501"]').click();
  await tick();
  const form=root.querySelector('#quoteForm');
  assert.ok(form);
  form.elements.model.value='BMW X5 xDrive40i 2022 MOBILE SAVE';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:false,cancelable:true}));
  await tick();
  await tick();
  const saved=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(x=>x.id==='Q-501');
  assert.equal(saved.model,'BMW X5 xDrive40i 2022 MOBILE SAVE');
  assert.equal(root.querySelector('#quoteForm'),null);
  dom.window.close();
});

test('lead form fallback saves even when base bubbling submit does not run',async()=>{
  const {dom,root}=await setup('lead-fallback');
  const before=dom.window.location.href;
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-106"]').click();
  await tick();
  const form=root.querySelector('#leadEditForm');
  form.elements.status.value='В работе';
  form.elements.note.value='Сохранено аварийным контуром';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:false,cancelable:true}));
  await tick();
  const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(x=>x.id==='L-106');
  assert.equal(saved.status,'В работе');
  assert.equal(saved.note,'Сохранено аварийным контуром');
  assert.equal(dom.window.location.href,before);
  assert.match(form.textContent,/Изменения сохранены/i);
  dom.window.close();
});

test('lead fallback reports concrete missing field instead of generic message',async()=>{
  const {dom,root}=await setup('lead-field-error');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-106"]').click();
  await tick();
  const form=root.querySelector('#leadEditForm');
  form.elements.nextAction.value='';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:false,cancelable:true}));
  await tick();
  assert.match(form.textContent,/следующего действия/i);
  assert.equal(form.elements.nextAction.getAttribute('aria-invalid'),'true');
  assert.doesNotMatch(form.textContent,/Проверьте обязательные поля и повторите/i);
  dom.window.close();
});