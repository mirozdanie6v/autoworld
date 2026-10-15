import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {parseNotificationHash,telegramNotificationUrl} from '../shared/auto-sale-notification-links.mjs';

const APP_URL='https://awgcars.ru/';
const lead={id:'L-TG-42',name:'Клиент',clientCreated:true,clientProvider:'telegram',
  telegramUserId:'700',manager:'Дмитрий',managerTelegramUserId:'800',
  status:'Новый',model:'Toyota'};
const quote={id:'Q-TG-42',leadId:lead.id,status:'Черновик',model:'Toyota',total:20000};
const order={id:'O-TG-42',leadId:lead.id,stage:'Выкуп',model:'Toyota',total:20000,paid:0,payments:[]};
const state=()=>({initialized:true,revision:18,leads:[{...lead}],quotes:[],orders:[],
  team:[{name:'Дмитрий',role:'Менеджер',active:true,telegramUserId:'800'}]});
const svc=()=>createTelegramService({token:'test-telegram-bot-token',managerChatIds:''});

test('Telegram notification links preserve HTTPS origin and exact lead/quote/order, never grant access',()=>{
  for(const [key,id] of [['leadId','L/one'],['quoteId','Q ?'],['orderId','O-1']]){
    const value=telegramNotificationUrl('https://awgcars.ru/?source=bot#tgWebAppData=irrelevant',{[key]:id});
    const url=new URL(value);
    assert.equal(url.origin,'https://awgcars.ru');
    assert.equal(url.searchParams.get('source'),'bot');
    assert.equal(url.hash,'#tgWebAppData=irrelevant');
    assert.deepEqual(parseNotificationHash(url.searchParams.get('awg_notification')),
      {type:key.replace('Id',''),id});
  }
  assert.equal(telegramNotificationUrl('http://insecure.local/',{leadId:'L'}),'');
  assert.equal(telegramNotificationUrl('javascript:alert(1)',{leadId:'L'}),'');
  assert.equal(telegramNotificationUrl(APP_URL,{}),'');
});

test('Draft calculations never produce a Telegram or VK notification for client or manager',async()=>{
  const service=svc();
  const before=state();
  const created={...before,quotes:[{...quote}]};
  const edited={...created,quotes:[{...quote,total:25000}]};
  const reversed={...created,quotes:[{...quote,status:'Отправлен'}]};
  const backToDraft={...reversed,quotes:[{...quote,status:'Черновик'}]};
  for(const options of [{telegramEnabled:true,vkEnabled:true},{telegramEnabled:false,vkEnabled:true},{telegramEnabled:true,vkEnabled:false}]){
    for(const [oldState,newState] of [[before,created],[created,edited],[reversed,backToDraft]]){
      assert.deepEqual(await service.collectStateChanges(oldState,newState,options),[],
        'any draft should be internal for all channels');
    }
  }
  const sent=await service.collectStateChanges(created,reversed);
  assert.equal(sent.length,2);
  assert.ok(sent.every(event=>event.event==='quote_status'&&event.message.includes('Отправлен')));
});

test('Telegram Web App buttons go to exact authorized entities, not just the app homepage',async()=>{
  const previous=process.env.AUTO_SALE_TELEGRAM_APP_URL;
  process.env.AUTO_SALE_TELEGRAM_APP_URL=APP_URL;
  try{
    const service=svc();
    let before=state();
    let after={...before,leads:[{...lead,status:'В работе'}]};
    let events=await service.collectStateChanges(before,after);
    assert.equal(events.length,2);
    for(const item of events){
      const button=item.replyMarkup?.inline_keyboard?.[0]?.[0];
      assert.equal(button.text,'Открыть заявку');
      assert.equal(new URL(button.web_app.url).searchParams.get('awg_notification'),'auto-mir/lead/L-TG-42');
    }
    before=after;after={...before,quotes:[{...quote,status:'Отправлен'}]};
    events=await service.collectStateChanges(before,after);
    assert.equal(events.length,2);
    for(const item of events){
      const button=item.replyMarkup?.inline_keyboard?.[0]?.[0];
      assert.equal(button.text,'Посмотреть расчёт');
      assert.equal(new URL(button.web_app.url).searchParams.get('awg_notification'),'auto-mir/quote/Q-TG-42');
    }
    before=after;after={...before,orders:[{...order}]};
    events=await service.collectStateChanges(before,after);
    assert.equal(events.length,2);
    for(const item of events){
      const button=item.replyMarkup?.inline_keyboard?.[0]?.[0];
      assert.equal(button.text,'Открыть заказ');
      assert.equal(new URL(button.web_app.url).searchParams.get('awg_notification'),'auto-mir/order/O-TG-42');
    }
    before=after;after={...before,orders:[{...order,stage:'В пути'}]};
    events=await service.collectStateChanges(before,after);
    assert.equal(events.length,2);
    for(const item of events){
      const button=item.replyMarkup?.inline_keyboard?.[0]?.[0];
      assert.equal(new URL(button.web_app.url).searchParams.get('awg_notification'),'auto-mir/order/O-TG-42');
    }
    before=after;after={...before,orders:[{...order,stage:'В пути',payments:[{id:'P-1',amount:2500}],paid:2500}]};
    events=await service.collectStateChanges(before,after);
    assert.equal(events.length,2);
    for(const item of events){
      const button=item.replyMarkup?.inline_keyboard?.[0]?.[0];
      assert.equal(new URL(button.web_app.url).searchParams.get('awg_notification'),'auto-mir/order/O-TG-42');
    }
  }finally{
    if(previous===undefined)delete process.env.AUTO_SALE_TELEGRAM_APP_URL;
    else process.env.AUTO_SALE_TELEGRAM_APP_URL=previous;
  }
});

test('VK clients receive the same draft suppression, but sent quotes retain VK target',async()=>{
  const service=svc(),before={...state(),leads:[{...lead,clientProvider:'vk',clientProviderUserId:'42',telegramUserId:''}]};
  const first={...before,quotes:[{...quote}]};
  assert.deepEqual(await service.collectStateChanges(before,first,{telegramEnabled:true,vkEnabled:true}),[]);
  const second={...first,quotes:[{...quote,status:'Отправлен'}]};
  const items=await service.collectStateChanges(first,second,{telegramEnabled:true,vkEnabled:true});
  assert.equal(items.length,2);
  const vk=items.find(x=>x.channel==='vk');
  assert.equal(vk.vkUserId,'42');
  assert.equal(vk.quoteId,quote.id);
  assert.equal(items.filter(x=>x.channel==='telegram').length,1);
});
