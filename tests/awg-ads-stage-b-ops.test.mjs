import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdsCrmPrivacyErasure} from '../server/ads-stage-b-crm-privacy.mjs';
import {createAdsRecoverableBridge} from '../server/ads-stage-b-resilient.mjs';
import {createAdsManagedJobRunner,registerAdsExternallyManagedJobs} from '../server/ads-stage-b-managed-jobs.mjs';
import {ensureAdsManagedJobSchema,createYdbAdsManagedJobRepository} from '../server/ads-stage-b-job-ydb.mjs';

function env(){return {
  AWG_ADS_STAGE_B_ENABLED:'true',AWG_ADS_STAGE_B_MODE:'isolated-staging',
  AWG_ADS_MANAGED_JOBS_ENABLED:'true',
  YDB_CONNECTION_STRING:'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/main',
  AWG_ADS_STAGE_B_YDB_CONNECTION_STRING:'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ads-staging'
};}
function fakeLease(){
  const active=new Map(),completed=[];
  return {completed,async acquire({jobId,ownerId,leaseUntil,now}){
    const existing=active.get(jobId);
    if(existing&&existing.leaseUntil>now)return {acquired:false};
    active.set(jobId,{ownerId,leaseUntil});
    return {acquired:true};
  },async complete({jobId,ownerId,status,finishedAt}){
    assert.equal(active.get(jobId)?.ownerId,ownerId);
    active.delete(jobId);completed.push({jobId,status,finishedAt});
    return {completed:true};
  }};
}

test('managed jobs require staging, separate ads DB, IAM verifier and durable lease',()=>{
  assert.throws(()=>createAdsManagedJobRunner({}),/staging_gate/);
  assert.throws(()=>createAdsManagedJobRunner({env:{...env(),
    AWG_ADS_STAGE_B_YDB_CONNECTION_STRING:env().YDB_CONNECTION_STRING}}),/staging_gate/);
  assert.throws(()=>createAdsManagedJobRunner({env:env()}),/dependencies/);
});
test('external scheduler registers two jobs with strict runtime/retries, never an app timer',()=>{
  const registered=[];
  const scheduler={register:(opts,fn)=>{registered.push({opts,fn});return opts.id}};
  const principal={id:'staging-service'};
  const runner={run:async({jobId})=>({status:jobId})};
  assert.equal(registerAdsExternallyManagedJobs({scheduler,runner,principal}).length,2);
  assert.deepEqual(registered.map(x=>x.opts.cron),['*/15 * * * *','0 3 * * *']);
  assert.ok(registered.every(x=>x.opts.maxConcurrent===1&&x.opts.retries===3));
});
test('managed job denies unverified caller and limits concurrent leased jobs',async()=>{
  const leases=fakeLease(),metrics=[],alerts=[];
  let finish;
  const gate=new Promise(resolve=>finish=resolve);
  const runner=createAdsManagedJobRunner({env:env(),leases,
    authorizeServiceIdentity:async({principal})=>principal?.id==='staging-iam',
    reconcile:async()=>{await gate;return {complete:true,errors:0};},
    retention:async()=>({status:'complete'}),
    emitMetric:async x=>metrics.push(x),emitAlert:async x=>alerts.push(x)});
  await assert.rejects(runner.run({jobId:'awg-ads-reconcile',
    principal:{id:'unauthorized'}}),/unauthorized/);
  const first=runner.run({jobId:'awg-ads-reconcile',principal:{id:'staging-iam'}});
  await new Promise(resolve=>setImmediate(resolve));
  const duplicate=await runner.run({jobId:'awg-ads-reconcile',principal:{id:'staging-iam'}});
  assert.equal(duplicate.status,'already_running');
  finish();
  assert.equal((await first).status,'complete');
  assert.equal(leases.completed.length,1);
  assert.equal(leases.completed[0].status,'success');
  assert.ok(metrics.some(m=>m.name==='awg_ads_managed_skipped_lease'));
  assert.deepEqual(alerts,[]);
});
test('reconciliation partial failure records a durable failure and emits an alert',async()=>{
  const leases=fakeLease(),alerts=[];
  const runner=createAdsManagedJobRunner({env:env(),leases,
    authorizeServiceIdentity:async()=>true,
    reconcile:async()=>({complete:false,errors:1}),
    retention:async()=>({status:'complete'}),
    emitMetric:async()=>{},emitAlert:async e=>alerts.push(e)});
  await assert.rejects(runner.run({jobId:'awg-ads-reconcile',
    principal:{id:'staging-iam'}}),/incomplete/);
  assert.equal(leases.completed[0].status,'failure');
  assert.equal(alerts[0].code,'ads_managed_job_failed');
});
test('retention job rejects missing auditor SQL migration target',async()=>{
  const statements=[];
  const sql=async(strings)=>{statements.push(strings.join(''));return []};
  await assert.rejects(ensureAdsManagedJobSchema(sql),/isolated_test_database/);
  assert.equal(statements.length,0);
  await ensureAdsManagedJobSchema(sql,{target:'isolated-test-database'});
  assert.equal(statements.length,2);
  assert.match(statements[0],/awg_ads_job_leases/);
  assert.match(statements[1],/awg_ads_job_runs/);
  assert.throws(()=>createYdbAdsManagedJobRepository(sql),/transactional_sql_required/);
});
test('authorized cross-store erase patches ad metadata with CAS and preserves non-ad CRM fields',async()=>{
  const leads=[
    {id:'L-a',clientProvider:'telegram',clientProviderUserId:'777',
      adsAttribution:{source:'Telegram Ads',lastTouch:{campaignId:'A'}},
      model:'BMW',budget:42000},
    {id:'L-b',clientProvider:'telegram',clientProviderUserId:'777',
      adsAttributionStatus:'lookup_unavailable',model:'Audi'},
    {id:'L-vk',clientProvider:'vk',clientProviderUserId:'777',
      adsAttribution:{source:'Telegram Ads'},model:'Jeep'},
    {id:'L-organic',clientProvider:'telegram',clientProviderUserId:'777',model:'Kia'},
    {id:'L-other',clientProvider:'telegram',clientProviderUserId:'778',
      adsAttribution:{source:'Telegram Ads'},model:'Tesla'}
  ];
  const versions=new Map(leads.map(l=>[l.id,1]));
  const patches=[],audits=[],alerts=[];
  let erased=0;
  const erase=createAdsCrmPrivacyErasure({
    privacyService:{eraseVerifiedTelegramUser:async({telegramUserId,principal})=>{
      if(principal?.id!=='operator-iam')throw Error('forbidden');
      assert.equal(telegramUserId,'777');
      erased++;return {status:'complete',deletedEvents:9};
    }},
    readAuthoritativeState:async()=>({leads:structuredClone(leads)}),
    getLeadVersion:async id=>versions.get(id),
    patchLead:async({id,baseRowVersion,input})=>{
      patches.push(id);
      if(versions.get(id)!==baseRowVersion)return {status:409};
      const lead=leads.find(l=>l.id===id);
      Object.assign(lead,input);
      versions.set(id,baseRowVersion+1);
      return {status:200};
    },
    onAudit:async x=>audits.push(x),onAlert:async x=>alerts.push(x)
  });
  await assert.rejects(erase.erase({telegramUserId:'777',
    principal:{id:'attacker'}}),/forbidden/);
  assert.deepEqual(patches,[]);
  const result=await erase.erase({telegramUserId:'777',
    principal:{id:'operator-iam'}});
  assert.deepEqual(result,{status:'complete',scrubbed:2,adsDeletedEvents:9});
  assert.deepEqual(patches,['L-a','L-b']);
  assert.equal(leads[0].adsAttribution,null);
  assert.equal(leads[0].adsAttributionStatus,'erased');
  assert.equal(leads[0].model,'BMW');
  assert.equal(leads[0].budget,42000);
  assert.equal(leads[2].adsAttribution.source,'Telegram Ads');
  assert.equal(leads[3].adsAttributionStatus,undefined);
  assert.equal(leads[4].adsAttribution.source,'Telegram Ads');
  assert.equal(audits[0].outcome,'complete');
  assert.deepEqual(alerts,[]);
  assert.equal(erased,1);
});
test('CRM CAS failure never reports successful cross-store erasure',async()=>{
  const alerts=[],audit=[];
  const erase=createAdsCrmPrivacyErasure({
    privacyService:{eraseVerifiedTelegramUser:async()=>({status:'complete',deletedEvents:1})},
    readAuthoritativeState:async()=>({leads:[{id:'L1',clientProvider:'telegram',
      clientProviderUserId:'12',adsAttribution:{source:'Telegram Ads'}}]}),
    getLeadVersion:async()=>1,patchLead:async()=>({status:409}),maxPasses:2,
    onAudit:async x=>audit.push(x),onAlert:async x=>alerts.push(x)
  });
  await assert.rejects(erase.erase({telegramUserId:'12',
    principal:{id:'operator-iam'}}),/retry_exhausted/);
  assert.ok(alerts.some(x=>x.code==='ads_crm_erasure_retry_exhausted'));
  assert.equal(audit[0].outcome,'incomplete');
});

test('recoverable bridge keeps CRM lead creation safe during ads DB outage and reconnects',async()=>{
  let now=1000,attempts=0,alerts=[];
  const bridge=createAdsRecoverableBridge({
    now:()=>now,retryDelayMs:100,openDeadlineMs:500,
    onFailure:async e=>alerts.push(e),
    open:async()=>{
      attempts++;
      if(attempts===1)throw Error('staging_ads_unreachable');
      return {repository:{},close:async()=>{},
        report:async()=>[{campaignId:'A',leadSubmissions:1}],
        service:{
          recordBotStart:async()=>({status:'recorded'}),
          getAttribution:async()=>({
            firstTouch:{campaignId:'A',timestamp:'2026-10-27T00:00:00Z'},
            lastTouch:{campaignId:'A',timestamp:'2026-10-27T00:00:00Z'}
          }),
          recordTrustedEvent:async()=>({status:'recorded'}),
          recordTrustedSnapshotEvent:async()=>({status:'recorded'})
        }};
    }
  });
  const access={authenticated:true,authType:'telegram',role:'client',user:{id:'1212'}};
  const ops=[{resource:'lead',operation:'create',id:'L-reconnect',input:{
    clientSubmittedAt:'2026-10-27T00:00:00Z'
  }}];
  const lost=await bridge.enrichLeadOperations(ops,access);
  assert.equal(lost[0].input.adsAttributionStatus,'lookup_unavailable');
  await assert.rejects(bridge.recordBotStart({telegramUserId:'1212',
    startPayload:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',updateId:'1'}),/unavailable/);
  assert.equal(attempts,1);
  now+=101;
  const restored=await bridge.enrichLeadOperations(ops,access);
  assert.equal(restored[0].input.adsAttribution.lastTouch.campaignId,'A');
  assert.deepEqual(await bridge.report(),[{campaignId:'A',leadSubmissions:1}]);
  assert.equal(attempts,2);
  assert.equal(alerts[0].code,'ads_staging_connection_retry_pending');
  await bridge.close();
});
