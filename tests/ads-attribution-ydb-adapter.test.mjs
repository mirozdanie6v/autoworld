import test from 'node:test';
import assert from 'node:assert/strict';
import {toJs} from '@ydbjs/value';
import {
  createYdbAdsAttributionRepository,
  ensureAdsAttributionSchema
} from '../server/ads-attribution-ydb.mjs';
import {
  createAdsAttributionService,
  hashAdsToken
} from '../server/ads-attribution-core.mjs';
import {summarizeAdsCampaignsFromRepository} from '../server/ads-attribution-report.mjs';

// SQL adapter contract test. This is NOT a substitute for a live YDB integration test.
function fakeYdb(){
  const campaigns=new Map(),subjects=new Map(),events=new Map(),blocks=new Map(),touches=new Map(),ddl=[];
  const sql=async(strings,...args)=>{
    const statement=strings.join('?').replace(/\s+/g,' ').trim();
    const result=rows=>[rows];
    if(statement.startsWith('CREATE TABLE IF NOT EXISTS')){
      ddl.push(statement);
      return result([]);
    }
    if(statement.startsWith('SELECT subject_key FROM awg_ads_erasure_blocks')){
      const row=blocks.get(args[0]);
      return result(row?[{subject_key:args[0]}]:[]);
    }
    if(statement.startsWith('UPSERT INTO awg_ads_events_by_subject')||
       statement.startsWith('UPSERT INTO awg_ads_events_by_time'))return result([]);
    if(statement.startsWith('UPSERT INTO awg_ads_touches_by_subject_time')){
      const [subject_key,occurred_at,event_id,campaign_id,ad_id,creative_id]=args;
      touches.set(event_id,{subject_key,occurred_at,event_id,campaign_id,ad_id,creative_id});
      return result([]);
    }
    if(statement.includes('FROM awg_ads_touches_by_subject_time')){
      const [subject_key,asOf,limit]=args;
      return result([...touches.values()].filter(x=>x.subject_key===subject_key&&x.occurred_at<=asOf)
        .sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at))
        .slice(0,Number(toJs(limit))));
    }
    if(statement.startsWith('SELECT token_hash FROM awg_ads_campaigns')){
      const row=campaigns.get(args[0]);
      return result(row?[{token_hash:row.token_hash}]:[]);
    }
    if(statement.startsWith('SELECT campaign_id,ad_id,creative_id,active FROM awg_ads_campaigns')){
      const row=campaigns.get(args[0]);
      return result(row?[row]:[]);
    }
    if(statement.startsWith('UPSERT INTO awg_ads_campaigns')){
      const [token_hash,campaign_id,ad_id,creative_id,source,active,created_at]=args;
      campaigns.set(token_hash,{token_hash,campaign_id,ad_id,creative_id,source,active,created_at});
      return result([]);
    }
    if(statement.startsWith('UPDATE awg_ads_campaigns SET active=')){
      const [active,tokenHash]=args;
      campaigns.get(tokenHash).active=active;
      return result([]);
    }
    if(statement.startsWith('SELECT first_touch,last_touch FROM awg_ads_subjects')){
      const row=subjects.get(args[0]);
      return result(row?[row]:[]);
    }
    if(statement.startsWith('UPSERT INTO awg_ads_subjects')){
      const [subject_key,first_touch,last_touch,updated_at]=args;
      subjects.set(subject_key,{subject_key,first_touch,last_touch,updated_at});
      return result([]);
    }
    if(statement.startsWith('SELECT event_id,subject_key FROM awg_ads_events')||
       statement.startsWith('SELECT subject_key,event_type FROM awg_ads_events')){
      const row=events.get(args[0]);
      return result(row?[row]:[]);
    }
    if(statement.startsWith('UPSERT INTO awg_ads_events')){
      const [event_id,subject_key,event_type,campaign_id,ad_id,creative_id,occurred_at]=args;
      events.set(event_id,{event_id,subject_key,event_type,campaign_id,ad_id,creative_id,occurred_at});
      return result([]);
    }
    if(statement.includes('FROM awg_ads_events WHERE event_id >')){
      const [cursor,limit]=args;
      const rows=[...events.values()].filter(x=>x.event_id>cursor)
        .sort((a,b)=>a.event_id<b.event_id?-1:1)
        .slice(0,Number(toJs(limit)));
      return result(rows);
    }
    throw new Error('Unexpected SQL: '+statement);
  };
  sql.begin=async(config,fn)=>{
    assert.equal(config.isolation,'serializableReadWrite');
    assert.equal(config.idempotent,true);
    return fn(sql);
  };
  return {sql,ddl,campaigns,subjects,events};
}

const secret='minimum-32-byte-test-secret-for-ads-attribution-123';
test('YDB adapter contract: create /start, dedupe, two touches, suspend, retrieve events, report',async()=>{
  const db=fakeYdb();
  await ensureAdsAttributionSchema(db.sql,{target:'isolated-test-database'});
  assert.equal(db.ddl.length,7);
  const repository=createYdbAdsAttributionRepository(db.sql);
  let now='2026-10-26T09:00:00Z';
  const service=createAdsAttributionService({
    repository,subjectSecret:secret,clock:()=>new Date(now)
  });
  const a=await service.issueCampaign({campaignId:'ad-A',adId:'creative-a'});
  const b=await service.issueCampaign({campaignId:'ad-B'});
  assert.equal(db.campaigns.size,2);
  assert.equal(db.campaigns.has(hashAdsToken(a.token)),true);
  assert.equal((await service.recordBotStart({telegramUserId:123,startPayload:a.token,updateId:55})).status,'recorded');
  assert.deepEqual(await service.recordBotStart({telegramUserId:123,startPayload:a.token,updateId:55}),{status:'duplicate'});
  now='2026-10-27T09:00:00Z';
  await service.recordBotStart({telegramUserId:123,startPayload:b.token,updateId:56});
  assert.equal((await service.getAttribution({telegramUserId:123})).firstTouch.campaignId,'ad-A');
  assert.equal((await service.getAttribution({telegramUserId:123})).lastTouch.campaignId,'ad-B');
  await service.recordTrustedEvent({telegramUserId:123,eventType:'lead_submit',eventId:'lead-1'});
  const result=await summarizeAdsCampaignsFromRepository({repository,pageSize:2,maxPages:3});
  assert.equal(result.find(x=>x.campaignId==='ad-A').botStarts,1);
  assert.equal(result.find(x=>x.campaignId==='ad-B').leadSubmissions,1);
  assert.equal(result.find(x=>x.campaignId==='ad-B').paidClicks,null);
  assert.equal(db.subjects.size,1);
  assert.equal(db.events.size,3);
  assert.deepEqual(await service.setCampaignTokenActive({tokenHash:hashAdsToken(b.token),active:false}),{updated:true});
  assert.equal((await service.recordBotStart({telegramUserId:456,startPayload:b.token,updateId:57})).status,'ignored');
  assert.equal(db.events.size,3);
});
test('YDB adapter contract: missing campaign suspension and receipt ID collision',async()=>{
  const db=fakeYdb();
  const repository=createYdbAdsAttributionRepository(db.sql);
  const service=createAdsAttributionService({repository,subjectSecret:secret});
  assert.deepEqual(await service.setCampaignTokenActive({tokenHash:'a'.repeat(64),active:false}),{updated:false});
  const a=await service.issueCampaign({campaignId:'A'});
  await service.recordBotStart({telegramUserId:101,startPayload:a.token,updateId:9});
  await assert.rejects(service.recordBotStart({telegramUserId:102,startPayload:a.token,updateId:9}),/ads_event_id_collision/);
  await service.recordTrustedEvent({telegramUserId:101,eventType:'miniapp_open',eventId:'req-1'});
  await service.recordBotStart({telegramUserId:102,startPayload:a.token,updateId:10});
  await assert.rejects(service.recordTrustedEvent({telegramUserId:102,eventType:'miniapp_open',eventId:'req-1'}),/ads_event_id_collision/);
});
