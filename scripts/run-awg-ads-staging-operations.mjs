// Staging-only managed job entrypoint. NO production reads or writes.
// Invoked by an independently gated, short-lived GitHub Actions job.
// Both database identities must be externally verified and allowlisted.
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbAdsAttributionRepository} from '../server/ads-attribution-ydb.mjs';
import {createAdsAttributionService} from '../server/ads-attribution-core.mjs';
import {createAdsStageBBridge} from '../server/ads-attribution-stage-b.mjs';
import {createAdsJobLeaseStore,createAdsScheduledJobRunner} from '../server/ads-stage-b-scheduled-jobs.mjs';
import {createAdsPrivacyService} from '../server/ads-attribution-privacy.mjs';
import {createAdsLeadReconciliationJob,createPersistedLeadPageReader} from '../server/ads-stage-b-reconciliation.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {mutateAutoSaleEntityBatch} from '../server/ydb-entity-commands.mjs';

const jobKind=process.argv[2];
const JOBS=new Set(['reconciliation','retention']);
if(!JOBS.has(jobKind))throw new Error('ads_staging_job_kind_required');
const env=process.env;
function dbPath(connection){
  const url=new URL(connection);
  if(url.protocol!=='grpcs:'||url.hostname!=='ydb.serverless.yandexcloud.net'
    ||url.port!=='2135'||url.pathname!=='/'
    ||url.searchParams.size!==1)throw new Error('ads_staging_database_endpoint_invalid');
  const value=url.searchParams.get('database');
  if(!/^\/ru-central1\/[a-z0-9]+\/[a-z0-9]+$/.test(String(value)))
    throw new Error('ads_staging_database_path_invalid');
  return value;
}
export function validateManagedAdsStagingConfig(config){
  if(config.AWG_ADS_STAGE_B_MODE!=='isolated-staging'
    ||config.AWG_ADS_MANAGED_STAGING_ENABLED!=='true'
    ||config.AWG_ADS_STAGING_IAM_VERIFIED!=='true')
    throw new Error('ads_staging_operation_disabled');
  const adsPath=dbPath(config.AWG_ADS_STAGING_YDB_CONNECTION_STRING);
  const crmPath=dbPath(config.AWG_ADS_STAGING_CRM_YDB_CONNECTION_STRING);
  const mainPath=String(config.AWG_ADS_PRODUCTION_DB_PATH||'');
  if(!mainPath||!/^\/ru-central1\/[a-z0-9]+\/[a-z0-9]+$/.test(mainPath)
    ||new Set([adsPath,crmPath,mainPath]).size!==3)
    throw new Error('ads_staging_must_use_distinct_databases');
  const approved=String(config.AWG_ADS_STAGING_APPROVED_DATABASE_PATHS||'').split(',')
    .map(x=>x.trim()).filter(Boolean);
  if(approved.length!==2||new Set(approved).size!==2
    ||!approved.includes(adsPath)||!approved.includes(crmPath))
    throw new Error('ads_staging_database_not_allowlisted');
  if(typeof config.AWG_ADS_STAGE_B_SUBJECT_SECRET!=='string'
    ||config.AWG_ADS_STAGE_B_SUBJECT_SECRET.length<32
    ||!String(config.YDB_ACCESS_TOKEN_CREDENTIALS||''))
    throw new Error('ads_staging_credential_missing');
  if(!String(config.AWG_ADS_STAGING_SCHEDULER_PRINCIPAL||'').match(/^[A-Za-z0-9_.:@-]{3,128}$/))
    throw new Error('ads_staging_invalid_principal');
  return {adsPath,crmPath,principal:{id:config.AWG_ADS_STAGING_SCHEDULER_PRINCIPAL}};
}

const {principal}=validateManagedAdsStagingConfig(env);
if(jobKind==='retention'&&env.AWG_ADS_STAGING_RETENTION_APPROVED!=='true')
  throw new Error('ads_staging_retention_approval_required');

const creds=new AccessTokenCredentialsProvider({token:env.YDB_ACCESS_TOKEN_CREDENTIALS});
const adsDriver=new Driver(env.AWG_ADS_STAGING_YDB_CONNECTION_STRING,{credentialsProvider:creds});
let domainStore=null,legacyStore=null;
const event=(level,code,payload={})=>{
  const allowed={};
  for(const [key,value] of Object.entries(payload)){
    if(['kind','value','scanned','errors','batches','complete','status','recovered'].includes(key)
      &&(typeof value==='string'||typeof value==='number'||typeof value==='boolean'))
      allowed[key]=value;
  }
  console[level]('AWG_ADS_STAGING_JOB',JSON.stringify({code,...allowed}));
};
try{
  await adsDriver.ready();
  const sql=query(adsDriver);
  // Schema creation is intentionally forbidden in the maintenance runner.
  // Provisioning/migrations are a separate reviewed operation.
  const repo=createYdbAdsAttributionRepository(sql);
  const service=createAdsAttributionService({
    repository:repo,subjectSecret:env.AWG_ADS_STAGE_B_SUBJECT_SECRET
  });
  const bridge=createAdsStageBBridge({enabled:true,service,
    onFailure:async row=>event('warn',row.code||'receipt_warning')
  });
  const authorizeOperation=async({permission,principal:actor})=>
    actor?.id===principal.id
    &&['ads:reconcile','ads:retention'].includes(permission);
  const runRetention=async({principal:actor})=>{
    const privacy=createAdsPrivacyService({
      repository:repo,subjectSecrets:[env.AWG_ADS_STAGE_B_SUBJECT_SECRET],
      authorizeOperation,onAudit:async outcome=>event('info','retention_audit',{
        batches:outcome.batches||0,status:outcome.outcome
      })
    });
    return privacy.runRetentionCycle({principal:actor});
  };
  const runReconciliation=async()=> {
    const stagedCrm=env.AWG_ADS_STAGING_CRM_YDB_CONNECTION_STRING;
    domainStore=await createYdbDomainStore({
      connectionString:stagedCrm,credentialsProvider:creds,ensureSchema:false
    });
    legacyStore=await createYdbStateStore({
      connectionString:stagedCrm,credentialsProvider:creds,
      ensureSchema:false,domainDualWrite:false
    });
    const job=createAdsLeadReconciliationJob({
      bridge,
      listCommittedLeads:createPersistedLeadPageReader({
        readAuthoritativeState:()=>domainStore.loadState()
      }),
      persistRecoveredSnapshot:async(prior,snapshot)=>{
        const state=await domainStore.loadState();
        const current=(state.leads||[]).find(x=>String(x.id)===String(prior.id));
        if(!current||current.clientProvider!=='telegram'
          ||current.clientProviderUserId!==prior.clientProviderUserId
          ||current.clientSubmittedAt!==prior.clientSubmittedAt)return {ok:false};
        if(current.adsAttribution?.source==='Telegram Ads')
          return {ok:JSON.stringify(current.adsAttribution)===JSON.stringify(snapshot)};
        if(current.adsAttributionStatus!=='lookup_unavailable')return {ok:false};
        const version=await domainStore.entityRowVersion('lead',String(prior.id));
        if(version===null)return {ok:false};
        const result=await mutateAutoSaleEntityBatch({
          legacyStore,domainStore,
          operations:[{resource:'lead',operation:'patch',id:String(prior.id),
            baseRowVersion:version,
            input:{adsAttribution:snapshot,adsAttributionStatus:'recovered'}}],
          prepareNotifications:null
        });
        return {ok:result.status===200};
      },
      onAudit:async result=>event('info','reconciliation_audit',result),
      onAlert:async warning=>event('error',warning.code||'reconciliation_alert')
    });
    return job.run({authorized:true});
  };
  const jobRunner=createAdsScheduledJobRunner({
    store:createAdsJobLeaseStore(sql),authorizeOperation,
    runReconciliation,runRetention,
    emitMetric:async metric=>event('info',metric.name,metric),
    emitAlert:async alert=>event('error',alert.code,alert)
  });
  const result=await jobRunner({kind:jobKind,principal});
  event('info','job_complete',{kind:jobKind,status:result.status});
}catch(error){
  event('error','job_failed',{kind:jobKind});
  throw new Error('ads_staging_job_failed'); // no credentials/PII in exception
}finally{
  await Promise.allSettled([legacyStore?.close(),domainStore?.close(),adsDriver.close()]);
}
