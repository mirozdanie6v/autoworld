import {createHmac} from 'node:crypto';

const token=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'').trim();
const appUrl=String(process.env.AUTO_SALE_TELEGRAM_APP_URL||'https://bba01u6g86lg2q49p34d.containers.yandexcloud.net/').trim();
const webhookBaseUrl=String(process.env.AUTO_SALE_TELEGRAM_WEBHOOK_BASE_URL||appUrl).trim();
const explicitWebhookUrl=String(process.env.AUTO_SALE_TELEGRAM_WEBHOOK_URL||'').trim();
if(!token)throw new Error('AUTO_SALE_TELEGRAM_BOT_TOKEN is required');
if(!/^https:\/\//i.test(appUrl))throw new Error('AUTO_SALE_TELEGRAM_APP_URL must be HTTPS');
if(!/^https:\/\//i.test(webhookBaseUrl))throw new Error('AUTO_SALE_TELEGRAM_WEBHOOK_BASE_URL must be HTTPS');
if(explicitWebhookUrl&&!/^https:\/\//i.test(explicitWebhookUrl))throw new Error('AUTO_SALE_TELEGRAM_WEBHOOK_URL must be HTTPS');

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const api=async(method,payload={},options={})=>{
  for(let attempt=1;attempt<=3;attempt++){
    const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({}));
    if(response.status===429||data?.error_code===429){
      const retryAfter=Math.max(1,Number(data?.parameters?.retry_after)||1);
      if(options.skipLongRateLimit&&retryAfter>60){
        console.log(`${method}: Telegram rate limit ${retryAfter}s; skipping non-critical update`);
        return null;
      }
      if(attempt<3){
        console.log(`${method}: Telegram rate limit, retrying after ${retryAfter}s`);
        await sleep((retryAfter+1)*1000);
        continue;
      }
    }
    if(!response.ok||data.ok===false)throw new Error(`${method}: ${data.description||response.status}`);
    return data.result;
  }
};

const me=await api('getMe');
if(String(me.username||'').toLowerCase()!=='autoworld_georgia_bot'){
  throw new Error(`Wrong bot token: expected @AutoWorld_Georgia_bot, got @${me.username||'unknown'}`);
}

await api('setMyName',{name:'AUTO МИР | AutoWorld Georgia'},{skipLongRateLimit:true});
await api('setMyDescription',{description:'Автомобили из США и Грузии с доставкой в Россию. Каталог, прозрачный расчёт, заявка, этапы оплаты и отслеживание заказа — в одном приложении.'},{skipLongRateLimit:true});
await api('setMyShortDescription',{short_description:'Автомобили из США и Грузии · каталог и заказ'},{skipLongRateLimit:true});
await api('setMyCommands',{commands:[
  {command:'start',description:'Начать'},
  {command:'catalog',description:'Открыть каталог'},
  {command:'help',description:'Как это работает'}
]},{skipLongRateLimit:true});
await api('setChatMenuButton',{menu_button:{
  type:'web_app',
  text:'🚗 Открыть каталог',
  web_app:{url:appUrl}
}},{skipLongRateLimit:true});

const webhookKey=createHmac('sha256',token).update('auto-sale-telegram-webhook-v2').digest('hex').slice(0,32);
const webhookSecretToken=createHmac('sha256',token).update('auto-sale-telegram-webhook-secret-v1').digest('hex');
const webhookPath=`/api/auto-sale/telegram/webhook/${webhookKey}`;
const webhookUrl=explicitWebhookUrl
  ?new URL(explicitWebhookUrl).toString()
  :new URL(webhookPath,webhookBaseUrl.endsWith('/')?webhookBaseUrl:`${webhookBaseUrl}/`).toString();
await api('deleteWebhook',{drop_pending_updates:false});
const webhookConfiguredAt=Math.floor(Date.now()/1000);
await api('setWebhook',{
  url:webhookUrl,
  secret_token:webhookSecretToken,
  allowed_updates:['message'],
  drop_pending_updates:false
});
const webhookAfterSet=await api('getWebhookInfo');
if(webhookAfterSet?.url!==webhookUrl)throw new Error(`Webhook URL mismatch: expected ${webhookUrl}, got ${webhookAfterSet?.url||'empty'}`);

let webhookProbe=null;
let webhookProbeBody={};
for(let attempt=1;attempt<=18;attempt++){
  try{
    webhookProbe=await fetch(webhookUrl,{
      method:'POST',
      headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':webhookSecretToken},
      body:JSON.stringify({update_id:-1}),
      signal:AbortSignal.timeout(10_000)
    });
    webhookProbeBody=await webhookProbe.json().catch(()=>({}));
    if(webhookProbe.ok&&webhookProbeBody?.ok===true)break;
    console.log('Webhook endpoint not ready yet:',JSON.stringify({attempt,status:webhookProbe.status,body:webhookProbeBody}));
  }catch(error){
    console.log('Webhook endpoint probe retry:',JSON.stringify({attempt,error:String(error?.message||error)}));
  }
  if(attempt<18)await sleep(5000);
}
if(!webhookProbe?.ok||webhookProbeBody?.ok!==true){
  throw new Error(`Webhook endpoint probe failed after retries: HTTP ${webhookProbe?.status||0} ${JSON.stringify(webhookProbeBody)}`);
}

const outboundProbe=await fetch(webhookUrl,{
  method:'POST',
  headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':webhookSecretToken},
  body:JSON.stringify({update_id:-2,message:{message_id:-2,chat:{id:me.id,type:'private'},from:{id:me.id,is_bot:true,first_name:'probe'},text:'/help'}})
});
const outboundProbeBody=await outboundProbe.json().catch(()=>({}));
console.log('Webhook outbound diagnostic:',JSON.stringify({status:outboundProbe.status,body:outboundProbeBody}));
if(outboundProbe.status===500)throw new Error(`Webhook outbound transport failed: ${JSON.stringify(outboundProbeBody)}`);

let webhook=webhookAfterSet;
for(let attempt=1;attempt<=18;attempt++){
  webhook=await api('getWebhookInfo');
  if(webhook.url!==webhookUrl)throw new Error(`Final webhook URL mismatch: expected ${webhookUrl}, got ${webhook.url||'empty'}`);
  if(Number(webhook.pending_update_count||0)===0)break;
  if(attempt<18)await sleep(5000);
}
if(Number(webhook.pending_update_count||0)>0){
  throw new Error(`Telegram webhook has ${webhook.pending_update_count} pending updates after 90s; delivery is not draining${webhook.last_error_message?': '+webhook.last_error_message:''}`);
}
if(webhook.last_error_message){
  const errorDate=Number(webhook.last_error_date||0);
  console.log('Webhook historical delivery diagnostic:',JSON.stringify({
    message:webhook.last_error_message,
    last_error_date:errorDate||null,
    after_configuration:Boolean(errorDate&&errorDate>=webhookConfiguredAt),
    pending_update_count:Number(webhook.pending_update_count||0)
  }));
}

const [actualBot,name,description,shortDescription,commands,button]=await Promise.all([
  api('getMe'),
  api('getMyName'),
  api('getMyDescription'),
  api('getMyShortDescription'),
  api('getMyCommands'),
  api('getChatMenuButton')
]);

console.log(JSON.stringify({
  ok:true,
  bot:{id:actualBot.id,username:actualBot.username,name:name?.name||actualBot.first_name},
  description:description?.description||'',
  shortDescription:shortDescription?.short_description||'',
  commands,
  appUrl,
  menuButton:button,
  webhook:{configured:Boolean(webhook.url),urlMatches:webhook.url===webhookUrl,endpointProbe:true,pending_update_count:webhook.pending_update_count,last_error_message:webhook.last_error_message||null,last_error_date:webhook.last_error_date||null}
},null,2));
