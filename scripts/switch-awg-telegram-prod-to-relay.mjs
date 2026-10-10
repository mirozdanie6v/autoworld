import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const token=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'');
assert.ok(token.length>30,'production_bot_token_required');
const base='https://integration-telegram.viiversion.com';
const target=base+'/telegram/webhook';
const key=createHmac('sha256',token).update('auto-sale-telegram-webhook-v2').digest('hex').slice(0,32);
const signed=createHmac('sha256',token).update('auto-sale-telegram-webhook-secret-v1').digest('hex');
const production='https://awgcars.ru/api/auto-sale/telegram/webhook/'+key;
async function telegram(method,body={}){
 const rsp=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(18000)
 });
 const j=await rsp.json().catch(()=>({}));
 if(rsp.status!==200||j.ok!==true)throw Error('Telegram_'+method+'_HTTP_'+rsp.status);
 return j.result;
}
const me=await telegram('getMe');
assert.equal(me.username,'AutoWorld_Georgia_bot');
const prev=await telegram('getWebhookInfo');
assert.ok([production,target].includes(String(prev.url||'')),'refuse_unexpected_current_webhook_URL');
const health=await fetch(base+'/telegram/health',{signal:AbortSignal.timeout(15000)});
assert.equal(health.status,200);
const probe=await fetch(target,{method:'POST',
 headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':signed},
 body:JSON.stringify({update_id:-91020261016}),signal:AbortSignal.timeout(24000)
});
const probeJson=await probe.json().catch(()=>({}));
assert.equal(probe.status,200,'relay_ingress_not_ready');
assert.equal(probeJson.ok,true,'relay_ingress_upstream_unhealthy');
assert.equal(probeJson.ignored,true,'signed_noop_not_ignored');
console.log('AWG_RELAY_WEBHOOK_SWITCH_PREFLIGHT',JSON.stringify({
 priorHost:prev.url?new URL(prev.url).hostname:null,
 newHost:'integration-telegram.viiversion.com',signedProbeMs:'verified',
 pendingBefore:Number(prev.pending_update_count||0),oldErrorSeen:Boolean(prev.last_error_message)
}));
if(prev.url!==target){
 await telegram('setWebhook',{
  url:target,secret_token:signed,allowed_updates:['message'],drop_pending_updates:false,
  max_connections:20
 });
}
const after=await telegram('getWebhookInfo');
assert.equal(after.url,target,'Telegram_webhook_retarget_failed');
assert.ok((after.allowed_updates||[]).includes('message'),'message_updates_missing');
console.log('AWG_RELAY_WEBHOOK_SWITCH_VERIFIED',JSON.stringify({
 host:'integration-telegram.viiversion.com',registered:true,
 pendingAfter:Number(after.pending_update_count||0),pendingPreserved:true,
 oldErrorAt:after.last_error_date?new Date(Number(after.last_error_date)*1000).toISOString():null
}));
