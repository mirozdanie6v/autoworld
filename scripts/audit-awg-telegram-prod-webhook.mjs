import {createHmac} from 'node:crypto';

const token=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
if(token.length<30||apiKey.length<16)throw new Error('production_bot_credentials_missing');
const api='https://api.telegram.org/bot'+token+'/';
const base='https://awgcars.ru';
const key=createHmac('sha256',token).update('auto-sale-telegram-webhook-v2').digest('hex').slice(0,32);
const secret=createHmac('sha256',token).update('auto-sale-telegram-webhook-secret-v1').digest('hex');
const directPath='/api/auto-sale/telegram/webhook/'+key;
async function call(method,body={}){
 const r=await fetch(api+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(14000)});
 const j=await r.json();if(!r.ok||j.ok!==true)throw Error('telegram_'+method+'_failed_http_'+r.status);
 return j.result;
}
async function get(path,apiAuth=false){
 const res=await fetch(base+path,{headers:apiAuth?{'x-auto-sale-key':apiKey}:{},signal:AbortSignal.timeout(30000)});
 let data={};try{data=await res.json()}catch{}
 return{status:res.status,data};
}
const bot=await call('getMe');
if(bot.username!=='AutoWorld_Georgia_bot')throw Error('unexpected_bot_identity');
const info=await call('getWebhookInfo');
const url=String(info.url||'');
let classification='unregistered',matchesKey=false,kind='none';
if(url){
  const x=new URL(url);
  kind=x.hostname==='awgcars.ru'?'prod-domain':x.hostname==='integration-telegram.viiversion.com'?'cloudflare-relay':x.hostname.endsWith('.containers.yandexcloud.net')?'yandex-direct':'other';
  matchesKey=x.pathname===directPath;
}
const report={
 bot:'AutoWorld_Georgia_bot',webhookKind:kind,
 webhookRegistered:Boolean(url),webhookHost:url?new URL(url).hostname:null,webhookScheme:url?new URL(url).protocol:null,pathMatchesCurrentCode:matchesKey,
 pendingUpdateCount:Number(info.pending_update_count||0),
 lastErrorAt:info.last_error_date?new Date(info.last_error_date*1000).toISOString():null,
 lastErrorClass:info.last_error_message?String(info.last_error_message).replace(/\/[a-f0-9]{32,64}/g,'/[secret]').slice(0,200):null,
 lastSyncErrorAt:info.last_synchronization_error_date?new Date(info.last_synchronization_error_date*1000).toISOString():null,
 allowedUpdates:info.allowed_updates||[],
 maxConnections:info.max_connections
};
const [health,scenarios,stats,recipients,diagnose,relayHealth]=await Promise.all([
  get('/api/health'),
  fetch(base+'/api/auto-sale/telegram/test-bot-scenarios',{method:'POST',headers:{'x-auto-sale-key':apiKey,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)}).then(async r=>({status:r.status,data:await r.json().catch(()=>({}))})).catch(e=>({error:String(e.message).slice(0,120)})),
  get('/api/auto-sale/notifications/status',true),
  get('/api/auto-sale/telegram/recent-command-recipients?limit=50',true),
  get('/api/auto-sale/telegram/diagnose',true),
  fetch('https://integration-telegram.viiversion.com/telegram/health',{signal:AbortSignal.timeout(13000)}).then(async r=>({status:r.status,data:await r.json().catch(()=>({}))})).catch(e=>({error:String(e.message).slice(0,120)}))
]);
const safe={
  telegram:{...report},
  productionHealth:{status:health.status,ok:health.data.ok,build:health.data.buildSha,telegram:health.data.telegramNotifications},
  scenario:{status:scenarios.status,ok:scenarios.data?.ok,results:(scenarios.data?.results||[]).map(x=>({name:x.name,ok:x.ok}))},
  notification:{status:stats.status,stats:stats.data?.stats||null},
  recentCommands:{status:recipients.status,count:recipients.data?.recipients?.length||0,lastAt:recipients.data?.recipients?.[0]?.createdAt||null},
  serverInternet:{status:diagnose.status,telegram:diagnose.data?.telegram,publicInternet:diagnose.data?.publicInternet},
  relayHealth
};
console.log('AWG_TELEGRAM_PRODUCTION_WEBHOOK_AUDIT',JSON.stringify(safe));
// Probe current configured ingress with a syntactically valid no-message update.
// Do not send a bot command to another user and never reset or delete the webhook.
if(url){
 const rsp=await fetch(url,{method:'POST',
  headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},
  body:JSON.stringify({update_id:-91020261010}),
  signal:AbortSignal.timeout(30000)
 }).then(async r=>({status:r.status,data:await r.json().catch(()=>({}))}))
 .catch(error=>({error:String(error.message||error).slice(0,180)}));
 console.log('AWG_TELEGRAM_CONFIGURED_WEBHOOK_NOOP_PROBE',JSON.stringify({status:rsp.status,ok:rsp.data?.ok,ignored:rsp.data?.ignored,error:rsp.data?.error||rsp.error||null}));
}

const noop={update_id:-91020261011};
for(const [label,endpoint] of [
 ['production-gateway',base+directPath],
 ['cloudflare-relay','https://integration-telegram.viiversion.com/telegram/webhook']
]){
 const start=Date.now();
 try{
  const rsp=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(noop),signal:AbortSignal.timeout(21000)});
  const data=await rsp.json().catch(()=>({}));
  console.log('AWG_TELEGRAM_INBOUND_ALTERNATIVE_NOOP',JSON.stringify({label,status:rsp.status,ms:Date.now()-start,ok:data.ok,ignored:data.ignored,error:data.error||null}));
 }catch(e){console.log('AWG_TELEGRAM_INBOUND_ALTERNATIVE_NOOP',JSON.stringify({label,ms:Date.now()-start,error:String(e.message).slice(0,100)}))}
}
