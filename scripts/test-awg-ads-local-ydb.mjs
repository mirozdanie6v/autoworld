import assert from 'node:assert/strict';
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {AnonymousCredentialsProvider} from '@ydbjs/auth/anonymous';
import {createAdsAttributionService,hashAdsToken,createAdsSubjectKey} from '../server/ads-attribution-core.mjs';
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
const principal={id:'local-ydb-maintenance-test'};
const authorizeOperation=async ({permission,principal:p})=>p.id===principal.id
  &&(permission==='ads:erase'||permission==='ads:retention');
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
      repository,subjectSecrets:[subjectSecret],authorizeOperation,onAudit:async()=>{},
      clock:()=>new Date('2027-03-01T12:00:00Z')
    });
    const removed=await privacy.eraseVerifiedTelegramUser({telegramUserId:111,principal});
    assert.equal(removed.status,'complete');
    assert.equal(removed.deletedSubjects,1);
    assert.equal(removed.deletedEvents,3);
    assert.equal((await repository.listBotTouchesAt({
      subjectKey:createAdsSubjectKey(111,subjectSecret),
      asOf:'2027-03-01T12:00:00Z'
    })).length,0,'erasure must also remove historic indexed campaign touches');
    assert.equal(await service.getAttribution({telegramUserId:111}),null);
    const replay=(await fs.readFile(tokenFile,'utf8'));
    assert.equal((await service.recordBotStart({
      telegramUserId:111,startPayload:JSON.parse(replay).a,updateId:9876001
    })).reason,'erased_subject');
    assert.equal((await summarizeAdsCampaignsFromRepository({repository})).find(r=>r.campaignId==='real-ydb-B'),undefined);
    // All synthetic events are older than 90 days at the maintenance clock.
    let cursor='';
    let deletedEvents=0,deletedSubjects=0,compactedSubjects=0;
    for(let i=0;i<20;i++){
      const result=await privacy.runRetentionSweep({principal,cursor});
      deletedEvents+=result.deletedEvents;
      deletedSubjects+=result.deletedSubjects;
      compactedSubjects+=result.compactedSubjects;
      if(!result.nextCursor&&!result.hasMoreEvents)break;
      cursor=result.nextCursor||'';
      if(i===19)throw new Error('retention_did_not_converge');
    }
    const report=await summarizeAdsCampaignsFromRepository({repository});
    assert.equal(report.length,0);
    assert.equal((await repository.listBotTouchesAt({
      subjectKey:createAdsSubjectKey(3000,subjectSecret),
      asOf:'2027-03-01T12:00:00Z'
    })).length,0,'retention must not leave advertising history in auxiliary index');
    assert.equal((await repository.readSubject('f'.repeat(64))),null);
    assert.ok(deletedEvents>=8);
    console.log('AWG_ADS_REAL_LOCAL_YDB_PRIVACY_PASS',JSON.stringify({deletedEvents,deletedSubjects,compactedSubjects}));
  }else if(phase==='load'){
    const fixture=JSON.parse(await fs.readFile(tokenFile,'utf8'));
    const raceUser=7777777;
    const commonStart=9879000;
    await service.recordBotStart({telegramUserId:raceUser,startPayload:fixture.a,updateId:commonStart});
    const parallel=20;
    const jobs=Array.from({length:parallel},(_,i)=>async()=>{
      for(let retry=0;retry<12;retry++){
        try{
          return await service.recordBotStart({
            telegramUserId:raceUser,startPayload:fixture.a,updateId:commonStart+i+1
          });
        }catch(error){
          if(retry===11)throw error;
          await new Promise(resolve=>setTimeout(resolve,20*(retry+1)));
        }
      }
    });
    const settled=await Promise.all(jobs.map(job=>job()));
    assert.equal(settled.filter(item=>item.status==='recorded').length,parallel);
    assert.equal((await service.getAttribution({telegramUserId:raceUser})).firstTouch.campaignId,'real-ydb-A');
    const large=await service.issueCampaign({campaignId:'erasure-load'});
    const heavyUser=8888888;
    await service.recordBotStart({telegramUserId:heavyUser,startPayload:large.token,updateId:9890000});
    // Controlled parallel batches simulate the intake rate without sending
    // >1,000 sequential network round-trips. Distinct receipt IDs remain stable.
    for(let offset=0;offset<1010;offset+=12){
      const count=Math.min(12,1010-offset);
      const results=await Promise.all(Array.from({length:count},async (_,i)=>{
        const eventId='heavy_'+(offset+i);
        for(let attempt=0;attempt<7;attempt++){
          try{return await service.recordTrustedEvent({
            telegramUserId:heavyUser,eventType:'vehicle_view',eventId
          });}catch(error){
            if(attempt===6)throw error;
            await new Promise(resolve=>setTimeout(resolve,30*(attempt+1)));
          }
        }
      }));
      if(results.some(x=>x.status!=='recorded'))throw new Error('large_event_write_failed');
    }
    const audits=[];
    const privacy=createAdsPrivacyService({
      repository,subjectSecrets:[subjectSecret],authorizeOperation,
      onAudit:async record=>audits.push(record),
      clock:()=>new Date('2026-10-26T12:00:00Z')
    });
    const start=Date.now();
    const erased=await privacy.eraseVerifiedTelegramUser({telegramUserId:heavyUser,principal});
    const durationMs=Date.now()-start;
    assert.equal(erased.status,'complete');
    assert.equal(erased.deletedEvents,1011);
    assert.ok(erased.batches>10);
    assert.equal((await service.recordBotStart({
      telegramUserId:heavyUser,startPayload:large.token,updateId:9890000
    })).reason,'erased_subject');
    assert.equal((await service.recordBotStart({
      telegramUserId:heavyUser,startPayload:large.token,updateId:9899999
    })).reason,'erased_subject');
    assert.equal(audits.at(-1).outcome,'success');
    // Concurrent ingestion and erasure must not recreate a subject or receipt.
    const deletionUser=999777;
    await service.recordBotStart({telegramUserId:deletionUser,startPayload:large.token,updateId:9899900});
    const raceWrites=Array.from({length:24},(_,i)=>service.recordTrustedEvent({
      telegramUserId:deletionUser,eventType:'vehicle_view',eventId:'delete_race_'+i
    }));
    const deleteRace=async()=>{
      for(let i=0;i<12;i++){
        try{return await privacy.eraseVerifiedTelegramUser({telegramUserId:deletionUser,principal});}
        catch(error){
          if(i===11)throw error;
          await new Promise(resolve=>setTimeout(resolve,50*(i+1)));
        }
      }
    };
    const deletionResults=await Promise.allSettled([deleteRace(),...raceWrites]);
    if(deletionResults[0].status!=='fulfilled'||deletionResults[0].value.status!=='complete')
      throw new Error('ads_concurrent_erasure_failed');
    const erasedSubjectKey=createAdsSubjectKey(deletionUser,subjectSecret);
    let remaining=0,cursor='';
    for(let i=0;i<20;i++){
      const page=await repository.listEvents({cursor,limit:250});
      remaining+=page.events.filter(event=>event.subjectKey===erasedSubjectKey).length;
      if(page.nextCursor===null)break;
      cursor=page.nextCursor;
    }
    assert.equal(remaining,0,'new data must not reappear after concurrent erasure');
    assert.equal(await service.getAttribution({telegramUserId:deletionUser}),null);
    assert.equal((await service.recordBotStart({
      telegramUserId:deletionUser,startPayload:large.token,updateId:9899900
    })).reason,'erased_subject');
    console.log('AWG_ADS_REAL_LOCAL_YDB_DELETE_RACE_PASS',
      JSON.stringify({concurrentWriters:raceWrites.length,remainingReceipts:remaining}));
    console.log('AWG_ADS_REAL_LOCAL_YDB_LOAD_PASS',
      JSON.stringify({sameSubjectConcurrentStarts:parallel,largeSubjectEventsDeleted:erased.deletedEvents,
        eraseBatches:erased.batches,eraseDurationMs:durationMs}));
  }else throw new Error('unknown_test_phase');
}finally{await driver.close();}
