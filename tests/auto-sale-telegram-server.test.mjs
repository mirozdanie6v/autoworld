import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {syncYdbState} from '../server/ydb-sync.mjs';

const TOKEN='123456:TEST_TOKEN';

test('same manager Telegram username resolves only through an already linked team account',()=>{
  const service=createTelegramService({token:TOKEN,managerChatIds:''});
  const state={team:[{name:'Иван',telegram:'@Flyer_Flyer'},{name:'Дмитрий',telegramUsername:'Flyer_Flyer',telegramUserId:'700'}]};
  assert.deepEqual(service.managerIds({manager:'Иван'},state),['700']);
  assert.deepEqual(service.managerIds({manager:'Иван'},{team:[state.team[0]]}),[]);
});

test('unlinked assigned manager falls back to other active linked managers',()=>{
  const service=createTelegramService({token:TOKEN,managerChatIds:''});
  const state={team:[
    {name:'Иван',role:'Менеджер',active:true,telegramUsername:'Ivan_AWG'},
    {name:'Дмитрий',role:'Менеджер',active:true,telegramUsername:'Flyer_Flyer',telegramUserId:'700'},
    {name:'Алексей',role:'Менеджер',active:true,telegramUsername:'smit44744',telegramUserId:'701'},
    {name:'Архив',role:'Менеджер',active:false,telegramUserId:'702'}
  ]};
  assert.deepEqual(service.managerIds({manager:'Иван'},state),['700','701']);
});

test('outbox planning preserves both roles in one chat and unique IDs for every transition',async()=>{
  let calls=0;
  const service=createTelegramService({token:TOKEN,managerChatIds:'',relayUrl:'',fetchImpl:async()=>{calls++;throw new Error('offline')}});
  let state={revision:1,initialized:true,leads:[{id:'L',name:'TEST',model:'TEST',contact:'@Flyer_Flyer',nextAction:'2026-10-01',status:'Новый',clientCreated:true,telegramUserId:'700',managerTelegramUserId:'700'}],quotes:[],orders:[]};
  const ids=new Set();
  for(const status of ['В работе','Расчёт','В работе','Расчёт','Ожидает клиента']){
    const next=structuredClone(state);next.revision++;next.leads[0].status=status;
    const planned=await service.collectStateChanges(state,next);
    assert.equal(planned.length,2);assert.deepEqual(planned.map(x=>x.target),['client','manager']);
    for(const item of planned){assert.equal(item.chatId,'700');assert.ok(!ids.has(item.id));ids.add(item.id)}
    state=next;
  }
  assert.equal(calls,0,'planning must never send before commit');
});

test('new sent quote and changes request notify both roles even without a prior quote status transition',async()=>{
  const service=createTelegramService({token:TOKEN,managerChatIds:'',relayUrl:'',fetchImpl:async()=>{}});
  const previous={revision:1,initialized:true,leads:[{id:'L',telegramUserId:'700',managerTelegramUserId:'700'}],quotes:[],orders:[]};
  const next=structuredClone(previous);next.quotes=[{id:'Q',leadId:'L',status:'Отправлен',total:100}];
  assert.equal((await service.collectStateChanges(previous,next)).filter(x=>x.event==='quote_status').length,2);
  const changes=structuredClone(next);changes.quotes[0].clientDecision='changes_requested';changes.quotes[0].clientComment='Другой цвет';
  const events=await service.collectStateChanges(next,changes);
  assert.equal(events.length,2);assert.ok(events.every(x=>x.event==='quote_changes_requested'&&x.message.includes('Другой цвет')));
});

test('state sync passes notifications into the same commit and never sends on rejected state',async()=>{
  let committed=null,prepared=0;
  const previous={revision:1,initialized:true,leads:[{id:'L',name:'TEST',model:'TEST',contact:'@test',nextAction:'2026-10-01',status:'Новый'}],quotes:[],orders:[],team:[],catalog:[],notes:{}};
  const store={loadState:async()=>structuredClone(previous),replaceState:async(state,options)=>{committed={state,options};return{status:200,data:{ok:true,revision:2}}}};
  const input=structuredClone(previous);input.leads[0].status='В работе';
  const prepareNotifications=async()=>{prepared++;return[{id:'event-2',message:'message'}]};
  const result=await syncYdbState(store,input,{prepareNotifications});
  assert.equal(result.status,200);assert.deepEqual(committed.options.notifications,[{id:'event-2',message:'message'}]);
  assert.deepEqual(result.data.notifications.ids,['event-2']);
  input.leads[0].status='Сделка';committed=null;
  assert.equal((await syncYdbState(store,input,{prepareNotifications})).status,400);
  assert.equal(prepared,1);assert.equal(committed,null);
});
function initData(user,{authDate=2000000000}={}){
  const params=new URLSearchParams();
  params.set('auth_date',String(authDate));
  params.set('query_id','AAEAAAE');
  params.set('user',JSON.stringify(user));
  const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=createHmac('sha256','WebAppData').update(TOKEN).digest();
  const hash=createHmac('sha256',secret).update(check).digest('hex');
  params.set('hash',hash);
  return params.toString();
}
function fakeFetch(sent){
  return async(url,options)=>{
    sent.push({url,body:JSON.parse(options.body)});
    return{ok:true,status:200,async json(){return{ok:true,result:{message_id:sent.length}}}};
  };
}

test('Telegram WebApp initData is verified server-side',()=>{
  const service=createTelegramService({token:TOKEN,fetchImpl:async()=>{},now:()=>2000000100*1000});
  const valid=service.validateInitData(initData({id:42,username:'manager'}));
  assert.equal(valid.ok,true);
  assert.equal(valid.user.id,'42');
  const tampered=initData({id:42,username:'manager'}).replace('manager','hacker');
  assert.equal(service.validateInitData(tampered).ok,false);
});

test('manual manager message can only target the linked client',async()=>{
  const sent=[];
  const service=createTelegramService({token:TOKEN,fetchImpl:fakeFetch(sent),managerChatIds:'900',relayUrl:''});
  const state={leads:[{
    id:'L-1',name:'Client',model:'BMW X5',telegramUserId:'700',
    managerTelegramUserId:'800'
  }]};
  await assert.rejects(()=>service.sendManual(state,{leadId:'L-1',target:'client',text:'Hello',senderId:'999'}),/telegram_sender_forbidden/);
  const result=await service.sendManual(state,{leadId:'L-1',target:'client',text:'Hello',senderId:'800'});
  assert.equal(result.ok,true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].body.chat_id,'700');
  assert.match(sent[0].body.text,/AUTO МИР · сообщение менеджера/);
});

test('pinned admin can message any client regardless of assigned manager',async()=>{
  const sent=[];
  const service=createTelegramService({token:TOKEN,fetchImpl:fakeFetch(sent),managerChatIds:'',relayUrl:''});
  const state={leads:[{id:'L-ADMIN',name:'Client',model:'Audi Q7',telegramUserId:'700',managerTelegramUserId:'800'}]};
  const result=await service.sendManual(state,{leadId:'L-ADMIN',target:'client',text:'Admin message',senderId:'999',isAdmin:true});
  assert.equal(result.ok,true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].body.chat_id,'700');
});

test('fallback manager chat ids receive new client request notifications',async()=>{
  const sent=[];
  const service=createTelegramService({token:TOKEN,fetchImpl:fakeFetch(sent),managerChatIds:'900,901',relayUrl:''});
  const previous={initialized:true,leads:[],quotes:[],orders:[]};
  const next={initialized:true,leads:[{
    id:'L-NEW',name:'Anna',model:'Audi Q5',budget:40000,contact:'@anna',
    clientCreated:true,telegramUserId:'700'
  }],quotes:[],orders:[]};
  const deliveries=await service.notifyStateChanges(previous,next);
  assert.equal(deliveries.filter(x=>x.target==='manager').length,2);
  assert.equal(deliveries.filter(x=>x.target==='client').length,1);
  assert.deepEqual(sent.map(x=>x.body.chat_id),['900','901','700']);
  assert.match(sent[0].body.text,/новая заявка/);
  assert.match(sent[2].body.text,/заявка принята/);
});

test('order stage and payment changes notify linked client and manager',async()=>{
  const sent=[];
  const service=createTelegramService({token:TOKEN,fetchImpl:fakeFetch(sent)});
  const lead={id:'L-1',name:'Client',model:'BMW X5',telegramUserId:'700',managerTelegramUserId:'800'};
  const previous={initialized:true,leads:[lead],quotes:[],orders:[{
    id:'O-1',leadId:'L-1',model:'BMW X5',stage:'Выкуп',paid:10000,total:39000,
    payments:[{id:'PAY-1',amount:10000,paymentStage:'auction_deposit'}],
    paymentPlan:[{id:'auction_deposit',title:'1. Аукционный аванс',amount:10000},{id:'auction_balance',title:'2. Автомобиль + аукционные сборы',amount:17000}]
  }]};
  const next=structuredClone(previous);
  next.orders[0].stage='Порт США';
  next.orders[0].paid=27000;
  next.orders[0].payments.push({id:'PAY-2',amount:17000,paymentStage:'auction_balance'});
  const deliveries=await service.notifyStateChanges(previous,next);
  assert.equal(deliveries.filter(x=>x.event==='order_stage').length,2);
  assert.equal(deliveries.filter(x=>x.event==='payment').length,2);
  assert.equal(sent.length,4);
  assert.ok(sent.some(x=>/Автомобиль \+ аукционные сборы/.test(x.body.text)));
});

test('webhook replies to start with a Mini App button',async()=>{
  const sent=[];
  const service=createTelegramService({token:TOKEN,fetchImpl:fakeFetch(sent)});
  assert.match(service.webhookPath,/^\/api\/auto-sale\/telegram\/webhook\/[a-f0-9]{32}$/);
  assert.equal(service.isWebhookPath(service.webhookPath),true);
  const result=await service.handleWebhookUpdate({
    message:{chat:{id:700},from:{id:700,first_name:'Анна'},text:'/start'}
  },{appUrl:'https://example.test/'});
  assert.equal(result.ok,true);
  assert.equal(sent.length,1);
  assert.match(sent[0].body.text,/AUTO МИР/);
  assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].web_app.url,'https://example.test/');
});

test('webhook help command explains the customer flow',async()=>{
  const sent=[];
  const service=createTelegramService({token:TOKEN,fetchImpl:fakeFetch(sent)});
  await service.handleWebhookUpdate({message:{chat:{id:700},from:{id:700},text:'/help'}},{appUrl:'https://example.test/'});
  assert.match(sent[0].body.text,/Выбрать авто из США или Грузии/);
  assert.match(sent[0].body.text,/Следить за этапами заказа и оплатами/);
});


test('full Telegram notification lifecycle keeps client and manager event sequence',async()=>{
  const sent=[];
  const service=createTelegramService({token:TOKEN,fetchImpl:fakeFetch(sent)});
  const lead={id:'L-E2E',name:'Анна',model:'BMW X5',budget:45000,contact:'@anna',clientCreated:true,telegramUserId:'700',managerTelegramUserId:'800',status:'Новый'};
  let prev={initialized:true,leads:[],quotes:[],orders:[]};
  let next={initialized:true,leads:[lead],quotes:[],orders:[]};
  const all=[];
  all.push(...await service.notifyStateChanges(prev,next));
  prev=structuredClone(next);next.leads[0].status='В работе';all.push(...await service.notifyStateChanges(prev,next));
  prev=structuredClone(next);next.leads[0].status='Ожидает клиента';next.quotes=[{id:'Q-E2E',leadId:'L-E2E',model:'BMW X5',status:'Отправлен',total:39000}];all.push(...await service.notifyStateChanges(prev,next));
  prev=structuredClone(next);next.quotes[0].status='Согласован';all.push(...await service.notifyStateChanges(prev,next));
  prev=structuredClone(next);next.leads[0].status='Сделка';next.orders=[{id:'O-E2E',leadId:'L-E2E',model:'BMW X5',stage:'Выкуп',paid:10000,total:39000,paymentPlan:[{id:'auction_deposit',title:'1. Аукционный аванс',amount:10000}],payments:[{id:'P1',amount:10000,paymentStage:'auction_deposit'}]}];all.push(...await service.notifyStateChanges(prev,next));
  for(const stage of ['Порт США','В море','Таможня','Доставка','Выдача']){prev=structuredClone(next);next.orders[0].stage=stage;all.push(...await service.notifyStateChanges(prev,next));}
  prev=structuredClone(next);next.orders[0].paid=39000;next.orders[0].payments.push({id:'P2',amount:29000,paymentStage:'final'});all.push(...await service.notifyStateChanges(prev,next));
  const client=all.filter(x=>x.target==='client'&&x.ok);
  const manager=all.filter(x=>x.target==='manager'&&x.ok);
  for(const event of ['lead_created_confirmation','lead_status','quote_status','order_created','order_stage','payment'])assert.ok(client.some(x=>x.event===event),event+' client');
  for(const event of ['lead_created','lead_status','quote_status','order_created','order_stage','payment'])assert.ok(manager.some(x=>x.event===event),event+' manager');
  assert.equal(client.filter(x=>x.event==='order_stage').length,5);
  assert.equal(manager.filter(x=>x.event==='order_stage').length,5);
  assert.ok(client.some(x=>x.event==='order_stage'));
  assert.ok(client.some(x=>x.event==='payment'));
  assert.ok(manager.some(x=>x.event==='order_stage'));
});

test('Telegram manager fan-out continues after one recipient fails',async()=>{
  const attempted=[];
  const fetchImpl=async(url,options)=>{
    const body=JSON.parse(options.body);
    attempted.push(String(body.chat_id));
    if(String(body.chat_id)==='900'){
      return{ok:false,status:403,async json(){return{ok:false,description:'Forbidden: bot was blocked by the user'}}};
    }
    return{ok:true,status:200,async json(){return{ok:true,result:{message_id:attempted.length}}}};
  };
  const service=createTelegramService({token:TOKEN,fetchImpl,managerChatIds:'900,901',relayUrl:''});
  const previous={initialized:true,revision:1,leads:[],quotes:[],orders:[]};
  const next={initialized:true,revision:2,leads:[{
    id:'L-FANOUT',name:'Client',model:'BMW X5',contact:'@client',
    clientCreated:true,telegramUserId:'700',status:'Новый'
  }],quotes:[],orders:[]};
  const deliveries=await service.notifyStateChanges(previous,next);
  const managers=deliveries.filter(x=>x.target==='manager');
  assert.equal(managers.length,2);
  assert.equal(managers.find(x=>x.chatId==='900').ok,false);
  assert.equal(managers.find(x=>x.chatId==='901').ok,true);
  assert.equal(deliveries.find(x=>x.target==='client').ok,true);
  assert.deepEqual(attempted,['900','901','700']);
});


test('invited Telegram admins are captured from webhook updates for manager routing',async()=>{
  const server=await readFile(new URL('../server/yandex-server.mjs',import.meta.url),'utf8');
  assert.match(server,/claimAdminFromWebhook/);
  assert.match(server,/claimAdminAccess\(username,userId\)/);
  assert.match(server,/enrichStateWithAdminPins/);
  assert.match(server,/managerTelegramUsername/);
  assert.match(server,/routingReady:Boolean\(member&&\/\^\\d\+\$\/\.test/);
});

test('Telegram notification planning uses pinned admin identities as manager routes',async()=>{
  const server=await readFile(new URL('../server/yandex-server.mjs',import.meta.url),'utf8');
  assert.match(server,/async function collectTelegramStateChanges/);
  assert.match(server,/prepareNotifications:notifyTelegram\?collectTelegramStateChanges:null/);
  assert.match(server,/const healthState=enrichStateWithAdminPins/);
});
