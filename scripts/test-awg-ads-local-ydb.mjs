import assert from 'node:assert/strict';
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {AnonymousCredentialsProvider} from '@ydbjs/auth/anonymous';
import {createAdsAttributionService,hashAdsToken} from '../server/ads-attribution-core.mjs';
import {createYdbAdsAttributionRepository,ensureAdsAttributionSchema} from '../server/ads-attribution-ydb.mjs';
import {summarizeAdsCampaignsFromRepository} from '../server/ads-attribution-report.mjs';
import {createAdsPrivacyService} from '../server/ads-attribution-privacy.mjs';

// Strictly localhost-only. Never pass a connection string from the project's cloud environment.
const connection='grpc://localhost:2136/local';
if(process.env.AWG_ADS_LOCAL_YDB_TEST!=='yes')throw new Error('local_ydb_test_opt_in_required');
if(process.env.YDB_CONNECTION_STRING||process.env.YDB_ACCESS_TOKEN_CREDENTIALS){
  throw new Error('production_ydb_environment_forbidden');
}
const phase=process.argv[2]||'run';
const driver=new Driver(connection,{credentialsProvider:new AnonymousCredentialsProvider()});
await driver.ready();
const sql=query(driver);
const repository=createYdbAdsAttributionRepository(sql);
const subjectSecret='test-secret-only-for-local-ydb-attribution-rotate-example';
const service=createAdsAttributionService({repository,subjectSecret,clock:()=>new Date('2026-10-26T12:00:00.000Z')});
const tokenFile='.diagnostics/awg-ads-local-ydb-fixture.json';
const fs=await import('node:fs/promises');

try {
  if(phase==='run'){
    await ensureAdsAttributionSchema(sql,{target:'isolated-test-database'});
    const a=await service.issueCampaign({campaignId:'real-ydb-A'});
    const b=await service.issueCampaign({campaignId:'real-ydb-B'});
    assert.deepEqual(await service.recordBotStart({telegramUserId:111,startPayload:a.token,updateId:9876001}),{status:'recorded',campaignId:'real-ydb-A'});
    assert.deepEqual(await service.recordBotStart({telegramUserId:111,startPayload:a.token,updateId:9876001}),{status:'duplicate'});
    assert.equal((await service.recordBotStart({telegramUserId:111,startPayload:b.token,updateId:9876002})).status,'recorded');
    assert.equal((await service.getAttribution({telegramUserId:111})).firstTouch.campaignId,'real-ydb-A');
    assert.equal((await service.getAttribution({telegramUserId:111})).lastTouch.campaignId,'real-ydb-B');
    assert.equal((await service.recordTrustedEvent({telegramUserId:111,eventType:'lead_submit',eventId:'lead-001'})).status,'recorded');
    assert.deepEqual(await service.recordTrustedEvent({telegramUserId:111,eventType:'lead_submit',eventId:'lead-001'}),{status:'duplicate'});
    assert.deepEqual(await service.setCampaignTokenActive({tokenHash:hashAdsToken(b.token),active:false}),{updated:true});
    assert.equal((await service.recordBotStart({telegramUserId:222,startPayload:b.token,updateId:9876003})).status,'ignored');

    // Concurrency on independent subjects, each distinct update ID.
    const tasks=Array.from({length:8},(_,i)=>async()=>{
      for(let attempt=0;attempt<5;attempt++){
        try{return await service.recordBotStart({telegramUserId:3000+i,startPayload:a.token,updateId:9877000+i});}
        catch(error){if(attempt===4)throw error;await new Promise(resolve=>setTimeout(resolve,50*(attempt+1))); }
      }
    });
    const done=await Promise.all(tasks.map(task=>task()));
    assert.equal(done.filter(r=>r.status==='recorded').length,8);

    const report=await summarizeAdsCampaignsFromRepository({repository,pageSize:3,maxPages:10});
    assert.equal(report.find(r=>r.campaignId==='real-ydb-A').botStarts,9);
    assert.equal(report.find(r=>r.campaignId==='real-ydb-B').botStarts,1);
    assert.equal(report.find(r=>r.campaignId==='real-ydb-B').leadSubmissions,1);
    assert.equal(report.find(r=>r.campaignId==='real-ydb-B').paidClicks,null);
    await fs.mkdir('.diagnostics',{recursive:true});
    await fs.writeFile(tokenFile,JSON.stringify({a:a.token,b:b.token}),'utf8');
    console.log('AWG_ADS_REAL_LOCAL_YDB_WRITE_PASS',JSON.stringify({campaigns:2,botStarts:10,leads:1}));
  }else if(phase==='reconnect'){
    const fixture=JSON.parse(await fs.readFile(tokenFile,'utf8'));
    assert.equal((await service.getAttribution({telegramUserId:111})).lastTouch.campaignId,'real-ydb-B');
    assert.equal((await service.recordBotStart({telegramUserId:111,startPayload:fixture.a,updateId:9876001})).status,'duplicate');
    const report=await summarizeAdsCampaignsFromRepository({repository,pageSize:4,maxPages:10});
    assert.equal(report.find(r=>r.campaignId==='real-ydb-A').botStarts,9);
    assert.equal(report.find(r=>r.campaignId==='real-ydb-B').leadSubmissions,1);
    console.log('AWG_ADS_REAL_LOCAL_YDB_RECONNECT_PASS');
  }else if(phase==='privacy'){
    // Explicit identity verified by the test; no real users/data involved.
    const privacy=createAdsPrivacyService({
      repository,subjectSecrets:[subjectSecret],
      clock:()=>new Date('2027-03-01T12:00:00Z')
    });
    const removed=await privacy.eraseVerifiedTelegramUser({telegramUserId:111,authorized:true});
    assert.equal(removed.deletedSubjects,1);
    assert.equal(removed.deletedEvents,3);
    assert.equal(await service.getAttribution({telegramUserId:111}),null);
    assert.equal((await summarizeAdsCampaignsFromRepository({repository})).find(r=>r.campaignId==='real-ydb-B'),undefined);
    // All synthetic events are older than 90 days at the maintenance clock.
    let cursor='';
    let deletedEvents=0,deletedSubjects=0,compactedSubjects=0;
    for(let i=0;i<20;i++){
      const result=await privacy.runRetentionSweep({authorized:true,cursor});
      deletedEvents+=result.deletedEvents;
      deletedSubjects+=result.deletedSubjects;
      compactedSubjects+=result.compactedSubjects;
      if(!result.nextCursor&&!result.hasMoreEvents)break;
      cursor=result.nextCursor||'';
      if(i===19)throw new Error('retention_did_not_converge');
    }
    const report=await summarizeAdsCampaignsFromRepository({repository});
    assert.equal(report.length,0);
    assert.equal((await repository.readSubject('f'.repeat(64))),null);
    assert.ok(deletedEvents>=8);
    console.log('AWG_ADS_REAL_LOCAL_YDB_PRIVACY_PASS',JSON.stringify({deletedEvents,deletedSubjects,compactedSubjects}));
  }else throw new Error('unknown_test_phase');
}finally{await driver.close();}
