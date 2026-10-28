// One-time managed staging maintenance acceptance; no production connection.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbAdsAttributionRepository} from '../server/ads-attribution-ydb.mjs';
import {createAdsSubjectKey} from '../server/ads-attribution-core.mjs';
const ads='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnseoqfsf7ojn52813t';
const crm='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnvd9hmimkt74vpuqa6';
assert.equal(process.env.AWG_ADS_MANAGED_ACCEPTANCE_APPROVED,'reviewed-two-staging-databases');
assert.equal(process.env.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING,ads);
assert.equal(process.env.YDB_CONNECTION_STRING,crm);
const secret=randomBytes(32).toString('hex'),suffix=randomUUID();
const credentialsProvider=new AccessTokenCredentialsProvider({token:process.env.YDB_ACCESS_TOKEN_CREDENTIALS});
const driver=new Driver(ads,{credentialsProvider});
const report={productionConnections:0,productionWrites:0,physicalTelegramVk:false};
async function run(kind){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['scripts/run-awg-ads-staging-operations.mjs',kind],{stdio:'inherit',env:{
      ...process.env,AWG_ADS_MANAGED_STAGING_ENABLED:'true',AWG_ADS_STAGE_B_MODE:'isolated-staging',
      AWG_ADS_STAGING_IAM_VERIFIED:'true',AWG_ADS_STAGING_YDB_CONNECTION_STRING:ads,
      AWG_ADS_STAGING_CRM_YDB_CONNECTION_STRING:crm,
      AWG_ADS_PRODUCTION_DB_PATH:'/ru-central1/b1ggsmuiq7tb2d27f89q/etn00ojk5iv1u7dgpdar',
      AWG_ADS_STAGING_APPROVED_DATABASE_PATHS:[ads,crm].map(x=>new URL(x).searchParams.get('database')).join(','),
      AWG_ADS_STAGING_SCHEDULER_PRINCIPAL:'aje3j5aat66lel86cd5r',
      AWG_ADS_STAGING_RETENTION_APPROVED:'true',AWG_ADS_STAGE_B_SUBJECT_SECRET:secret
    }});
    child.once('error',reject);child.once('exit',resolve);
  });
}
try{
  await driver.ready();
  const sql=query(driver),repository=createYdbAdsAttributionRepository(sql);
  const subjectKey=createAdsSubjectKey('999000000001',secret),eventId='QA-EXPIRED-'+suffix;
  const currentKey=createAdsSubjectKey('999000000002',secret),currentEvent='QA-CURRENT-'+suffix;
  const old=new Date(Date.now()-120*86400000).toISOString(),now=new Date().toISOString();
  await repository.recordTouch({eventId,subjectKey,touch:{campaignId:'QA-RETENTION-'+suffix,adId:'',creativeId:'',timestamp:old}});
  await repository.recordTouch({eventId:currentEvent,subjectKey:currentKey,touch:{campaignId:'QA-RETENTION-'+suffix,adId:'',creativeId:'',timestamp:now}});
  assert.ok(await repository.readSubject(subjectKey));
  assert.ok(await repository.readSubject(currentKey));
  console.log('AWG_RETENTION_FIXTURES_PERSISTED');
  const started=new Date().toISOString();
  report.reconciliationExit=await run('reconciliation');
  report.retentionExit=await run('retention');
  assert.equal(report.retentionExit,0,'retention must complete');
  assert.equal(await repository.readSubject(subjectKey),null,'expired subject deleted');
  assert.ok(await repository.readSubject(currentKey),'current subject preserved');
  const events=(await repository.listEvents({limit:1000})).events;
  assert.equal(events.some(x=>x.eventId===eventId),false,'expired event deleted');
  assert.equal(events.some(x=>x.eventId===currentEvent),true,'current event preserved');
  const [audit]=await sql`SELECT job_id,status,at FROM awg_ads_job_audit`.isolation('snapshotReadOnly');
  report.currentAudit=audit.filter(x=>String(x.at)>=started).map(x=>({kind:String(x.job_id),status:String(x.status)}));
  assert.ok(report.currentAudit.some(x=>x.kind==='retention'&&x.status==='ok'));
  assert.ok(report.currentAudit.some(x=>x.kind==='reconciliation'&&x.status===(report.reconciliationExit===0?'ok':'failed')));
  const [leases]=await sql`SELECT job_id FROM awg_ads_job_leases`.isolation('snapshotReadOnly');
  assert.equal(leases.length,0);
  report.retentionFixtureVerified=true;report.leasesReleased=true;
  console.log('AWG_STAGING_MAINTENANCE_RESULT',JSON.stringify(report));
  process.exitCode=report.reconciliationExit===0?0:1;
}finally{await driver.close();}
