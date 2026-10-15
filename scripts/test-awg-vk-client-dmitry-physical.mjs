import assert from 'node:assert/strict';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createVkService} from '../server/vk.mjs';
import {createTelegramService} from '../server/telegram-bot.mjs';

const token=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'');
const vkToken=String(process.env.AUTO_SALE_VK_COMMUNITY_TOKEN||'');
const vkAppSecret=String(process.env.AUTO_SALE_VK_APP_SECRET||'');
const relaySecret=String(process.env.AUTOWORLD_RELAY_SECRET||'');
const relayUrl=String(process.env.AUTO_SALE_TELEGRAM_RELAY_URL||'');
const database=String(process.env.YDB_CONNECTION_STRING||'');
assert.equal(process.env.AWG_PHYSICAL_TEST_GUARD,'VK26443041_TO_TG_DMITRY_SINGLE_TEST_20261015');
assert.ok(database.endsWith('/etn00ojk5iv1u7dgpdar'),'production YDB guard');
assert.equal(relayUrl,'https://integration-telegram.viiversion.com/telegram/send');
assert.ok(token.length>30,'telegram_bot_token_missing_or_short');
assert.ok(vkToken.length>30,'vk_community_token_missing_or_short');
assert.ok(vkAppSecret.length>0,'vk_app_secret_missing');
assert.ok(relaySecret.length>0,'telegram_relay_secret_missing');
assert.equal(process.env.AUTO_SALE_VK_GROUP_ID,'242103542');
assert.equal(process.env.AUTO_SALE_VK_APP_ID,'54810434');

async function vk(method,params={}){
  const r=await fetch('https://api.vk.com/method/'+method,{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({access_token:vkToken,v:'5.199',...params}).toString(),
    signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.error)throw Error('VK_'+method+'_HTTP_'+r.status+'_CODE_'+(j.error?.error_code||'unknown'));
  return j.response;
}
const users=await vk('users.get',{user_ids:'flyer_flyer',fields:'screen_name'});
const user=users[0];
assert.equal(String(user?.id),'26443041','user supplied VK profile changed');
assert.equal(String(user?.screen_name||'').toLowerCase(),'flyer_flyer');
const messages=await vk('messages.isMessagesFromGroupAllowed',{group_id:'242103542',user_id:'26443041'});
assert.equal(messages?.is_allowed,1,'client has not permitted the AWG community to message');

const cred=new AccessTokenCredentialsProvider({token:process.env.YC_IAM_TOKEN});
const store=await createYdbStateStore({connectionString:database,credentialsProvider:cred,ensureSchema:false,domainDualWrite:false});
let pins;
try{pins=await store.adminAccessList();}finally{await store.close();}
const pinned=pins.find(p=>String(p.username||'').replace(/^@/,'').toLowerCase()==='flyer_flyer');
assert.ok(/^\d+$/.test(String(pinned?.telegramUserId||'')),'Dmitry Telegram identity not pinned');
const managerTelegramId=String(pinned.telegramUserId);
const chatResp=await fetch('https://api.telegram.org/bot'+token+'/getChat',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({chat_id:managerTelegramId}),signal:AbortSignal.timeout(15000)});
const chat=await chatResp.json();
assert.equal(chat.ok,true,'manager chat unavailable');
assert.equal(chat.result?.type,'private');
assert.equal(String(chat.result?.username||'').toLowerCase(),'flyer_flyer','wrong manager target');

const stateRes=await fetch('https://awgcars.ru/api/auto-sale/state',{
  headers:{'x-auto-sale-key':process.env.AUTO_SALE_API_KEY},
  signal:AbortSignal.timeout(26000)});
assert.equal(stateRes.status,200);
const state=await stateRes.json();
const lead=(state.leads||[]).find(l=>l.clientProvider==='vk'&&String(l.clientProviderUserId)==='26443041'&&l.manager==='Дмитрий');
// Lead existence is reported, but transport testing must not recreate missing production data.
assert.ok((state.team||[]).some(m=>m.name==='Дмитрий'&&m.active!==false),'manager absent');

// This sends exactly one labelled, non-transactional smoke message per
// verified recipient. It does not create a lead or change customer status.
const vkService=createVkService({enabled:'true',appId:'54810434',appSecret:vkAppSecret,
  groupId:'242103542',communityToken:vkToken});
const tgService=createTelegramService({token,relayUrl,relaySecret,managerChatIds:''});
const reference='AWG-VK-DMITRY-SMOKE-20261015';
const vkMessage='AUTO МИР · ТЕСТ СВЯЗИ\n\nПроверяем получение уведомлений в VK по существующей заявке. Это технический тест: статус и данные заявки не изменены. Отвечать не требуется.';
const tgMessage='AUTO МИР · ТЕСТ СВЯЗИ\n\nПроверяем доставку сообщений менеджеру Дмитрию в Telegram для клиента из VK. Это технический тест: статус и данные заявки не изменены. Отвечать не требуется.';
let vkResult={ok:false},telegramResult={ok:false};
try{
  const sent=await vkService.send('26443041',vkMessage,{idempotencyKey:reference+':vk:client'});
  vkResult={ok:Boolean(sent.message_id),hasMessageId:Boolean(sent.message_id)};
}catch(e){vkResult={ok:false,error:String(e.vkDescription||e.message||'').slice(0,180)}}
try{
  const sent=await tgService.send(managerTelegramId,tgMessage);
  telegramResult={ok:Boolean(sent.message_id),hasMessageId:Boolean(sent.message_id)};
}catch(e){telegramResult={ok:false,error:String(e.telegramDescription||e.message||'').slice(0,180)}}
console.log('AWG_VK_CLIENT_DMITRY_PHYSICAL_DELIVERY',JSON.stringify({
  vkClient:'flyer_flyer',manager:'Дмитрий',telegramManagerBindingVerified:true,
  alreadyAssignedLead:Boolean(lead),originalStatus:String(lead?.status||''),
  messagesTestOnly:true,leadMutations:0,channels:{vk:vkResult,telegram:telegramResult}
}));
if(!vkResult.ok||!telegramResult.ok)process.exitCode=1;
