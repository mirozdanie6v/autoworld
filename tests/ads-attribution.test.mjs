import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdsAttributionService,
  createMemoryAdsAttributionRepository,
  createAdsSubjectKey,
  generateAdsToken,
  parseAdsStartPayload,
  hashAdsToken
} from '../server/ads-attribution-core.mjs';
import {
  ADS_ATTRIBUTION_TABLES,
  ensureAdsAttributionSchema,
  createYdbAdsAttributionRepository
} from '../server/ads-attribution-ydb.mjs';

const secret='test-secret-for-isolated-ads-coverage-only-64-bytes-0123456789';
function fixture(){
  const repository=createMemoryAdsAttributionRepository();
  let now='2026-10-26T08:00:00.000Z';
  const service=createAdsAttributionService({
    repository,subjectSecret:secret,clock:()=>new Date(now)
  });
  return {repository,service,setNow:value=>{now=value;}};
}

test('campaign token is cryptographically random, Telegram deep-link safe, never persisted raw',async()=>{
  const {repository,service}=fixture();
  const a=await service.issueCampaign({campaignId:'ru-auto-a',adId:'ad-1',creativeId:'c-2'});
  const b=await service.issueCampaign({campaignId:'ru-auto-b'});
  assert.notEqual(a.token,b.token);
  assert.equal(a.token.length,32);
  assert.equal(parseAdsStartPayload(a.token),a.token);
  assert.equal(parseAdsStartPayload('bad?x=1'),null);
  assert.equal(parseAdsStartPayload(a.token+' '.repeat(1)),null);
  assert.equal(parseAdsStartPayload('x'.repeat(65)),null);
  assert.equal(repository.snapshotForTests().campaigns[0].token,undefined);
  assert.equal(repository.snapshotForTests().campaigns[0].tokenHash,hashAdsToken(a.token));
  assert.notEqual(hashAdsToken(a.token),a.token);
  assert.equal(ADS_ATTRIBUTION_TABLES.length,3);
  assert.notEqual(generateAdsToken(),generateAdsToken());
});

test('two campaigns: first and last touch are durable logical snapshot without raw Telegram ID',async()=>{
  const {repository,service,setNow}=fixture();
  const a=await service.issueCampaign({campaignId:'campaign-A',adId:'ad-1'});
  const b=await service.issueCampaign({campaignId:'campaign-B',adId:'ad-2'});
  const first=await service.recordBotStart({telegramUserId:'123456789',startPayload:a.token,updateId:100});
  assert.deepEqual(first,{status:'recorded',campaignId:'campaign-A'});
  setNow('2026-10-27T08:00:00.000Z');
  const second=await service.recordBotStart({telegramUserId:'123456789',startPayload:b.token,updateId:101});
  assert.equal(second.status,'recorded');
  const attribution=await service.getAttribution({telegramUserId:'123456789'});
  assert.equal(attribution.firstTouch.campaignId,'campaign-A');
  assert.equal(attribution.lastTouch.campaignId,'campaign-B');
  assert.equal(attribution.lastTouch.adId,'ad-2');
  const state=repository.snapshotForTests();
  assert.equal(state.subjects.length,1);
  assert.equal(state.events.length,2);
  const stored=JSON.stringify(state);
  assert.equal(stored.includes('123456789'),false);
  assert.equal(stored.includes(a.token),false);
  assert.match(state.subjects[0].firstTouch.timestamp,/Z$/);
});

test('duplicate Telegram update does not overwrite last touch or inflate counts',async()=>{
  const {repository,service,setNow}=fixture();
  const a=await service.issueCampaign({campaignId:'A'});
  const b=await service.issueCampaign({campaignId:'B'});
  await service.recordBotStart({telegramUserId:12345,startPayload:a.token,updateId:5});
  setNow('2026-10-27T08:00:00.000Z');
  const replay=await service.recordBotStart({telegramUserId:12345,startPayload:b.token,updateId:5});
  assert.deepEqual(replay,{status:'duplicate'});
  assert.equal((await service.getAttribution({telegramUserId:12345})).lastTouch.campaignId,'A');
  assert.equal(repository.snapshotForTests().events.length,1);
});

test('unregistered, malformed and inactive campaigns never write touches',async()=>{
  const {repository,service}=fixture();
  assert.equal((await service.recordBotStart({telegramUserId:123,startPayload:'organic',updateId:1})).status,'ignored');
  assert.equal((await service.recordBotStart({telegramUserId:123,startPayload:generateAdsToken(),updateId:2})).reason,'unknown_or_inactive_campaign');
  const c=await service.issueCampaign({campaignId:'inactive'});
  const tokenHash=hashAdsToken(c.token);
  assert.deepEqual(await service.setCampaignTokenActive({tokenHash,active:false}),{updated:true});
  assert.equal((await service.recordBotStart({telegramUserId:123,startPayload:c.token,updateId:3})).reason,'unknown_or_inactive_campaign');
  assert.equal(repository.snapshotForTests().events.length,0);
  assert.deepEqual(await service.setCampaignTokenActive({tokenHash,active:true}),{updated:true});
  assert.equal((await service.recordBotStart({telegramUserId:123,startPayload:c.token,updateId:3})).status,'recorded');
  assert.equal(repository.snapshotForTests().events.length,1);
  await assert.rejects(service.recordBotStart({telegramUserId:'victim',startPayload:c.token,updateId:4}),/invalid_telegram_user_id/);
  await assert.rejects(service.recordBotStart({telegramUserId:123,startPayload:c.token,updateId:'bad'}),/invalid_telegram_update_id/);
  await assert.rejects(service.issueCampaign({campaignId:'bad id'}),/invalid_campaign_id/);
});

test('30-day rolling expiration fails closed; already stored event is not deleted',async()=>{
  const {repository,service,setNow}=fixture();
  const c=await service.issueCampaign({campaignId:'RU'});
  await service.recordBotStart({telegramUserId:987,startPayload:c.token,updateId:333});
  setNow('2026-11-26T08:00:01.000Z');
  assert.equal(await service.getAttribution({telegramUserId:987}),null);
  assert.deepEqual(await service.recordTrustedEvent({
    telegramUserId:987,eventType:'lead_submit',eventId:'lead_1'
  }),{status:'ignored',reason:'no_active_attribution'});
  assert.equal(repository.snapshotForTests().events.length,1);
});

test('server-trusted events are idempotent and use latest verified campaign',async()=>{
  const {repository,service}=fixture();
  const a=await service.issueCampaign({campaignId:'a'});
  await service.recordBotStart({telegramUserId:78,startPayload:a.token,updateId:1});
  const payload={telegramUserId:78,eventType:'vehicle_view',eventId:'car_123'};
  assert.equal((await service.recordTrustedEvent(payload)).status,'recorded');
  assert.deepEqual(await service.recordTrustedEvent(payload),{status:'duplicate'});
  assert.equal(repository.snapshotForTests().events.length,2);
  assert.equal(repository.snapshotForTests().events[1].campaignId,'a');
  await assert.rejects(service.recordTrustedEvent({...payload,eventType:'unknown'}),/invalid_ads_event_type/);
  await assert.rejects(service.recordTrustedEvent({...payload,eventId:'../override'}),/invalid_event_id/);
});

test('subject HMAC is stable, key separated and secret is mandatory',()=>{
  assert.equal(createAdsSubjectKey('111',secret),createAdsSubjectKey(111,secret));
  assert.notEqual(createAdsSubjectKey(111,secret),createAdsSubjectKey(112,secret));
  assert.notEqual(createAdsSubjectKey(111,secret),createAdsSubjectKey(111,secret+'second'));
  assert.throws(()=>createAdsSubjectKey(111,'short'),/secret_required/);
  assert.throws(()=>createAdsAttributionService({repository:createMemoryAdsAttributionRepository(),subjectSecret:'short'}),/secret_required/);
});

test('YDB schema is explicit, isolated and cannot modify existing CRM tables',async()=>{
  const statements=[];
  const sql=(pieces)=>{statements.push(pieces.join(''));return Promise.resolve([]);};
  await assert.rejects(ensureAdsAttributionSchema(sql),/isolated_test_database/);
  assert.equal(statements.length,0);
  await ensureAdsAttributionSchema(sql,{target:'isolated-test-database'});
  assert.equal(statements.length,3);
  for(const [index,name] of ADS_ATTRIBUTION_TABLES.entries()){
    assert.match(statements[index],new RegExp('CREATE TABLE IF NOT EXISTS '+name));
    assert.doesNotMatch(statements[index],/auto_sale_leads|auto_sale_orders|auto_sale_state/i);
  }
  assert.throws(()=>createYdbAdsAttributionRepository(sql),/transactional_sql_required/);
});

test('reject anonymous or structurally invalid campaigns and event IDs',async()=>{
  const {service}=fixture();
  await assert.rejects(service.issueCampaign({campaignId:''}),/invalid_campaign_id/);
  await assert.rejects(service.issueCampaign({campaignId:'valid',creativeId:'invalid creative'}),/invalid_creative_id/);
  assert.equal(parseAdsStartPayload(null),null);
  assert.throws(()=>hashAdsToken('abc'),/invalid_ads_token/);
});

test('campaign suspension validates the token hash and active value',async()=>{
  const {service}=fixture();
  await assert.rejects(service.setCampaignTokenActive({tokenHash:'junk',active:false}),/invalid_ads_token_hash/);
  await assert.rejects(service.setCampaignTokenActive({tokenHash:'a'.repeat(64),active:'no'}),/invalid_ads_token_active_state/);
  assert.deepEqual(await service.setCampaignTokenActive({tokenHash:'a'.repeat(64),active:false}),{updated:false});
});

test('missing, corrupted, out-of-order and future timestamps fail closed',async()=>{
  const repository=createMemoryAdsAttributionRepository();
  const clock=()=>new Date('2026-10-26T08:00:00Z');
  const service=createAdsAttributionService({repository,subjectSecret:secret,clock});
  const cases=[
    null,
    {firstTouch:{campaignId:'A',timestamp:'bad'},lastTouch:{campaignId:'A',timestamp:'bad'}},
    {firstTouch:{campaignId:'A',timestamp:'2026-10-27T00:00:00Z'},lastTouch:{campaignId:'A',timestamp:'2026-10-26T00:00:00Z'}},
    {firstTouch:{campaignId:'A',timestamp:'2026-10-26T00:00:00Z'},lastTouch:{campaignId:'A',timestamp:'2100-01-01T00:00:00Z'}},
    {firstTouch:null,lastTouch:{campaignId:'A',timestamp:'2026-10-26T00:00:00Z'}},
  ];
  for(const value of cases){
    const mock={...repository,readSubject:async()=>value};
    const stub=createAdsAttributionService({repository:mock,subjectSecret:secret,clock});
    assert.equal(await stub.getAttribution({telegramUserId:42}),null);
  }
  assert.equal(await service.getAttribution({telegramUserId:42}),null);
});

test('event key collisions across Telegram users are explicit errors, not silent duplicates',async()=>{
  const {service}=fixture();
  const c=await service.issueCampaign({campaignId:'A'});
  await service.recordBotStart({telegramUserId:111,startPayload:c.token,updateId:55});
  await assert.rejects(service.recordBotStart({telegramUserId:222,startPayload:c.token,updateId:55}),/ads_event_id_collision/);
  await service.recordBotStart({telegramUserId:222,startPayload:c.token,updateId:56});
  await service.recordTrustedEvent({telegramUserId:111,eventType:'vehicle_view',eventId:'evt1'});
  await assert.rejects(service.recordTrustedEvent({telegramUserId:222,eventType:'vehicle_view',eventId:'evt1'}),/ads_event_id_collision/);
});

test('bounded event pagination returns all receipts once in consistent primary-key order',async()=>{
  const {service}=fixture();
  const c=await service.issueCampaign({campaignId:'A'});
  for(const [index,updateId] of [9,20,1].entries()){
    await service.recordBotStart({telegramUserId:123,startPayload:c.token,updateId});
  }
  const all=[];
  let cursor='';
  for(let i=0;i<5;i++){
    const page=await service.listVerifiedEvents({cursor,limit:2});
    all.push(...page.events.map(e=>e.eventId));
    if(!page.nextCursor)break;
    cursor=page.nextCursor;
  }
  assert.deepEqual(all,['tg-start:1','tg-start:20','tg-start:9']);
  assert.equal(new Set(all).size,3);
  await assert.rejects(service.listVerifiedEvents({limit:1001}),/invalid_ads_event_limit/);
  await assert.rejects(service.listVerifiedEvents({cursor:'x'.repeat(121)}),/invalid_ads_event_cursor/);
});

test('numeric Telegram IDs beyond Number.MAX_SAFE_INTEGER are rejected to avoid identity collisions',()=>{
  assert.throws(()=>createAdsSubjectKey(9007199254740992,secret),/invalid_telegram_user_id/);
  assert.match(createAdsSubjectKey('9007199254740992',secret),/^[a-f0-9]{64}$/);
});
