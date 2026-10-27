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
}finally{
  await driver.close();
}
