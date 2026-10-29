// Explicit isolated staging deployment. No credential generation or IAM mutations.
import assert from 'node:assert/strict';
import {createTelegramService} from '../server/telegram-bot.mjs';
const e=process.env;
const containerId='bba5hanjiq9ngu77i8p9',sa='aje3j5aat66lel86cd5r';
const origin='https://'+containerId+'.containers.yandexcloud.net';
const crm='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnvd9hmimkt74vpuqa6';
const ads='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnseoqfsf7ojn52813t';
assert.equal(e.GITHUB_REPOSITORY,'mirozdanie6v/autoworld');
assert.equal(e.GITHUB_REF_NAME,'feature/awg-ads-stage-b-integration');
assert.equal(e.AWG_ADS_STAGING_DEPLOY_APPROVED,'dedicated-telegram-staging-only');
for(const k of ['YC_IAM_TOKEN','AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN','AWG_ADS_STAGE_B_SUBJECT_SECRET','AWG_ADS_STAGING_API_KEY'])assert.ok(e[k]?.length>=32,'missing private runtime configuration: '+k);
assert.match(e.STAGING_IMAGE_DIGEST,/^cr\.yandex\/crpkirscqc5gt6dgeujr\/autoworld-ads-staging@sha256:[a-f0-9]{64}$/);
const api='https://serverless-containers.api.cloud.yandex.net';
async function cloud(path,body){
  let r;
  try{r=await fetch(api+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+e.YC_IAM_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(40000)});}
  catch{throw Error('staging cloud transport failure');}
  if(!r.ok)throw Error('staging cloud HTTP '+r.status);
  return r.json();
}
async function telegram(method,body={}){
  let r;try{r=await fetch('https://api.telegram.org/bot'+e.AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});}
  catch{throw Error('dedicated Telegram transport failure');}
  if(!r.ok)throw Error('dedicated Telegram HTTP '+r.status);
  const j=await r.json();if(!j.ok)throw Error('dedicated Telegram request rejected');return j.result;
}
const container=await cloud('/containers/v1/containers/'+containerId);
assert.equal(container.name,'autoworld-ads-telegram-staging');
assert.equal(container.folderId,'b1g8u8vqkgehvtbj8n13');
const me=await telegram('getMe');assert.equal(me.id,8824530254);assert.equal(me.username,'auto_sale_usa_bot');
const bot=createTelegramService({token:e.AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN,relayUrl:''});
const environment={
  YDB_CONNECTION_STRING:crm,AWG_ADS_STAGE_B_YDB_CONNECTION_STRING:ads,
  AWG_ADS_STAGE_B_MODE:'isolated-staging',AWG_ADS_STAGE_B_ENABLED:'false',
  AWG_ADS_STAGE_B_SUBJECT_SECRET:e.AWG_ADS_STAGE_B_SUBJECT_SECRET,
  AUTO_SALE_API_KEY:e.AWG_ADS_STAGING_API_KEY,
  AUTO_SALE_TELEGRAM_BOT_TOKEN:e.AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN,
  AUTO_SALE_TELEGRAM_APP_URL:origin+'/',AUTO_SALE_TELEGRAM_RELAY_URL:'',
  AUTO_SALE_ADMIN_TELEGRAM_USERNAMES:'Flyer_Flyer,smit44744',
  AUTO_SALE_MANAGER_CHAT_IDS:'',AUTO_SALE_PUBLIC_DEMO_WRITE:'false',
  AUTO_SALE_LEGACY_STATE_WRITE:'false',AUTO_SALE_YDB_DUAL_WRITE:'false',
  AUTO_SALE_YDB_READ_MODE:'normalized',AUTO_SALE_VK_ENABLED:'false',
  AUTO_SALE_VK_WEB_ENABLED:'false',AUTO_SALE_BUILD_SHA:e.GITHUB_SHA,
  AWG_ADS_STAGE_B_RECONCILE_ENABLED:'false',AUTO_SALE_NOTIFICATION_PUMP_ENABLED:'false'
};
const marker='Ads staging baseline '+e.GITHUB_SHA;
await cloud('/containers/v1/revisions:deploy',{
  containerId,description:marker,resources:{memory:'536870912',cores:'1',coreFraction:'100'},
  executionTimeout:'60s',serviceAccountId:sa,concurrency:'1',
  imageSpec:{imageUrl:e.STAGING_IMAGE_DIGEST,environment},
  provisionPolicy:{minInstances:'0'},scalingPolicy:{zoneInstancesLimit:'1',zoneRequestsLimit:'1'},
  runtime:{http:{}},logOptions:{disabled:true}
});
let revision;
for(let i=0;i<60;i++){
  const j=await cloud('/containers/v1/revisions?containerId='+containerId+'&pageSize=100');
  revision=j.revisions?.find(r=>r.description===marker&&r.status==='ACTIVE');
  if(revision)break;
  await new Promise(r=>setTimeout(r,5000));
}
assert.ok(revision,'staging revision not ACTIVE');
assert.equal(revision.serviceAccountId,sa);
assert.equal(revision.image.environment.YDB_CONNECTION_STRING,crm);
assert.equal(revision.image.environment.AUTO_SALE_PUBLIC_DEMO_WRITE,'false');
console.log('STAGING_BASELINE_REVISION_ACTIVE',revision.id);
const health=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(70000)});
assert.equal(health.status,200);const h=await health.json();
assert.equal(h.ok,true);assert.equal(h.publicDemoWrite,false);assert.equal(h.buildSha,e.GITHUB_SHA);
assert.equal(h.telegramNotifications,'enabled');assert.equal(h.vkAuth,'disabled');
const invalid=await fetch(origin+bot.webhookPath,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(40000)});
assert.equal(invalid.status,401,'unsigned webhook must be denied');
const ignored=await fetch(origin+bot.webhookPath,{method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':bot.webhookSecretToken},body:JSON.stringify({update_id:999000001}),signal:AbortSignal.timeout(40000)});
assert.equal(ignored.status,200);
const denied=await fetch(origin+'/api/auto-sale/entities/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operations:[]}),signal:AbortSignal.timeout(40000)});
assert.ok([401,403].includes(denied.status),'anonymous write must be denied');
const page=await fetch(origin+'/',{signal:AbortSignal.timeout(40000)});assert.equal(page.status,200);
await telegram('setWebhook',{url:origin+bot.webhookPath,secret_token:bot.webhookSecretToken,allowed_updates:['message'],max_connections:1,drop_pending_updates:false});
const hook=await telegram('getWebhookInfo');assert.equal(hook.url,origin+bot.webhookPath);
await telegram('setChatMenuButton',{menu_button:{type:'web_app',text:'Тестовый каталог',web_app:{url:origin+'/'}}});
console.log('STAGING_BOT_CONNECTED',JSON.stringify({bot:me.username,revisionId:revision.id,origin,adsEnabled:false,physicalUserE2E:false,anonymousWriteDenied:true,unsignedWebhookDenied:true,webhookReadback:true}));
