// Explicit isolated staging deployment. No credential generation or IAM mutations.
import assert from 'node:assert/strict';
import {createTelegramService} from '../server/telegram-bot.mjs';
const e=process.env;
const adsEnabled=e.AWG_ADS_STAGING_ATTRIBUTION_APPROVED==='isolated-telegram-ads-only';
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
  AWG_ADS_STAGE_B_MODE:'isolated-staging',AWG_ADS_STAGE_B_ENABLED:String(adsEnabled),
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
const marker='Ads staging '+(adsEnabled?'candidate ':'baseline ')+e.GITHUB_SHA;
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
console.log('STAGING_REVISION_ACTIVE',revision.id);
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
console.log('STAGING_BOT_CONNECTED',JSON.stringify({bot:me.username,revisionId:revision.id,origin,adsEnabled,physicalUserE2E:false,anonymousWriteDenied:true,unsignedWebhookDenied:true,webhookReadback:true}));

if(adsEnabled){
  // This acceptance uses synthetic identities and never sends Telegram messages.
  // Physical user authentication and an HTTP client lead submission are separate acceptance.
  const {createHmac,randomUUID}=await import('node:crypto');
  const {writeFile}=await import('node:fs/promises');
  const {Driver}=await import('@ydbjs/core');
  const {query}=await import('@ydbjs/query');
  const {AccessTokenCredentialsProvider}=await import('@ydbjs/auth/access-token');
  const {createYdbAdsAttributionRepository}=await import('../server/ads-attribution-ydb.mjs');
  const {createAdsAttributionService}=await import('../server/ads-attribution-core.mjs');
  const {createAdsStageBBridge}=await import('../server/ads-attribution-stage-b.mjs');
  const {createYdbStateStore}=await import('../server/ydb-state.mjs');
  const {createYdbDomainStore}=await import('../server/ydb-domain-store.mjs');
  const {mutateAutoSaleEntityBatch}=await import('../server/ydb-entity-commands.mjs');
  const {sanitizeClientOperations}=await import('../server/auto-sale-access.mjs');
  const {summarizeAdsCampaignsFromRepository}=await import('../server/ads-attribution-report.mjs');
  const credentialsProvider=new AccessTokenCredentialsProvider({token:e.YC_IAM_TOKEN});
  const driver=new Driver(ads,{credentialsProvider});
  let legacyStore,domainStore;
  const run=randomUUID().replaceAll('-','');
  const user={id:Number('999'+String(Date.now()).slice(-10)),first_name:'Synthetic QA'};
  const campaignId='QA-HTTP-'+run;
  const leadId='L-ADS-HTTP-'+run;
  let created=false;
  try{
    await driver.ready();
    const repository=createYdbAdsAttributionRepository(query(driver));
    const service=createAdsAttributionService({repository,subjectSecret:e.AWG_ADS_STAGE_B_SUBJECT_SECRET});
    const bridge=createAdsStageBBridge({enabled:true,service,onFailure:async()=>{}});
    const campaign=await service.issueCampaign({campaignId});
    const localBot=createTelegramService({token:e.AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN,
      adsStartRecorder:bridge.recordBotStart,adsStartStrict:true});
    const update={update_id:Date.now(),message:{text:'/start '+campaign.token,
      chat:{id:user.id,type:'private'},from:user}};
    const reply=await localBot.handleWebhookUpdate(update,{appUrl:origin+'/',webhookReply:true});
    assert.equal(reply.handled,'/start');
    assert.equal(reply.webhookPayload.reply_markup.inline_keyboard[0][0].web_app.url,origin+'/');
    await localBot.handleWebhookUpdate(update,{appUrl:origin+'/',webhookReply:true});
    const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify(user)});
    const check=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
    const signing=createHmac('sha256','WebAppData').update(e.AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN).digest();
    params.set('hash',createHmac('sha256',signing).update(check).digest('hex'));
    const headers={'Content-Type':'application/json','x-telegram-init-data':params.toString()};
    async function http(path,{body,auth=headers,method=body?'POST':'GET'}={}){
      let response;
      try{response=await fetch(origin+path,{method,headers:auth,
        ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(40000)});}
      catch{throw Error('staging acceptance HTTP transport failure: '+path);}
      const data=await response.json();
      return {status:response.status,data};
    }
    const state=await http('/api/auto-sale/state');
    assert.equal(state.status,200);assert.equal(state.data._access.role,'client');
    assert.equal(state.data._adsTrackingEnabled,true);
    const unsigned=await http('/api/auto-sale/ads/event',{body:{eventType:'miniapp_open'},auth:{'Content-Type':'application/json'}});
    assert.equal(unsigned.status,403);
    const forged=await http('/api/auto-sale/ads/event',{body:{eventType:'miniapp_open'},auth:{...headers,'x-telegram-init-data':params.toString()+'x'}});
    assert.equal(forged.status,403);
    for(const expected of ['recorded','duplicate']){
      const result=await http('/api/auto-sale/ads/event',{body:{eventType:'miniapp_open'}});
      assert.equal(result.status,200);assert.equal(result.data.status,expected);
    }
    const director=await http('/api/auto-sale/ads/director-report');
    assert.equal(director.status,403);
    const apiDirector=await http('/api/auto-sale/ads/director-report',{auth:{'x-auto-sale-key':e.AWG_ADS_STAGING_API_KEY}});
    assert.equal(apiDirector.status,403);
    legacyStore=await createYdbStateStore({connectionString:crm,credentialsProvider,ensureSchema:false,domainDualWrite:false});
    domainStore=await createYdbDomainStore({connectionString:crm,credentialsProvider,ensureSchema:false});
    let catalog=(state.data.catalog||[]).filter(x=>x.active!==false);
    if(!catalog.length){
      const car={id:'QA-STAGING-CAR',brand:'AutoWorld QA',model:'Тестовый автомобиль',
        origin:'usa',year:'2022',mileage:'10000',engine:'Бензин',drive:'Передний',
        price:10000,image:origin+'/assets/auto-mir-hero-desktop-v3.webp',active:true,source:'Synthetic staging QA',tag:'Тестовый автомобиль'};
      const seeded=await mutateAutoSaleEntityBatch({legacyStore,domainStore,
        operations:[{resource:'catalog',operation:'create',id:car.id,input:car}],prepareNotifications:null});
      assert.equal(seeded.status,200,'staging synthetic catalog seed: '+String(seeded.data?.error||''));
      catalog=[car];
    }
    const car=catalog[0];
    for(const expected of ['recorded','duplicate']){
      const event=await http('/api/auto-sale/ads/event',{body:{eventType:'vehicle_detail_click',carId:car.id}});
      assert.equal(event.status,200);assert.equal(event.data.status,expected);
    }
    const identity={provider:'telegram',id:String(user.id),key:'telegram:'+user.id};
    const access={role:'client',authenticated:true,authType:'telegram',user,identity};
    const sanitized=sanitizeClientOperations(await domainStore.loadState(),[{
      resource:'lead',operation:'create',id:leadId,input:{name:'Synthetic HTTP staging QA',contact:'@synthetic',
        carId:car.id,adsAttribution:{lastTouch:{campaignId:'forged'}}}
    }],user,identity);
    assert.equal(sanitized.ok,true);assert.equal(sanitized.operations[0].input.adsAttribution,undefined);
    const operations=await bridge.enrichLeadOperations(sanitized.operations,access);
    assert.equal(operations[0].input.adsAttribution.lastTouch.campaignId,campaignId);
    const committed=await mutateAutoSaleEntityBatch({legacyStore,domainStore,operations,prepareNotifications:null});
    assert.equal(committed.status,200,'synthetic managed CRM commit');created=true;
    assert.equal((await bridge.recordCommittedLeads(operations,access,{committed:true})).recorded,1);
    await bridge.recordCommittedLeads(operations,access,{committed:true});
    const saved=(await domainStore.loadState()).leads.find(x=>x.id===leadId);
    assert.equal(saved.adsAttribution.lastTouch.campaignId,campaignId);assert.equal(saved.carId,car.id);
    const visible=await http('/api/auto-sale/state');
    const own=visible.data.leads.find(x=>x.id===leadId);
    assert.ok(own);assert.equal(own.adsAttribution,undefined);
    const report=(await summarizeAdsCampaignsFromRepository({repository})).find(x=>x.campaignId===campaignId);
    for(const field of ['botStarts','miniappOpens','vehicleDetailClicks','leadSubmissions'])assert.equal(report[field],1,field);
    assert.equal(report.verifiedSpend,null);assert.equal(report.costPerLead,null);
    const physicalCampaign=await service.issueCampaign({campaignId:'QA-TELEGRAM-'+run});
    const link='https://t.me/auto_sale_usa_bot?start='+physicalCampaign.token;
    const evidence={revisionId:revision.id,sourceCommit:e.GITHUB_SHA,adsEnabled:true,
      signedSyntheticHttpEvents:true,forgedSignatureDenied:true,idempotence:true,
      realDualDatabaseCommit:true,clientAttributionHidden:true,directorClientAndApiKeyDenied:true,
      reportCountersVerified:true,telegramMessagesSent:0,physicalUserE2E:false,
      httpClientLeadSubmissionVerified:false,catalogCount:catalog.length,testLink:link};
    await writeFile('staging-attribution-acceptance.json',JSON.stringify(evidence,null,2)+'\n');
    console.log('STAGING_ATTRIBUTION_ACCEPTANCE_PASS',JSON.stringify(evidence));
  }finally{
    try{
      if(created){
        const baseRowVersion=await domainStore.entityRowVersion('lead',leadId);
        const removed=await mutateAutoSaleEntityBatch({legacyStore,domainStore,
          operations:[{resource:'lead',operation:'delete',id:leadId,baseRowVersion}],prepareNotifications:null});
        assert.equal(removed.status,200,'current synthetic fixture cleanup');
      }
    }finally{await Promise.allSettled([legacyStore?.close(),domainStore?.close(),driver.close()]);}
  }
}
