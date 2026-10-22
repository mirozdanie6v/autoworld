import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';

const secret=String(process.env.AUTOWORLD_RELAY_SECRET||'');
assert.ok(secret.length>=16,'AWG_relay_secret_required');
const ts=String(Date.now());
const body='{"action":"restore_cloudflare_ingress"}';
const signature=createHmac('sha256',secret).update(ts+'.'+body).digest('hex');
const response=await fetch('https://integration-telegram.viiversion.com/telegram/admin/repair-webhook',{
  method:'POST',
  headers:{
    'content-type':'application/json',
    'x-relay-timestamp':ts,
    'x-relay-signature':signature
  },
  body,
  signal:AbortSignal.timeout(90000)
});
const data=await response.json().catch(()=>({}));
if(response.status!==200||data.ok!==true||data.verified!==true||data.registered!==true
  ||data.webhookHost!=='integration-telegram.viiversion.com'||data.dropPendingUpdates!==false){
  throw Error('guarded_cloudflare_webhook_repair_failed_HTTP_'+response.status+'_'+String(data.error||'verification'));
}
console.log('AWG_TELEGRAM_WEBHOOK_RECOVERED',JSON.stringify({
  verified:true,updated:data.updated===true,webhookHost:data.webhookHost,
  pendingBefore:data.pendingBefore,pendingAfter:data.pendingAfter,
  dropPendingUpdates:false
}));
