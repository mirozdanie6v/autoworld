import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {managerTelegramContact,managerTelegramIdentity} from '../public/auto-sale-manager-directory.mjs';

const source=await readFile(new URL('../public/auto-sale-telegram.mjs',import.meta.url),'utf8');
const catalog=await readFile(new URL('../public/auto-sale-catalog-extra.mjs',import.meta.url),'utf8');

test('Telegram Mini App identity prefills client request',()=>{
  for(const token of ['initDataUnsafe','first_name','last_name','username','telegramUserId','telegramUsername','telegramDisplayName']) assert.ok(source.includes(token),token);
  assert.ok(source.includes('autofillClientRequest'));
  assert.ok(source.includes("form.elements.managerMode?.value!=='0'"));
});

test('client order cards become openable detailed cards',()=>{
  for(const token of ['data-client-lead','showClientDetail','auto-client-order-grid','auto-client-track','LOT','VIN','Оплачено']) assert.ok(source.includes(token),token);
});

test('client can contact assigned manager in Telegram',()=>{
  assert.ok(source.includes('data-tg-manager'));
  assert.ok(source.includes('managerTelegramUsername'));
  assert.ok(source.includes('Открыть чат менеджера'));
  assert.ok(source.includes('data-tg-target="manager"'));
});

test('manager can contact client from lead using Telegram username or id',()=>{
  assert.ok(source.includes('data-tg-client'));
  assert.ok(source.includes('clientTelegram'));
  assert.ok(source.includes('telegramUserId'));
  assert.ok(source.includes('Открыть чат клиента'));
  assert.ok(source.includes('data-tg-target="client"'));
});

test('manager Telegram contact is persisted inside lead payload',()=>{
  for(const token of ['managerTelegramUsername','managerTelegramUserId','managerTelegramName','patchLead']) assert.ok(source.includes(token),token);
});

test('catalog module loads Telegram integration in current bootstrap chain',()=>{
  assert.ok(catalog.includes("await import('./auto-sale-telegram.mjs')"));
});

test('manual bot messages use verified Telegram initData instead of exposing bot token',()=>{
  for(const token of ['x-telegram-init-data','tg.initData','/api/auto-sale/telegram/message','sendBotMessage','telegramMessageForm'])assert.ok(source.includes(token),token);
  assert.equal(source.includes('AUTO_SALE_TELEGRAM_BOT_TOKEN'),false);
});

test('manager order screen can send a bot message to the linked client',()=>{
  assert.ok(source.includes('enhanceManagerOrder'));
  assert.ok(source.includes('Сообщение клиенту через бота'));
});


test('selected manager maps to canonical Telegram contact',()=>{
  assert.equal(managerTelegramContact('Дмитрий'),'@Flyer_Flyer');
  assert.equal(managerTelegramContact('Алексей'),'@smit44744');
  assert.equal(managerTelegramContact('Иван'),'@Ivan_AWG');
  assert.equal(managerTelegramContact('Дмитрий Владимиров'),'@Flyer_Flyer');
});

test('manager Telegram identity reuses confirmed team user id when available',()=>{
  const identity=managerTelegramIdentity('Алексей',[
    {name:'Алексей',telegram:'@smit44744',telegramUserId:'777001'}
  ]);
  assert.deepEqual(identity,{username:'smit44744',id:'777001',name:'Алексей'});
});

test('manager Telegram field is readonly and follows selected assignee',()=>{
  assert.ok(source.includes('syncSelectedManagerTelegram'));
  assert.ok(source.includes('readonly aria-readonly="true"'));
  assert.ok(source.includes("select[name=\"manager\"]"));
  assert.ok(source.includes('Подставляется автоматически по выбранному ответственному'));
});

test('open client detail refreshes after server or entity sync',()=>{
  assert.ok(source.includes('refreshOpenClientDetail'));
  assert.ok(source.includes("window.addEventListener('auto-sale-server-synced'"));
  assert.ok(source.includes("window.addEventListener('auto-sale-entity-synced'"));
  assert.ok(source.includes("queueMicrotask(refreshOpenClientDetail)"));
});
