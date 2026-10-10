import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';

const token=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
assert.ok(token.length>30&&apiKey.length>16,'production_credentials_required');
const BASE='https://awgcars.ru';
const EXPECTED_OLD='d5dbgio6limv03usvipl.s183zexc.apigw.yandexcloud.net';
const DERIVED_KEY=createHmac('sha256',token).update('auto-sale-telegram-webhook-v2').digest('hex').slice(0,32);
const SECRET=createHmac('sha256',token).update('auto-sale-telegram-webhook-secret-v1').digest('hex');
const WEBHOOK_PATH='/api/auto-sale/telegram/webhook/'+DERIVED_KEY;
const URL=BASE+WEBHOOK_PATH;
async function tg(method,body={}){
  const resp=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(18000)
  });
  const data=await resp.json().catch(()=>({}));
  if(resp.status!==200||data.ok!==true)throw Error('Telegram_'+method+'_rejected_HTTP_'+resp.status);
  return data.result;
}
const me=await tg('getMe');
assert.equal(me.username,'AutoWorld_Georgia_bot','wrong_bot_token');
const prev=await tg('getWebhookInfo');
if(prev.url){
  const previous=new globalThis.URL(prev.url);
  if(![EXPECTED_OLD,'awgcars.ru'].includes(previous.hostname))throw Error('refuse_unexpected_existing_webhook_host');
  if(previous.pathname!==WEBHOOK_PATH)throw Error('refuse_unexpected_existing_webhook_path');
}
const server=await fetch(BASE+'/api/health',{signal:AbortSignal.timeout(25000)});
const health=await server.json();
assert.equal(server.status,200);
assert.equal(health.ok,true);
assert.equal(health.telegramNotifications,'enabled');
assert.equal(health.buildSha,'201d760d62d3e065e27119ea18091db76f30ed1d','refuse_unexpected_prod_build');
const probe=await fetch(URL,{method:'POST',headers:{
  'content-type':'application/json','x-telegram-bot-api-secret-token':SECRET
 },body:JSON.stringify({update_id:-91020261012}),signal:AbortSignal.timeout(15000)});
const result=await probe.json().catch(()=>({}));
assert.equal(probe.status,200,'production_gateway_webhook_not_200');
assert.equal(result.ok,true,'production_gateway_webhook_probe_failed');
assert.equal(result.ignored,true,'no_message_probe_not_ignored');
console.log('TELEGRAM_WEBHOOK_PROD_PRECHECK',JSON.stringify({
 previousHost:prev.url?new globalThis.URL(prev.url).hostname:null,
 expectedNewHost:'awgcars.ru',
 oldPending:Number(prev.pending_update_count||0),
 oldErrorPresent:Boolean(prev.last_error_message),
 signedNoop:{status:probe.status,ignored:true},
 buildSha:health.buildSha
}));
if(prev.url!==URL){
  await tg('setWebhook',{
    url:URL,
    secret_token:SECRET,
    allowed_updates:['message'],
    drop_pending_updates:false,
    max_connections:40
  });
}
const after=await tg('getWebhookInfo');
assert.equal(after.url,URL,'telegram_webhook_did_not_update');
assert.ok((after.allowed_updates||[]).includes('message'),'message_updates_must_stay_enabled');
console.log('TELEGRAM_WEBHOOK_PROD_REPAIRED',JSON.stringify({
 webhookHost:'awgcars.ru',verified:true,
 oldPending:Number(prev.pending_update_count||0),
 nowPending:Number(after.pending_update_count||0),
 latestErrorAt:after.last_error_date?new Date(Number(after.last_error_date)*1000).toISOString():null,
 configApplied:prev.url!==URL,preservedPendingUpdates:true
}));
