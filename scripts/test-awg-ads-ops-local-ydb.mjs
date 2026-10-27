// Real disposable local YDB only: never use existing cloud identities or a prod DB.
// Proves durable job lease and GDPR-style multi-index deletion behavior.
import assert from 'node:assert/strict';
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {AnonymousCredentialsProvider} from '@ydbjs/auth/anonymous';
import {
  ensureAdsAttributionSchema,createYdbAdsAttributionRepository
} from '../server/ads-attribution-ydb.mjs';
import {createAdsAttributionService,createAdsSubjectKey} from '../server/ads-attribution-core.mjs';
import {
  ensureAdsManagedJobSchema,createYdbAdsManagedJobRepository
} from '../server/ads-stage-b-job-ydb.mjs';

import {createAdsPrivacyService} from '../server/ads-attribution-privacy.mjs';
import {createAdsCrmPrivacyErasure} from '../server/ads-stage-b-crm-privacy.mjs';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {legacyStateToDomainRows} from '../server/ydb-domain-migration.mjs';
import {mutateAutoSaleEntityBatch} from '../server/ydb-entity-commands.mjs';

if(process.env.AWG_ADS_LOCAL_YDB_TEST!=='yes'
  ||process.env.YDB_CONNECTION_STRING||process.env.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING
  ||process.env.YDB_ACCESS_TOKEN_CREDENTIALS)
  throw new Error('ads_ops_disposable_local_ydb_required');
const driver=new Driver('grpc://localhost:2136/local',{
  credentialsProvider:new AnonymousCredentialsProvider()
});
const secret='ads-ops-local-disposable-ydb-secret-2026-12345678';
try{
  await driver.ready();
  const sql=query(driver);
  await ensureAdsAttributionSchema(sql,{target:'isolated-test-database'});
  await ensureAdsManagedJobSchema(sql,{target:'isolated-test-database'});
  const locks=createYdbAdsManagedJobRepository(sql);
  const now='2026-10-27T00:00:00.000Z';
  const jobId='awg-ads-reconcile',ownerId='manager-lease-id-0001';
  const leaseUntil='2026-10-27T00:15:00.000Z';
  assert.equal((await locks.acquire({jobId,ownerId,now,leaseUntil})).acquired,true);
  assert.equal((await locks.acquire({jobId,ownerId:'manager-lease-id-0002',now,leaseUntil})).acquired,false);
  assert.equal((await locks.complete({jobId,ownerId,status:'success',
    finishedAt:'2026-10-27T00:01:00.000Z'})).completed,true);
  assert.equal((await locks.acquire({jobId,ownerId:'manager-lease-id-0003',
    now:'2026-10-27T00:02:00.000Z',leaseUntil})).acquired,true);
  await assert.rejects(locks.complete({jobId,ownerId:'manager-lease-id-0001',
    status:'failure',finishedAt:'2026-10-27T00:03:00.000Z'}),
    error=>/ads_managed_job_lease_lost/.test(String(error?.cause?.message||error?.message)));
  assert.equal((await locks.complete({jobId,ownerId:'manager-lease-id-0003',
    status:'failure',finishedAt:'2026-10-27T00:03:00.000Z'})).completed,true);
  console.log('AWG_ADS_OPS_PERSISTENT_JOB_LEASE_PASS');

  const repository=createYdbAdsAttributionRepository(sql);
  let time='2026-10-23T10:00:00.000Z';
  const service=createAdsAttributionService({repository,subjectSecret:secret,
    clock:()=>new Date(time)});
  const token=(await service.issueCampaign({campaignId:'ops-retention-campaign'})).token;
  await service.recordBotStart({telegramUserId:777777,startPayload:token,updateId:777001});
  const subjectKey=createAdsSubjectKey('777777',secret);
  assert.equal((await repository.listBotTouchesAt({subjectKey,
    asOf:'2026-10-27T00:00:00.000Z'})).length,1);
  const result=await repository.purgeExpired({
    eventCutoff:'2026-10-26T00:00:00.000Z',
    subjectCutoff:'2026-10-26T00:00:00.000Z',
    batchSize:20
  });
  assert.equal(result.deletedEvents,1);
  assert.equal((await repository.listBotTouchesAt({subjectKey,
    asOf:'2026-10-27T00:00:00.000Z'})).length,0);
  assert.equal((await repository.listEvents({limit:10})).events.length,0);
  console.log('AWG_ADS_OPS_RETENTION_HISTORY_PURGED_PASS');

  time='2026-10-27T01:00:00.000Z';
  await service.recordBotStart({telegramUserId:888888,startPayload:token,updateId:888001});
  const toErase=createAdsSubjectKey('888888',secret);
  assert.equal((await repository.listBotTouchesAt({subjectKey:toErase,asOf:time})).length,1);
  const erased=await repository.eraseSubjects({subjectKeys:[toErase],batchSize:10});
  assert.equal(erased.deletedEvents,1);
  assert.equal((await repository.listBotTouchesAt({subjectKey:toErase,asOf:time})).length,0);
  assert.equal((await repository.listEvents({limit:10})).events.length,0);
  assert.equal((await service.recordBotStart({telegramUserId:888888,
    startPayload:token,updateId:888002})).reason,'erased_subject');
  console.log('AWG_ADS_OPS_ERASURE_SUPPRESSION_ALL_INDEXES_PASS');

  // Actual normalized CRM YDB mutation and cross-store metadata erasure.
  // Only disposable localhost tables; no real user IDs or notifications.
  time='2026-10-27T02:00:00.000Z';
  const person='666666',ownedKey=createAdsSubjectKey(person,secret);
  assert.equal((await service.recordBotStart({
    telegramUserId:person,startPayload:token,updateId:666001
  })).status,'recorded');
  const originalAttribution=await service.getAttribution({telegramUserId:person});
  assert.ok(originalAttribution?.lastTouch?.campaignId);
  const connectionString='grpc://localhost:2136/local';
  const credential=new AnonymousCredentialsProvider();
  const legacyStore=await createYdbStateStore({
    connectionString,credentialsProvider:credential,ensureSchema:true,domainDualWrite:false
  });
  const domainStore=await createYdbDomainStore({
    connectionString,credentialsProvider:credential,ensureSchema:true
  });
  try{
    const base=await legacyStore.loadState();
    await domainStore.replaceSnapshot(legacyStateToDomainRows(base),{
      sourceRevision:base.revision,status:'initialized'
    });
    const leadId='L-ADS-OPS-PRIVACY-REAL-YDB';
    const written=await mutateAutoSaleEntityBatch({
      legacyStore,domainStore,prepareNotifications:null,
      operations:[{resource:'lead',operation:'create',id:leadId,input:{
        id:leadId,model:'Test Honda',budget:21300,status:'Новый',
        clientProvider:'telegram',clientProviderUserId:person,
        adsAttribution:{source:'Telegram Ads',...originalAttribution}
      }}]
    });
    assert.equal(written.status,200,JSON.stringify(written.data));
    const before=await domainStore.loadState();
    assert.equal(before.leads.find(x=>x.id===leadId).adsAttribution.lastTouch.campaignId,
      'ops-retention-campaign');
    const priv=createAdsPrivacyService({
      repository,subjectSecrets:[secret],
      authorizeOperation:async({principal,permission})=>
        principal?.id==='qa-verified-privacy-operator'&&permission==='ads:erase',
      onAudit:async()=>{}
    });
    const job=createAdsCrmPrivacyErasure({
      privacyService:priv,
      readAuthoritativeState:async()=>domainStore.loadState(),
      getLeadVersion:id=>domainStore.entityRowVersion('lead',id),
      patchLead:async({id,baseRowVersion,input})=>mutateAutoSaleEntityBatch({
        legacyStore,domainStore,prepareNotifications:null,
        operations:[{resource:'lead',operation:'patch',id,baseRowVersion,input}]
      }),
      onAudit:async()=>{},onAlert:async alert=>{throw Error(alert.code);}
    });
    await assert.rejects(job.erase({telegramUserId:person,
      principal:{id:'unauthorized'}}),/forbidden/);
    assert.ok((await domainStore.loadState()).leads.find(x=>x.id===leadId).adsAttribution);
    const completed=await job.erase({telegramUserId:person,
      principal:{id:'qa-verified-privacy-operator'}});
    assert.equal(completed.status,'complete');
    assert.equal(completed.scrubbed,1);
    const after=(await domainStore.loadState()).leads.find(x=>x.id===leadId);
    assert.equal(after.adsAttribution,null);
    assert.equal(after.adsAttributionStatus,'erased');
    assert.equal(after.model,'Test Honda');
    assert.equal(after.budget,21300);
    assert.equal(await repository.readSubject(ownedKey),null);
    assert.equal((await repository.listBotTouchesAt({subjectKey:ownedKey,asOf:time})).length,0);
    assert.equal((await service.recordBotStart({telegramUserId:person,
      startPayload:token,updateId:666002})).reason,'erased_subject');
    console.log('AWG_ADS_OPS_REAL_YDB_CRM_ERASURE_CAS_PASS');
  }finally{
    await Promise.allSettled([legacyStore.close(),domainStore.close()]);
  }

}finally{
  await driver.close();
}
