import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {createVkService} from '../server/vk.mjs';
import {notificationsEnabled,notificationsSuppressed,collectSaleNotifications,deliverSaleNotifications} from '../server/auto-sale-notifications.mjs';

const empty=()=>({revision:1,initialized:true,leads:[],quotes:[],orders:[],team:[]});
const lead={id:'L-42',name:'Клиент',model:'Toyota',clientCreated:true,clientProvider:'vk',clientProviderUserId:'42',status:'Новый'};
function services({token='',responses=[{response:1001}]}={}){
  const requests=[],marks=[];
  const telegram=createTelegramService({token,managerChatIds:'900',fetchImpl:async()=>{throw new Error('unexpected_telegram_send')}});
  const vk=createVkService({enabled:true,appId:'54810434',appSecret:'test-secret',groupId:'242103542',communityToken:'test-token',fetchImpl:async(url,options)=>{
    requests.push({url,body:new URLSearchParams(options.body)});
    return{ok:true,json:async()=>responses.shift()||{response:1001}};
  }});
  return{telegram,vk,requests,marks,markNotification:async(id,result)=>marks.push({id,...result})};
}

test('VK lead confirmation is planned and delivered with Telegram disabled',async()=>{
  const s=services(),previous=empty(),next={...previous,leads:[lead]};
  assert.equal(notificationsEnabled(s.telegram,s.vk),true);
  const pending=await collectSaleNotifications(previous,next,s);
  assert.equal(s.requests.length,0,'planning must not send before the transaction');
  assert.deepEqual(pending.map(x=>[x.channel,x.target]),[['vk','client']]);
  const results=await deliverSaleNotifications(pending,s);
  assert.equal(results[0].ok,true);assert.equal(s.marks[0].ok,true);
  assert.equal(s.requests[0].body.get('peer_id'),'42');
  const keyboard=JSON.parse(s.requests[0].body.get('keyboard'));
  assert.deepEqual(keyboard.buttons[0][0].action,{type:'open_app',app_id:54810434,owner_id:-242103542,hash:'auto-mir/lead/L-42',label:'Открыть заявку'});
});

test('VK quote, order, stage and payment events survive Telegram disable or skip',async()=>{
  for(const token of ['', 'test-telegram-token']){
    const s=services({token}),options={...s,skipTelegram:true};
    let previous={...empty(),leads:[lead]};
    const transitions=[
      state=>({...state,quotes:[{id:'Q-1',leadId:lead.id,status:'Отправлен',total:15000}]}),
      state=>({...state,orders:[{id:'O-1',leadId:lead.id,stage:'Выкуп',payments:[]}]}),
      state=>({...state,orders:[{...state.orders[0],stage:'В пути'}]}),
      state=>({...state,orders:[{...state.orders[0],paid:5000,payments:[{id:'P-1',amount:5000}]}]})
    ];
    for(const transition of transitions){
      const next=transition(previous),pending=await collectSaleNotifications(previous,next,options);
      assert.equal(pending.length,1);assert.equal(pending[0].channel,'vk');
      assert.equal((await deliverSaleNotifications(pending,s))[0].ok,true);
      const action=JSON.parse(s.requests.at(-1).body.get('keyboard')).buttons[0][0].action;
      assert.equal(action.hash,pending[0].orderId?'auto-mir/order/O-1':'auto-mir/quote/Q-1');
      previous={...next,revision:previous.revision+1};
    }
  }
});

test('unconfigured VK does not queue client notifications and Telegram manager routing remains active',async()=>{
  const s=services({token:'test-telegram-token'});s.vk={messagingEnabled:false};
  const pending=await collectSaleNotifications(empty(),{...empty(),leads:[lead]},s);
  assert.deepEqual(pending.map(x=>[x.channel,x.chatId]),[['telegram','900']]);
  assert.equal(notificationsEnabled({enabled:false},{messagingEnabled:false}),false);
});

test('an unsupported keyboard falls back to text with the same idempotency key',async()=>{
  const s=services({responses:[{error:{error_code:911,error_msg:'Keyboard format is invalid'}},{response:1001}]});
  const message={id:'event:client:vk:42',channel:'vk',vkUserId:'42',message:'Расчёт готов',quoteId:'Q-1',leadId:'L-42'};
  assert.equal((await deliverSaleNotifications([message],s))[0].ok,true);
  assert.equal(s.requests.length,2);assert.ok(s.requests[0].body.has('keyboard'));assert.equal(s.requests[1].body.has('keyboard'),false);
  assert.equal(s.requests[0].body.get('random_id'),s.requests[1].body.get('random_id'));
  assert.equal(s.marks.length,1);assert.equal(s.marks[0].messageId,'1001');
});

test('VK permission denial is permanent and is not retried as a keyboard failure',async()=>{
  const s=services({responses:[{error:{error_code:901,error_msg:'Messages are not allowed'}}]});
  const result=await deliverSaleNotifications([{id:'denied',channel:'vk',vkUserId:'42',message:'Заказ',orderId:'O-1'}],s);
  assert.equal(result[0].ok,false);assert.equal(s.marks[0].permanent,true);assert.equal(s.requests.length,1);
});

test('replaying one VK outbox event preserves random_id',async()=>{
  const s=services(),message={id:'revision:event:client:vk:42',channel:'vk',vkUserId:'42',message:'Статус',leadId:'L-42'};
  await deliverSaleNotifications([message],s);await deliverSaleNotifications([message],s);
  assert.equal(s.requests[0].body.get('random_id'),s.requests[1].body.get('random_id'));
});

test('both fixture suppression headers require API-key authorization and suppress all channels',()=>{
  for(const name of ['x-auto-sale-skip-telegram','x-auto-sale-skip-notifications']){
    const headers={[name]:'1'};
    assert.equal(notificationsSuppressed(headers,{apiKey:true}),true);
    assert.equal(notificationsSuppressed(headers,{apiKey:false}),false);
    assert.equal(notificationsSuppressed({[name]:'0'},{apiKey:true}),false);
  }
  assert.equal(notificationsSuppressed({},{apiKey:true}),false);
});
