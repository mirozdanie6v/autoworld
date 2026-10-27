import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdsStageBBridge,verifiedAdsTelegramIdentity} from '../server/ads-attribution-stage-b.mjs';
import {adsStageBConfiguration} from '../server/ads-stage-b-runtime.mjs';
import {createAdsAttributionService,createMemoryAdsAttributionRepository} from '../server/ads-attribution-core.mjs';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {sanitizeClientOperations,clientState} from '../server/auto-sale-access.mjs';

const access={role:'client',authenticated:true,authType:'telegram',user:{id:'10050'}};
function fixture(){
  const repo=createMemoryAdsAttributionRepository();
  const service=createAdsAttributionService({
    repository:repo,subjectSecret:'stage-b-ci-secret-not-for-production-12345',
    clock:()=>new Date('2026-10-27T06:00:00.000Z')
  });
  return {repo,service,bridge:createAdsStageBBridge({enabled:true,service,onFailure:async()=>{}})};
}
test('stage B is disabled by default and cannot connect to the production YDB',()=>{
  assert.deepEqual(adsStageBConfiguration({}),{enabled:false});
  assert.throws(()=>adsStageBConfiguration({AWG_ADS_STAGE_B_ENABLED:'true'}),/isolated_staging_required/);
  const base={AWG_ADS_STAGE_B_ENABLED:'true',AWG_ADS_STAGE_B_MODE:'isolated-staging',
    YDB_CONNECTION_STRING:'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/production',
    AWG_ADS_STAGE_B_SUBJECT_SECRET:'a-valid-local-32-character-test-secret'};
  assert.throws(()=>adsStageBConfiguration({...base,
    AWG_ADS_STAGE_B_YDB_CONNECTION_STRING:base.YDB_CONNECTION_STRING}),/database_or_secret_invalid/);
  assert.equal(adsStageBConfiguration({...base,AWG_ADS_STAGE_B_YDB_CONNECTION_STRING:'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/staging'}).enabled,true);
  const off=createAdsStageBBridge();
  assert.equal(off.enabled,false);
});
test('server-verified Telegram identity only; VK, admin, public are excluded',()=>{
  assert.equal(verifiedAdsTelegramIdentity(access),'10050');
  assert.equal(verifiedAdsTelegramIdentity({...access,authType:'vk'}),null);
  assert.equal(verifiedAdsTelegramIdentity({...access,role:'admin'}),null);
  assert.equal(verifiedAdsTelegramIdentity({...access,authenticated:false}),null);
  assert.equal(verifiedAdsTelegramIdentity({...access,user:{id:'not-valid'}}),null);
});
test('trusted webhook start persists ads attribution; server overwrites forged input',async()=>{
  const {bridge,service,repo}=fixture();
  const campaign=await service.issueCampaign({campaignId:'campaign-1',adId:'ad-9'});
  assert.equal((await bridge.recordBotStart({telegramUserId:'10050',startPayload:campaign.token,updateId:'42'})).status,'recorded');
  const original=[{resource:'lead',operation:'create',id:'L-100',input:{
    source:'Mini App',adsAttribution:{lastTouch:{campaignId:'fake'}},model:'Nissan'
  }},{resource:'note',operation:'create',leadId:'L-100',input:{text:'Lead'}}];
  const decorated=await bridge.enrichLeadOperations(original,access);
  assert.equal(decorated[0].input.adsAttribution.lastTouch.campaignId,'campaign-1');
  assert.equal(decorated[0].input.adsAttribution.lastTouch.adId,'ad-9');
  assert.equal(decorated[0].input.source,'Mini App');
  assert.equal(decorated[0].input.model,'Nissan');
  assert.notStrictEqual(decorated,original);
  assert.equal(original[0].input.adsAttribution.lastTouch.campaignId,'fake');
  assert.equal(decorated[1],original[1]);
  assert.equal(JSON.stringify(decorated).includes(campaign.token),false);
  assert.deepEqual(await bridge.recordCommittedLeads(decorated,access,{committed:false}),
    {attempted:0,recorded:0,pending:0});
  assert.deepEqual(await bridge.recordCommittedLeads(decorated,access,{committed:true}),
    {attempted:1,recorded:1,pending:0});
  assert.deepEqual(await bridge.recordCommittedLeads(decorated,access,{committed:true}),
    {attempted:1,recorded:1,pending:0});
  assert.equal(repo.snapshotForTests().events.filter(e=>e.eventType==='lead_submit').length,1);
});
test('VK and admin leads remain untouched, even when a Telegram attribution exists',async()=>{
  const {bridge,service}=fixture();
  const campaign=await service.issueCampaign({campaignId:'ads'});
  await service.recordBotStart({telegramUserId:'10050',startPayload:campaign.token,updateId:'51'});
  const operations=[{resource:'lead',operation:'create',id:'L-101',input:{model:'Jeep'}}];
  assert.strictEqual(await bridge.enrichLeadOperations(operations,{...access,authType:'vk'}),operations);
  assert.strictEqual(await bridge.enrichLeadOperations(operations,{...access,role:'admin'}),operations);
  assert.deepEqual(await bridge.recordCommittedLeads(operations,{...access,authType:'vk'},{committed:true}),
    {attempted:0,recorded:0,pending:0});
});
test('attribution receipt failure does not misreport successful committed lead',async()=>{
  const audit=[];
  const bridge=createAdsStageBBridge({enabled:true,service:{
    recordBotStart:async()=>({status:'recorded'}),
    getAttribution:async()=>({firstTouch:{campaignId:'a',timestamp:'2026-10-27T06:00:00Z'},lastTouch:{campaignId:'a',timestamp:'2026-10-27T06:00:00Z'}}),
    recordTrustedEvent:async()=>{throw Error('YDB temporary outage');}
  },onFailure:async event=>audit.push(event)});
  const op=await bridge.enrichLeadOperations([{resource:'lead',operation:'create',id:'L-100',input:{source:'Mini App'}}],access);
  const result=await bridge.recordCommittedLeads(op,access,{committed:true});
  assert.deepEqual(result,{attempted:1,recorded:0,pending:1});
  assert.equal(op[0].input.adsAttribution.lastTouch.campaignId,'a');
  assert.deepEqual(audit,[{code:'ads_lead_receipt_failed',eventType:'lead_submit'}]);
});
test('strict mode returns 503 on write failure to allow a Telegram webhook retry',async()=>{
  const token='abcdefghijABCDEFGHIJ_0123456789-xyZ';
  const update={update_id:12,message:{chat:{id:10050,type:'private'},from:{id:10050},text:'/start '+token}};
  const bot=createTelegramService({token:'123:test',adsStartRecorder:async()=>{throw Error('test ydb outage')},adsStartStrict:true});
  const previous=console.warn;
  console.warn=()=>{};
  try{
    await assert.rejects(bot.handleWebhookUpdate(update,{webhookReply:true}),err=>err.statusCode===503);
    const ok=createTelegramService({token:'123:test'});
    assert.equal((await ok.handleWebhookUpdate(update,{webhookReply:true})).handled,'/start');
  }finally{console.warn=previous;}
});

test('actual AutoWorld sanitizer discards forged ads metadata; bridge re-attaches only trusted snapshot',async()=>{
  const {bridge,service}=fixture();
  const campaign=await service.issueCampaign({campaignId:'real-from-server'});
  await bridge.recordBotStart({telegramUserId:'10050',startPayload:campaign.token,updateId:'801'});
  const state={initialized:true,leads:[],quotes:[],catalog:[],notes:{}};
  const untrusted=[{resource:'lead',operation:'create',id:'L-test-801',input:{
    name:'Client',model:'BMW',source:'Fraudulent',adsAttribution:{
      source:'Telegram Ads',lastTouch:{campaignId:'fraudulent'}},manager:'fake'
  }}];
  const sanitized=sanitizeClientOperations(state,untrusted,{id:'10050',first_name:'Verified'},{
    provider:'telegram',id:'10050',key:'telegram:10050'
  });
  assert.equal(sanitized.ok,true);
  assert.equal('adsAttribution' in sanitized.operations[0].input,false);
  assert.equal(sanitized.operations[0].input.source,'Mini App');
  const trusted=await bridge.enrichLeadOperations(sanitized.operations,access);
  assert.equal(trusted[0].input.adsAttribution.lastTouch.campaignId,'real-from-server');
  assert.equal(trusted[0].input.clientIdentityKey,'telegram:10050');
});
test('separate ads DB failure or broken metrics sink cannot block a new CRM lead',async()=>{
  const events=[];
  const bridge=createAdsStageBBridge({enabled:true,service:{
    recordBotStart:async()=>({status:'recorded'}),
    getAttribution:async()=>{throw Error('isolated ads staging is down')},
    recordTrustedEvent:async()=>{throw Error('db temporarily down')}
  },onFailure:async event=>{events.push(event);throw Error('monitor outage')}});
  const ops=[{resource:'lead',operation:'create',id:'L-new',input:{source:'Mini App'}}];
  const deferred=await bridge.enrichLeadOperations(ops,access);
  assert.notStrictEqual(deferred,ops);
  assert.equal(deferred[0].input.adsAttributionStatus,'lookup_unavailable');
  assert.equal(ops[0].input.adsAttributionStatus,undefined);
  assert.deepEqual(events,[{code:'ads_snapshot_unavailable',eventType:'lead_create'}]);
  const manuallyPersisted=[{...ops[0],input:{...ops[0].input,adsAttribution:{
    source:'Telegram Ads',lastTouch:{campaignId:'previously saved'}
  }}}];
  assert.deepEqual(await bridge.recordCommittedLeads(manuallyPersisted,access,{committed:true}),
    {attempted:1,recorded:0,pending:1});
});

test('Telegram/VK client state never discloses advertising campaign IDs or outage marker',()=>{
  const campaign={source:'Telegram Ads',lastTouch:{campaignId:'private-ads-campaign'}};
  const state={initialized:true,leads:[{
    id:'L-PRIVACY',clientCreated:true,clientProvider:'telegram',
    clientProviderUserId:'10050',clientIdentityKey:'telegram:10050',
    adsAttribution:campaign,adsAttributionStatus:'lookup_unavailable',name:'Client'
  }],quotes:[],orders:[],catalog:[],team:[],notes:{}};
  const visible=clientState(state,{provider:'telegram',id:'10050'});
  assert.equal(visible.leads.length,1);
  assert.equal(visible.leads[0].id,'L-PRIVACY');
  assert.equal('adsAttribution' in visible.leads[0],false);
  assert.equal('adsAttributionStatus' in visible.leads[0],false);
  assert.equal(state.leads[0].adsAttribution.lastTouch.campaignId,'private-ads-campaign');
});

test('stalled secondary YDB lookup is bounded and produces recoverable CRM marker',async()=>{
  const warnings=[];
  const bridge=createAdsStageBBridge({enabled:true,service:{
    recordBotStart:async()=>({status:'recorded'}),
    getAttribution:()=>new Promise(()=>{}),
    recordTrustedEvent:async()=>({status:'recorded'})
  },lookupTimeoutMs:20,onFailure:async x=>warnings.push(x)});
  const started=Date.now();
  const operations=await bridge.enrichLeadOperations([{
    resource:'lead',operation:'create',id:'L-TIMEOUT',
    input:{clientSubmittedAt:'2026-10-27T06:00:00Z',source:'Mini App'}
  }],access);
  assert.ok(Date.now()-started<1000);
  assert.equal(operations[0].input.adsAttributionStatus,'lookup_unavailable');
  assert.equal(warnings[0].code,'ads_snapshot_unavailable');
});
