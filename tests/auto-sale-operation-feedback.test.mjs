import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {describeOperation, installOperationFeedback} from '../public/auto-sale-operation-feedback.mjs';

test('classifies high-risk changes as blocking operations',()=>{
  assert.equal(describeOperation([{resource:'order',operation:'create',id:'O-1'}]).kind,'modal');
  assert.equal(describeOperation([{resource:'payment',operation:'create',orderId:'O-1'}]).kind,'modal');
  assert.equal(describeOperation([{resource:'order',operation:'patch',id:'O-1',input:{stage:'Доставка'}}]).kind,'modal');
  assert.equal(describeOperation([{resource:'order',operation:'patch',id:'O-1',input:{vin:'123'}}]).kind,'inline');
  assert.equal(describeOperation([{resource:'lead',operation:'patch',id:'L-1'}]).kind,'inline');
  assert.equal(describeOperation([{resource:'note',operation:'create',leadId:'L-1'}]),null);
});

test('shows success only after server confirms, not before',async()=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body><button id="save">Save</button></body></html>');
  const win=dom.window;
  let resolveRequest;
  win.__AUTO_SALE_ENTITY_BATCH__=()=>new Promise(resolve=>{resolveRequest=resolve});
  const controller=installOperationFeedback(win);
  assert.ok(controller);
  const action=win.__AUTO_SALE_ENTITY_BATCH__([{resource:'order',operation:'create',id:'O-1'}]);
  const overlay=win.document.querySelector('.awg-op-overlay');
  const toast=win.document.querySelector('.awg-op-toast');
  assert.equal(overlay.hidden,false);
  assert.equal(toast.hidden,true);
  resolveRequest({ok:true,revision:123});
  await action;
  assert.equal(overlay.hidden,true);
  assert.equal(toast.dataset.state,'success');
  assert.match(toast.textContent,/Заказ создан/);
  win.close();
});

test('rejected saves never report success; blocking indicator disappears',async()=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const win=dom.window;
  win.__AUTO_SALE_ENTITY_BATCH__=async()=>{const e=new Error('entity_conflict');e.code='entity_conflict';throw e};
  installOperationFeedback(win);
  await assert.rejects(win.__AUTO_SALE_ENTITY_BATCH__([{resource:'payment',operation:'create',orderId:'O-1'}]),/entity_conflict/);
  assert.equal(win.document.querySelector('.awg-op-overlay').hidden,true);
  const toast=win.document.querySelector('.awg-op-toast');
  assert.equal(toast.dataset.state,'error');
  assert.doesNotMatch(toast.textContent,/зарегистрирован/);
  win.close();
});

test('note-only background write never creates a progress message',async()=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const win=dom.window;
  win.__AUTO_SALE_ENTITY_BATCH__=async()=>({ok:true});
  installOperationFeedback(win);
  await win.__AUTO_SALE_ENTITY_BATCH__([{resource:'note',operation:'create',leadId:'L-1'}]);
  assert.equal(win.document.querySelector('.awg-op-toast').hidden,true);
  assert.equal(win.document.querySelector('.awg-op-overlay').hidden,true);
  win.close();
});

test('photo progress reports completed files, not synthetic percentages',()=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const win=dom.window;
  win.__AUTO_SALE_ENTITY_BATCH__=async()=>({ok:true});
  const ctrl=installOperationFeedback(win);
  ctrl.uploadStart('photos',3,'Загрузка фото');
  ctrl.uploadStep('photos');
  ctrl.uploadStep('photos');
  const toast=win.document.querySelector('.awg-op-toast');
  assert.match(toast.textContent,/2 из 3/);
  assert.doesNotMatch(toast.textContent,/%/);
  ctrl.uploadEnd('photos');
  assert.equal(toast.dataset.state,'success');
  win.close();
});
