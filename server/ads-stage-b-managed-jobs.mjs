// Staging-only invocation boundary for externally managed periodic work.
// No internal setInterval and no automatic route: an authenticated cloud job
// must provide a verified service principal. Persistent lease is in ADS YDB.
import {randomBytes} from 'node:crypto';

const JOBS={
  'awg-ads-reconcile':'*/15 * * * *',
  'awg-ads-retention':'0 3 * * *'
};
export function createAdsManagedJobRunner({
  env,leases,authorizeServiceIdentity,reconcile,retention,
  emitMetric,emitAlert,now=()=>new Date()
}={}){
  if(env?.AWG_ADS_STAGE_B_ENABLED!=='true'
    ||env.AWG_ADS_STAGE_B_MODE!=='isolated-staging'
    ||env.AWG_ADS_MANAGED_JOBS_ENABLED!=='true'
    ||!env.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING
    ||!env.YDB_CONNECTION_STRING
    ||env.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING===env.YDB_CONNECTION_STRING)
    throw new Error('ads_managed_jobs_staging_gate_required');
  if(typeof leases?.acquire!=='function'||typeof leases.complete!=='function'
    ||typeof authorizeServiceIdentity!=='function'
    ||typeof reconcile!=='function'||typeof retention!=='function'
    ||typeof emitMetric!=='function'||typeof emitAlert!=='function')
    throw new Error('ads_managed_jobs_dependencies_required');

  const run=async({jobId,principal}={})=>{
    if(!Object.prototype.hasOwnProperty.call(JOBS,jobId))
      throw new Error('ads_managed_job_unknown');
    // A caller claiming "authorized" is insufficient. IAM-bound identity
    // must be checked by the external runtime against a scoped service account.
    if(await authorizeServiceIdentity({principal,jobId})!==true)
      throw new Error('ads_managed_job_unauthorized');
    const instant=now();
    if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))
      throw new Error('ads_managed_job_invalid_clock');
    const ownerId=randomBytes(16).toString('hex');
    const acquired=await leases.acquire({
      jobId,ownerId,now:instant.toISOString(),
      leaseUntil:new Date(instant.getTime()+15*60_000).toISOString()
    });
    if(!acquired?.acquired){
      await emitMetric({name:'awg_ads_managed_skipped_lease',value:1,jobId});
      return {status:'already_running'};
    }
    if(acquired.expiredOwnerReplaced)
      await emitAlert({code:'ads_managed_expired_lease_reclaimed',jobId,severity:'high'});
    let outcome=null,error=null;
    try{
      outcome=await (jobId==='awg-ads-reconcile'?reconcile:retention)({principal});
      if(outcome?.status==='incomplete'||outcome?.complete===false||Number(outcome?.errors)>0)
        throw new Error('ads_managed_job_incomplete');
      await emitMetric({name:'awg_ads_managed_success',value:1,jobId});
    }catch(e){
      error=e;
      await emitAlert({code:'ads_managed_job_failed',jobId,severity:'high'});
      await emitMetric({name:'awg_ads_managed_failure',value:1,jobId});
    }finally{
      try{
        await leases.complete({
          jobId,ownerId,status:error?'failure':'success',
          finishedAt:now().toISOString()
        });
      }catch(e){
        await emitAlert({code:'ads_managed_job_audit_persist_failed',
          jobId,severity:'critical'});
        if(!error)error=e;
      }
    }
    if(error)throw error;
    return {status:'complete',result:outcome};
  };
  return {run};
}
export function registerAdsExternallyManagedJobs({scheduler,runner,principal}={}){
  if(typeof scheduler?.register!=='function'||typeof runner?.run!=='function'||!principal)
    throw new Error('ads_managed_scheduler_missing');
  const registrations=[];
  for(const [jobId,cron] of Object.entries(JOBS)){
    registrations.push(scheduler.register({
      id:jobId,cron,timeZone:'UTC',maxConcurrent:1,
      maxRuntimeSeconds:600,retries:3
    },()=>runner.run({jobId,principal})));
  }
  return registrations;
}
