import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {AWG_GEORGIA_TARIFF_VERSION} from '../public/auto-sale-georgia-quote.mjs';

const lead={id:'L-GEO-CENTS',name:'CI buyer',model:'Toyota Camry',
 clientProvider:'vk',clientProviderUserId:'999999887',clientCreated:true,
 status:'Расчёт',manager:'Дмитрий'};
const quote={id:'Q-GEO-CENTS',leadId:lead.id,model:lead.model,origin:'Грузия',
 tariffVersion:AWG_GEORGIA_TARIFF_VERSION,status:'Отправлен',total:26657.02};
const service=createTelegramService({token:'123456:CI_ONLY',managerChatIds:'800',
 fetchImpl:async()=>{throw Error('network_send_must_not_run_in_test')}});
const previous={revision:11,initialized:true,leads:[lead],quotes:[],orders:[],team:[]};
const next=q=>({...previous,quotes:[q]});

test('Georgian cents are retained in quote status notification planned for VK client',async()=>{
 const messages=await service.collectStateChanges(previous,next(quote),{telegramEnabled:false,vkEnabled:true});
 assert.equal(messages.length,1);
 assert.equal(messages[0].channel,'vk');
 assert.equal(messages[0].event,'quote_status');
 assert.match(messages[0].message,/Стоимость: \$26,657\.02/);
});

test('Georgian cents are retained for both Telegram client and manager',async()=>{
 const tgLead={...lead,clientProvider:'telegram',clientProviderUserId:'999999887',telegramUserId:'999999887'};
 const messages=await service.collectStateChanges({...previous,leads:[tgLead]},{...next(quote),leads:[tgLead]},{telegramEnabled:true,vkEnabled:false});
 const expected=messages.filter(x=>x.event==='quote_status');
 assert.equal(expected.length,2);
 assert.ok(expected.every(x=>x.message.includes('Стоимость: $26,657.02')));
 assert.deepEqual(new Set(expected.map(x=>x.target)),new Set(['client','manager']));
});

test('USA and historical quotes keep legacy whole-dollar formatting in notifications',async()=>{
 for(const legacy of [{...quote,origin:'США',tariffVersion:'2026-10-20'},{...quote,origin:'Грузия',tariffVersion:'2026-10-20'}]){
   const items=await service.collectStateChanges(previous,next(legacy),{telegramEnabled:false,vkEnabled:true});
   assert.equal(items.length,1);
   assert.match(items[0].message,/Стоимость: \$26,657(?!\.)/);
 }
});

test('top-level client order summary uses cent-accurate Georgia formatter',async()=>{
 const source=await readFile(new URL('../public/auto-sale-telegram.mjs',import.meta.url),'utf8');
 assert.match(source,/formatGeorgiaUsd\(quote\.total\)/);
 assert.match(source,/AWG_GEORGIA_TARIFF_VERSION/);
});
