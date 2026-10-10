import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationHash,notificationTarget,parseNotificationHash,resolveNotificationTarget} from '../shared/auto-sale-notification-links.mjs';

test('notification targets prefer the relevant order or quote and round-trip opaque IDs',()=>{
  const target=notificationTarget({leadId:'L',quoteId:'Q',orderId:'O / тест'});
  assert.deepEqual(target,{type:'order',id:'O / тест'});
  assert.deepEqual(parseNotificationHash('#'+notificationHash(target)),target);
  assert.equal(parseNotificationHash('#auto-mir/order/%ZZ'),null);
  assert.equal(parseNotificationHash('#auto-mir/admin/L'),null);
  assert.equal(notificationHash({type:'order',id:'x'.repeat(161)}),'');
});

test('a link cannot authorize access or select a foreign or draft quote',()=>{
  const state={leads:[{id:'L'}],quotes:[{id:'Q',leadId:'L',status:'Отправлен'},{id:'DRAFT',leadId:'L',status:'Черновик'},{id:'OTHER',leadId:'FOREIGN',status:'Отправлен'}],orders:[{id:'O',leadId:'L'}]};
  const client={role:'client',authenticated:true};
  assert.deepEqual(resolveNotificationTarget({type:'quote',id:'Q'},state,client),{leadId:'L',quoteId:'Q'});
  assert.deepEqual(resolveNotificationTarget({type:'order',id:'O'},state,client),{leadId:'L',orderId:'O'});
  for(const id of ['DRAFT','OTHER','MISSING'])assert.equal(resolveNotificationTarget({type:'quote',id},state,client),null);
  assert.equal(resolveNotificationTarget({type:'quote',id:'Q'},state,{role:'public',authenticated:false}),null);
});
