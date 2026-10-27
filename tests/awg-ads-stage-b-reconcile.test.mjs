import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdsAttributionService,createMemoryAdsAttributionRepository} from '../server/ads-attribution-core.mjs';
import {createAdsStageBBridge} from '../server/ads-attribution-stage-b.mjs';
import {createAdsLeadReconciliationJob,createPersistedLeadPageReader} from '../server/ads-stage-b-reconciliation.mjs';
import {startAdsTelemetry} from '../public/auto-sale-ads-telemetry.mjs';

const SECRET='stage-b-reconciliation-ci-secret-not-production-012345';
const clock=()=>new Date('2026-10-27T09:00:00Z');
function setup(){
  const repository=createMemoryAdsAttributionRepository();
  const service=createAdsAttributionService({repository,subjectSecret:SECRET,clock});
  const audit=[];
  const bridge=createAdsStageBBridge({enabled:true,service,onFailure:async x=>audit.push(x)});
  return {repository,service,bridge,audit};
}
test('saved CRM snapshot keeps original campaign when user later starts another campaign',async()=>{
  const {repository,service,bridge}=setup();
  const first=(await service.issueCampaign({campaignId:'A'})).token;
  const second=(await service.issueCampaign({campaignId:'B'})).token;
  await service.recordBotStart({telegramUserId:'1919',startPayload:first,updateId:101});
  const access={role:'client',authenticated:true,authType:'telegram',user:{id:'1919'}};
  const decorated=await bridge.enrichLeadOperations([
    {resource:'lead',operation:'create',id:'L-1919',input:{source:'Mini App',clientProvider:'telegram',clientProviderUserId:'1919'}}
  ],access);
  assert.equal(decorated[0].input.adsAttribution.lastTouch.campaignId,'A');
  // Lead persisted in CRM, ads receipt fails before delivery; a new campaign arrives.
  const committed={...decorated[0].input,id:'L-1919',clientProvider:'telegram',clientProviderUserId:'1919'};
  await service.recordBotStart({telegramUserId:'1919',startPayload:second,updateId:102});
  assert.equal((await service.getAttribution({telegramUserId:'1919'})).lastTouch.campaignId,'B');
  assert.equal((await bridge.reconcilePersistedLead(committed)).status,'recorded');
  assert.equal((await bridge.reconcilePersistedLead(committed)).status,'duplicate');
  const receipt=repository.snapshotForTests().events.find(x=>x.eventType==='lead_submit');
  assert.equal(receipt.campaignId,'A');
});
test('reconciliation scans authoritative committed leads only, resumes by cursor and is idempotent',async()=>{
  const {repository,service,bridge}=setup();
  const token=(await service.issueCampaign({campaignId:'C'})).token;
  await service.recordBotStart({telegramUserId:'333',startPayload:token,updateId:3330});
  const access={role:'client',authenticated:true,authType:'telegram',user:{id:'333'}};
  const stamped=await bridge.enrichLeadOperations([
    {resource:'lead',operation:'create',id:'L-001',input:{}},
    {resource:'lead',operation:'create',id:'L-002',input:{}}
  ],access);
  const leads=stamped.map(op=>({...op.input,id:op.id,clientProvider:'telegram',clientProviderUserId:'333'}));
  leads.push({id:'L-003',clientProvider:'vk',adsAttribution:{source:'Telegram Ads',lastTouch:{campaignId:'FAKE'}}});
  const audits=[],alerts=[];
  const job=createAdsLeadReconciliationJob({
    listCommittedLeads:createPersistedLeadPageReader({readAuthoritativeState:async()=>({leads})}),
    bridge,pageSize:1,maxPages:1,
    onAudit:async row=>audits.push(row),onAlert:async row=>alerts.push(row)
  });
  await assert.rejects(job.run(),/authorization_required/);
  const r1=await job.run({authorized:true});
  assert.deepEqual({scanned:r1.scanned,recorded:r1.recorded,complete:r1.complete,nextCursor:r1.nextCursor},
    {scanned:1,recorded:1,complete:false,nextCursor:'L-001'});
  const r2=await job.run({authorized:true,cursor:r1.nextCursor});
  assert.equal(r2.recorded,1);
  const r3=await job.run({authorized:true,cursor:r2.nextCursor});
  assert.equal(r3.ignored,1);
  const replay=await job.run({authorized:true});
  assert.equal(replay.duplicates,1);
  assert.equal(repository.snapshotForTests().events.filter(x=>x.eventType==='lead_submit').length,2);
  assert.equal(audits.length,4);
  assert.ok(alerts.length>=2);
});
test('server validates vehicle catalog and signer; repeats dedupe daily',async()=>{
  const {repository,service,bridge}=setup();
  const token=(await service.issueCampaign({campaignId:'D'})).token;
  await service.recordBotStart({telegramUserId:'555',startPayload:token,updateId:551});
  const access={role:'client',authenticated:true,authType:'telegram',user:{id:'555'}};
  const catalog=[{id:'car-A',active:true},{id:'car-B',active:false}];
  assert.equal((await bridge.recordMiniAppEvent({access,eventType:'miniapp_open'})).status,'recorded');
  assert.equal((await bridge.recordMiniAppEvent({access,eventType:'miniapp_open'})).status,'duplicate');
  assert.equal((await bridge.recordMiniAppEvent({access,eventType:'vehicle_detail_click',carId:'car-A',catalog})).status,'recorded');
  assert.equal((await bridge.recordMiniAppEvent({access,eventType:'vehicle_detail_click',carId:'car-B',catalog})).reason,'vehicle_not_in_current_catalog');
  assert.equal((await bridge.recordMiniAppEvent({access:{...access,authType:'vk'},eventType:'miniapp_open'})).status,'forbidden');
  assert.equal(repository.snapshotForTests().events.filter(x=>x.eventType==='vehicle_detail_click').length,1);
  assert.equal(repository.snapshotForTests().events.filter(x=>x.eventType==='miniapp_open').length,1);
});
test('browser telemetry posts only type and carId, never forged campaigns or Telegram identifiers',async()=>{
  const calls=[];
  const handlers=new Map();
  const root={
    addEventListener:(name,callback)=>handlers.set(name,callback),
    removeEventListener:name=>handlers.delete(name)
  };
  const stop=startAdsTelemetry({
    authHeaders:headers=>({...headers,'x-telegram-init-data':'opaque-signed-data'}),
    fetchImpl:async(url,options)=>calls.push({url,options}),
    root
  });
  await Promise.resolve();
  handlers.get('click')({target:{closest:()=>({dataset:{detail:'CAR-123'}})}});
  await Promise.resolve();
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>JSON.parse(c.options.body)),[
    {eventType:'miniapp_open'},{eventType:'vehicle_detail_click',carId:'CAR-123'}
  ]);
  assert.ok(calls.every(x=>x.url==='/api/auto-sale/ads/event'));
  stop();
  assert.equal(handlers.has('click'),false);
});


test('ads DB lookup outage persists recovery marker and replays campaign as-of CRM submit, not newer /start',async()=>{
  const repository=createMemoryAdsAttributionRepository();
  let current='2026-10-27T08:00:00Z';
  const service=createAdsAttributionService({repository,subjectSecret:SECRET,clock:()=>new Date(current)});
  const tokenA=(await service.issueCampaign({campaignId:'outage-A'})).token;
  const tokenB=(await service.issueCampaign({campaignId:'later-B'})).token;
  await service.recordBotStart({telegramUserId:'9991',startPayload:tokenA,updateId:'7001'});
  current='2026-10-27T08:10:00Z';
  const warning=[];
  const impaired=createAdsStageBBridge({enabled:true,
    service:{...service,getAttribution:async()=>{throw Error('temporary ads YDB read failure')}},
    onFailure:async row=>warning.push(row)});
  const access={role:'client',authenticated:true,authType:'telegram',user:{id:'9991'}};
  const decorated=await impaired.enrichLeadOperations([
    {resource:'lead',operation:'create',id:'L-OUTAGE-1',input:{
      id:'L-OUTAGE-1',source:'Mini App',clientSubmittedAt:current,
      clientProvider:'telegram',clientProviderUserId:'9991'
    }}
  ],access);
  assert.equal(decorated[0].input.adsAttribution,undefined);
  assert.equal(decorated[0].input.adsAttributionStatus,'lookup_unavailable');
  assert.equal(warning[0].code,'ads_snapshot_unavailable');
  // This is the record actually committed by CRM, with no chosen campaign.
  const committed={...decorated[0].input};
  current='2026-10-27T08:20:00Z';
  await service.recordBotStart({telegramUserId:'9991',startPayload:tokenB,updateId:'7002'});
  assert.equal((await service.getAttribution({telegramUserId:'9991'})).lastTouch.campaignId,'later-B');
  const recovered=await impaired.reconcilePersistedLead(committed);
  assert.equal(recovered.status,'recorded');
  assert.equal((await impaired.reconcilePersistedLead(committed)).status,'duplicate');
  const receipt=repository.snapshotForTests().events.find(x=>x.eventType==='lead_submit');
  assert.equal(receipt.campaignId,'outage-A');
  committed.firstManagerActionAt=current;
  await impaired.reconcilePersistedLead(committed);
  assert.equal(repository.snapshotForTests().events.find(x=>x.eventType==='first_manager_action').campaignId,'outage-A');
});

test('outage marker without valid historical touch stays unattributed, never assigns later campaign',async()=>{
  const {service,bridge,repository}=setup();
  const token=(await service.issueCampaign({campaignId:'late'})).token;
  await service.recordBotStart({telegramUserId:'9001',startPayload:token,updateId:'9001'});
  const lead={id:'L-MISSING',clientProvider:'telegram',clientProviderUserId:'9001',
    clientSubmittedAt:'2026-10-27T08:30:00Z',
    adsAttributionStatus:'lookup_unavailable'};
  assert.equal((await bridge.reconcilePersistedLead(lead)).reason,'no_verified_historical_touch');
  assert.equal(repository.snapshotForTests().events.filter(x=>x.eventType==='lead_submit').length,0);
});
