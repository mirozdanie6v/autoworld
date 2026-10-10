import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const token=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'');
assert.ok(token.length>30,'production_telegram_bot_token_required');
const secret=createHmac('sha256',token).update('auto-sale-telegram-webhook-secret-v1').digest('hex');
const webhookKey=createHmac('sha256',token).update('auto-sale-telegram-webhook-v2').digest('hex').slice(0,32);
const expected='https://awgcars.ru/api/auto-sale/telegram/webhook/'+webhookKey;
const host='https://integration-telegram.viiversion.com';
const me=await fetch('https://api.telegram.org/bot'+token+'/getMe',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
assert.equal(me?.result?.username,'AutoWorld_Georgia_bot','wrong_bot_token');
let accepted=false;
for(let attempt=1;attempt<=14;attempt++){
 const started=Date.now();
 try{
 const rsp=await fetch(host+'/telegram/webhook',{
  method:'POST',
  headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},
  body:JSON.stringify({update_id:-91020261015}),
  signal:AbortSignal.timeout(15000)});
 const data=await rsp.json().catch(()=>({}));
 console.log('RELAY_WEBHOOK_SIGNED_NOOP',JSON.stringify({attempt,status:rsp.status,ok:data.ok||false,ignored:data.ignored||false,elapsedMs:Date.now()-started,error:data.error||null}));
 if(rsp.status===200&&data.ok===true&&data.ignored===true){accepted=true;break}
 }catch(e){console.log('RELAY_WEBHOOK_SIGNED_NOOP',JSON.stringify({attempt,error:String(e.message).slice(0,150)}))}
 if(attempt<14)await new Promise(r=>setTimeout(r,5000));
}
if(!accepted)throw Error('relay_ingress_does_not_forward_to_healthy_production');
console.log('RELAY_PRODUCTION_WEBHOOK_READY',JSON.stringify({cloudflareHostname:'integration-telegram.viiversion.com',upstreamHostname:'awgcars.ru',signedIngress:true,ignoredNoop:true}));
