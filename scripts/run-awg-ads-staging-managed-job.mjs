// Explicit entry point for a separately deployed Yandex managed JOB container.
// It NEVER registers a public route, starts a cron inside AutoWorld, changes
// schema, uses production database, or delivers Telegram/VK notifications.
//
// Deployment prerequisites: two approved separate staging database IDs and
// dedicated least-privilege metadata IAM service account (NOT prod deploy SA).
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {MetadataCredentialsProvider} from '@ydbjs/auth/metadata';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {mutateAutoSaleEntityBatch} from '../server/ydb-entity-commands.mjs';
import {createYdbAdsAttributionRepository} from '../server/ads-attribution-ydb.mjs';
import {createAdsAttributionService} from '../server/ads-attribution-core.mjs';
import {createAdsStageBBridge} from '../server/ads-attribution-stage-b.mjs';
import {
  createAdsLeadReconciliationJob,createPersistedLeadPageReader
} from '../server/ads-stage-b-reconciliation.mjs';
import {createAdsPrivacyService} from '../server/ads-attribution-privacy.mjs';
import {createAdsMaintenanceJob} from '../server/ads-attribution-maintenance.mjs';
import {createYdbAdsManagedJobRepository} from '../server/ads-stage-b-job-ydb.mjs';
import {createAdsManagedJobRunner} from '../server/ads-stage-b-managed-jobs.mjs';

const env=process.env;
const reject=code=>{throw new Error(code)};
const idPattern=/^[a-z0-9]{20}$/;
const prodId='etn00ojk5iv1u7dgpdar'; // immutable known AWG production YDB denylist
function dbId(uri){
  try{
    const url=new URL(uri);
    const path=url.searchParams.get('database')||'';
    return path.split('/').at(-1);
  }catch{return '';}
}
const jobId=String(env.AWG_ADS_JOB_ID||'');
const adsUri=String(env.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING||'');
const crmUri=String(env.AWG_ADS_STAGE_B_CRM_YDB_CONNECTION_STRING||'');
const primaryUri=String(env.YDB_CONNECTION_STRING||'');
const approvedAds=String(env.AWG_ADS_APPROVED_STAGING_YDB_ID||'');
const approvedCrm=String(env.AWG_ADS_APPROVED_CRM_STAGING_YDB_ID||'');
if(!['awg-ads-reconcile','awg-ads-retention'].includes(jobId)
  ||env.AWG_ADS_STAGING_RESOURCES_VERIFIED!=='true'
  ||env.AWG_ADS_STAGE_B_MODE!=='isolated-staging'
  ||env.AWG_ADS_MANAGED_JOBS_ENABLED!=='true'
  ||env.AWG_ADS_STAGE_B_ENABLED!=='true'
  ||env.AWG_ADS_STAGE_B_RECONCILE_ENABLED==='true'
  ||!idPattern.test(approvedAds)||!idPattern.test(approvedCrm)
  ||dbId(adsUri)!==approvedAds||dbId(crmUri)!==approvedCrm
  ||approvedAds===approvedCrm||approvedAds===prodId||approvedCrm===prodId
  ||adsUri===crmUri||adsUri===primaryUri||crmUri===primaryUri
  ||!primaryUri||!adsUri.startsWith('grpcs://ydb.serverless.yandexcloud.net:2135/')
  ||!crmUri.startsWith('grpcs://ydb.serverless.yandexcloud.net:2135/'))
  reject('ads_managed_job_unverified_staging_isolation');
const subjectSecret=String(env.AWG_ADS_STAGE_B_SUBJECT_SECRET||'');
const iamPrincipalId=String(env.AWG_ADS_MANAGED_SERVICE_ACCOUNT_ID||'');
if(subjectSecret.length<32||!/^[a-z0-9]{20}$/.test(iamPrincipalId))
  reject('ads_managed_job_missing_secret_or_iam_binding');

const emitMetric=async metric=>console.info('AWG_ADS_METRIC',JSON.stringify(metric));
const emitAlert=async alert=>console.error('AWG_ADS_ALERT',JSON.stringify(alert));
const credentials=new MetadataCredentialsProvider();
let driver=null,legacyStore=null,domainStore=null;
try{
  driver=new Driver(adsUri,{credentialsProvider:credentials});
  await driver.ready();
  const sql=query(driver);
  const repository=createYdbAdsAttributionRepository(sql);
  const leaseRepository=createYdbAdsManagedJobRepository(sql);
  const service=createAdsAttributionService({repository,subjectSecret});
  const bridge=createAdsStageBBridge({enabled:true,service,
    onFailure:async failure=>emitAlert({code:failure.code,severity:'high'})});
  // Reconciliation is the only job that reads/writes staging CRM. Retention
  // still uses staging-only resource guards, but does not need CRM access.
  const connectCrm=async()=>{
    if(domainStore)return;
    legacyStore=await createYdbStateStore({
      connectionString:crmUri,credentialsProvider:credentials,ensureSchema:false});
    domainStore=await createYdbDomainStore({
      connectionString:crmUri,credentialsProvider:credentials,ensureSchema:false});
  };
  const readState=async()=>{await connectCrm();return domainStore.loadState();};
  const reconciliation=async({principal})=>{
    await connectCrm();
    const job=createAdsLeadReconciliationJob({
      listCommittedLeads:createPersistedLeadPageReader({
        readAuthoritativeState:readState}),
      bridge,persistRecoveredSnapshot:async(prior,snapshot)=>{
        const current=(await domainStore.loadState()).leads?.find(l=>l.id===prior.id);
        if(!current||current.clientProvider!=='telegram'
          ||current.clientProviderUserId!==prior.clientProviderUserId
          ||current.clientSubmittedAt!==prior.clientSubmittedAt)return {ok:false};
        if(current.adsAttribution?.source==='Telegram Ads')
          return {ok:JSON.stringify(current.adsAttribution)===JSON.stringify(snapshot)};
        if(current.adsAttributionStatus!=='lookup_unavailable')return {ok:false};
        const version=await domainStore.entityRowVersion('lead',prior.id);
        if(version===null)return {ok:false};
        const saved=await mutateAutoSaleEntityBatch({
          legacyStore,domainStore,prepareNotifications:null,
          operations:[{resource:'lead',operation:'patch',
            id:prior.id,baseRowVersion:version,
            input:{adsAttribution:snapshot,adsAttributionStatus:'recovered'}}]
        });
        return {ok:saved.status===200};
      },
      onAudit:async result=>emitMetric({
        name:'awg_ads_reconcile_scanned',value:result.scanned,
        complete:result.complete,errors:result.errors}),
      onAlert:emitAlert,
      pageSize:100,maxPages:1000
    });
    return job.run({authorized:true});
  };
  const privacy=createAdsPrivacyService({
    repository,subjectSecrets:[subjectSecret],
    authorizeOperation:async({principal,permission})=>
      principal?.id===iamPrincipalId&&permission==='ads:retention',
    onAudit:async row=>emitMetric({name:'awg_ads_retention_audit',
      value:row.outcome==='success'?1:0})
  });
  const retention=createAdsMaintenanceJob({privacyService:privacy,
    emitMetric,emitAlert});
  const runner=createAdsManagedJobRunner({
    env,leases:leaseRepository,
    authorizeServiceIdentity:async({principal})=>
      principal?.id===iamPrincipalId
      &&env.AWG_ADS_STAGING_RESOURCES_VERIFIED==='true',
    reconcile:reconciliation,retention,
    emitMetric,emitAlert
  });
  const summary=await runner.run({jobId,principal:{id:iamPrincipalId}});
  console.info('AWG_ADS_MANAGED_STAGING_COMPLETE',JSON.stringify({
    jobId,status:summary.status
  }));
}finally{
  await domainStore?.close();
  await legacyStore?.close();
  await driver?.close();
}
