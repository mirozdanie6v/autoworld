import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedQuotes,seedOrders,seedTeam} from './fixtures/auto-sale-business.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('P0: manager can repeatedly edit drive and note without losing the active lead form',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,
    HTMLFormElement:dom.window.HTMLFormElement,Element:dom.window.Element,
    EventTarget:dom.window.EventTarget,Storage:dom.window.Storage});
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads()));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  localStorage.setItem('auto-sale-notes-v2',JSON.stringify({}));
  await import('../public/auto-sale-app-v3.mjs?p0manager='+Date.now());
  const root=document.querySelector('#app');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="leads"]').click();
  root.querySelector('[data-lead="L-103"]').click();
  const form=root.querySelector('#leadEditForm');
  assert.ok(form,'manager lead edit form opens');
  const drive=form.querySelector('[name="drive"]');
  const note=form.querySelector('[name="note"]');
  assert.ok(drive&&note,'drive and manager note are editable');
  const drives=[...drive.options].map(option=>option.value).filter(Boolean);
  assert.ok(drives.length>0);
  for(let n=0;n<22;n++){
    drive.value=drives[n%drives.length];
    drive.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    note.value='Сохранить эту заметку — '+n;
    note.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    await tick();
    assert.equal(root.querySelector('#leadEditForm'),form,'editing must not close/recreate the form');
    assert.equal(form.querySelector('[name="note"]').value,'Сохранить эту заметку — '+n);
  }
  const latestDrive=drive.value;
  form.querySelector('button[type="submit"]').click();
  await tick();
  const saved=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(item=>item.id==='L-103');
  assert.equal(saved?.note,'Сохранить эту заметку — 21');
  assert.equal(saved?.drive,latestDrive);
  dom.window.close();
});
