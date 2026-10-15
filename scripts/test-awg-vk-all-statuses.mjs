import assert from 'node:assert/strict';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {createVkService} from '../server/vk.mjs';
import {collectSaleNotifications,deliverSaleNotifications} from '../server/auto-sale-notifications.mjs';
import {LEAD_STATUSES,ORDER_STAGES,normalizeOrderStage} from '../public/auto-sale-core.mjs';
import {QUOTE_STATUSES} from '../public/auto-sale-business-rules.mjs';

const mode=process.argv[2]||'plan';
if(!['plan','live'].includes(mode))throw Error('valid_modes_plan_live');
const run=String(process.env.GITHUB_RUN_ID||'LOCAL');
const target='26443041';
const group='242103542';
const leadId='L-QA-VK-STATUSES-'+run;
const quoteId='Q-QA-VK-STATUSES-'+run;
const orderId='O-QA-VK-STATUSES-'+run;
let revision=300000;
const lead={
  id:leadId,name:'ТЕСТ · VK-уведомления',model:'ТЕСТ Toyota Camry',
  contact:'VK test',clientCreated:true,clientProvider:'vk',clientProviderUserId:target,
  status:'Новый',manager:'Дмитрий',budget:15000
};
const manager={id:'TM-QA',name:'Дмитрий',role:'Менеджер',active:true,telegramUserId:'800',telegramUsername:'Flyer_Flyer'};
const telegram=createTelegramService({token:'123456:TEST-NO-NETWORK',
  managerChatIds:'',fetchImpl:async()=>{throw Error('forbidden_telegram_send')}});
const config={telegramEnabled:false,vkEnabled:true};
const empty=()=>({revision:revision++,initialized:true,leads:[],quotes:[],orders:[],team:[manager]});
const withLead=()=>({...empty(),leads:[structuredClone(lead)]});
const items=[];
async function collect(label,oldState,newState,expectedEvent){
  oldState.revision=revision++;
  newState.revision=oldState.revision+1;
  const pending=await telegram.collectStateChanges(oldState,newState,config);
  assert.equal(pending.length,1,'exactly_one_vk_event_'+label);
  const [item]=pending;
  assert.equal(item.channel,'vk','no_telegram_delivery_'+label);
  assert.equal(item.target,'client','client_only_'+label);
  assert.equal(item.vkUserId,target,'exact_recipient_'+label);
  assert.equal(item.event,expectedEvent,'expected_event_'+label);
  assert.ok(item.message.includes('AUTO МИР'),'template_missing_'+label);
  assert.ok(item.message.length<3500,'vk_message_length_'+label);
  assert.ok(!items.some(x=>x.id===item.id),'duplicate_outbox_key_'+label);
  items.push({...item,label});
}

const initial=empty();
await collect('Заявка: Новый',initial,{...initial,leads:[structuredClone(lead)]},'lead_created_confirmation');
for(const status of LEAD_STATUSES.filter(s=>s!=='Новый')){
  const before=withLead();
  if(status==='Отказ')before.leads[0].status='Ожидает клиента';
  if(status==='Сделка')before.leads[0].status='Ожидает клиента';
  const after=structuredClone(before);
  after.leads[0].status=status;
  await collect('Заявка: '+status,before,after,'lead_status');
}
const quoted={id:quoteId,leadId:leadId,model:lead.model,status:'Черновик',total:15000,version:1};
const quoteStart=withLead();
await collect('Расчёт: Черновик',quoteStart,{...quoteStart,quotes:[structuredClone(quoted)]},'quote_status');
for(const status of QUOTE_STATUSES.filter(s=>s!=='Черновик')){
  const before=withLead();
  before.quotes=[{...quoted,status:status==='Отказ'?'Отправлен':'Черновик'}];
  const after=structuredClone(before);
  after.quotes[0].status=status;
  await collect('Расчёт: '+status,before,after,'quote_status');
}
const changeBefore=withLead();
changeBefore.quotes=[{...quoted,status:'Отправлен'}];
const changeAfter=structuredClone(changeBefore);
changeAfter.quotes[0].status='На согласовании';
changeAfter.quotes[0].clientDecision='changes_requested';
changeAfter.quotes[0].clientDecisionAt='2026-10-15T00:00:00.000Z';
changeAfter.quotes[0].clientComment='ТЕСТ: проверить пересчёт';
await collect('Расчёт: клиент запросил изменения',changeBefore,changeAfter,'quote_changes_requested');

const order={id:orderId,leadId:leadId,model:lead.model,status:'Активный',
  stage:'Выкуп',total:15000,paid:0,payments:[],paymentPlan:[
    {id:'deposit',title:'Депозит',amount:3000},{id:'balance',title:'Остаток',amount:12000}
  ]};
const orderBefore=withLead();
await collect('Заказ: создан · Выкуп',orderBefore,{...orderBefore,orders:[structuredClone(order)]},'order_created');
const SHIPPING_STAGES=['Подготовка к отправке','В пути','Таможня','Доставка','Выдача'];
for(const stage of SHIPPING_STAGES){
  assert.ok(ORDER_STAGES.includes(stage),'unknown_shipping_stage');
  const before=withLead();
  before.orders=[{...structuredClone(order),stage:stage==='Подготовка к отправке'?'Выкуп':SHIPPING_STAGES[SHIPPING_STAGES.indexOf(stage)-1]}];
  const after=structuredClone(before);
  after.orders[0].stage=stage;
  after.orders[0].location='ТЕСТ: контрольная точка';
  await collect('Доставка: '+stage,before,after,'order_stage');
}
assert.equal(normalizeOrderStage('Порт США'),'Подготовка к отправке');
assert.equal(normalizeOrderStage('В море'),'В пути');
for(const complete of [false,true]){
  const before=withLead();
  before.orders=[structuredClone(order)];
  if(complete){
    before.orders[0].paid=3000;
    before.orders[0].payments=[{id:'P-QA-DEPOSIT',amount:3000,paymentStage:'deposit'}];
  }
  const after=structuredClone(before);
  const added=complete
    ?{id:'P-QA-BALANCE',amount:12000,paymentStage:'balance'}
    :{id:'P-QA-DEPOSIT',amount:3000,paymentStage:'deposit'};
  after.orders[0].payments.push(added);
  after.orders[0].paid+=added.amount;
  await collect(complete?'Оплата: полностью':'Оплата: частично',before,after,'payment');
}
const expected=1+(LEAD_STATUSES.length-1)+QUOTE_STATUSES.length+1+1+SHIPPING_STAGES.length+2;
assert.equal(items.length,expected);
assert.equal(items.length,20);
const events=Object.fromEntries([...new Set(items.map(x=>x.event))].map(x=>[x,items.filter(y=>y.event===x).length]));

const testRequests=[];
const mockVk=createVkService({enabled:true,appId:'54810434',appSecret:'test-only',
  groupId:group,communityToken:'test-only',
  fetchImpl:async(_url,options)=>{
    const body=new URLSearchParams(options.body);
    testRequests.push(body);
    return{ok:true,json:async()=>({response:testRequests.length+1000})};
  }});
const marks=[];
const mockResults=await deliverSaleNotifications(items,{telegram,vk:mockVk,
  markNotification:async(id,result)=>marks.push({id,...result})});
assert.equal(mockResults.length,items.length);
assert.ok(mockResults.every(x=>x.ok&&x.channel==='vk'&&x.messageId));
assert.ok(marks.every(x=>x.ok&&x.messageId));
assert.equal(testRequests.length,items.length);
for(let i=0;i<items.length;i++){
  const body=testRequests[i],item=items[i];
  assert.equal(body.get('peer_id'),target);
  assert.equal(body.get('message'),item.message);
  assert.ok(/^\d+$/.test(body.get('random_id')||''));
  const keyboard=JSON.parse(body.get('keyboard'));
  const action=keyboard.buttons[0][0].action;
  assert.equal(action.type,'open_app');
  assert.equal(action.app_id,54810434);
  assert.equal(action.owner_id,-242103542);
  assert.ok(action.hash.startsWith('auto-mir/'));
}

const summary={mode,recipient:'vk.ru/flyer_flyer',statusTemplates:items.length,
  typeCounts:events,allVkOnly:true,correctNavigationButtons:items.length,
  oldLegacyStagesNormalized:true,databaseMutations:0,telegramMessages:0,
  messagesSent:0,messageIds:0,failed:0};
if(mode==='live'){
  assert.equal(process.env.AWG_VK_ALL_STATUS_LIVE_GUARD,'VK26443041_ALL_STATUSES_ONE_TIME_20261015');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1','avoid_replaying_real_messages');
  assert.match(run,/^\d{8,14}$/);
  const vkToken=String(process.env.AWG_VK_COMMUNITY_TOKEN||'');
  assert.ok(vkToken.length>25,'production_vk_token_missing');
  assert.equal(process.env.AUTO_SALE_VK_GROUP_ID,group);
  assert.equal(process.env.AUTO_SALE_VK_APP_ID,'54810434');
  const checked=await fetch('https://api.vk.com/method/users.get',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({access_token:vkToken,v:'5.199',user_ids:'flyer_flyer',fields:'screen_name'}).toString(),
    signal:AbortSignal.timeout(18000)
  }).then(r=>r.json());
  assert.equal(String(checked.response?.[0]?.id),target);
  assert.equal(String(checked.response?.[0]?.screen_name||'').toLowerCase(),'flyer_flyer');
  const permission=await fetch('https://api.vk.com/method/messages.isMessagesFromGroupAllowed',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({access_token:vkToken,v:'5.199',group_id:group,user_id:target}).toString(),
    signal:AbortSignal.timeout(18000)
  }).then(r=>r.json());
  assert.equal(Number(permission.response?.is_allowed),1,'VK community messages prohibited');

  const liveVk=createVkService({enabled:true,appId:'54810434',
    appSecret:String(process.env.AUTO_SALE_VK_APP_SECRET||''),
    groupId:group,communityToken:vkToken});
  assert.equal(liveVk.messagingEnabled,true);
  const delivery=[];
  for(let i=0;i<items.length;i++){
    const item=items[i];
    const prefix='[ТЕСТ AUTO МИР '+String(i+1)+'/'+items.length+']\nСценарий: '+item.label+
      '\nТолько тест сообщений VK. Не подтверждает покупку, оплату или доставку.\n\n';
    const text=prefix+item.message;
    let result;
    try{
      // Test notifications intentionally omit deep links to NON-EXISTENT test
      // entities. All 20 keyboard formats are checked against mock VK above.
      const response=await liveVk.send(target,text,{
        idempotencyKey:'AWG-VK-ALLSTAT-20261015-'+run+'-'+String(i+1)
      });
      assert.ok(String(response.message_id||''),'VK message ID missing');
      result={index:i+1,status:item.label,ok:true,hasMessageId:true};
      summary.messagesSent++;
      summary.messageIds++;
    }catch(err){
      result={index:i+1,status:item.label,ok:false,errorCode:err.vkCode||null,
        error:String(err.vkDescription||err.message||'').slice(0,180)};
      summary.failed++;
    }
    delivery.push(result);
    // Don't hammer VK API or spam faster than the allowed rate.
    await new Promise(resolve=>setTimeout(resolve,1600));
    if(!result.ok)break;
  }
  summary.liveDeliveries=delivery;
  summary.liveAllDelivered=summary.messagesSent===items.length&&summary.failed===0;
}
console.log('AWG_VK_ALL_STATUSES_REPORT',JSON.stringify(summary));
if(mode==='live'&&!summary.liveAllDelivered)process.exitCode=1;
