// Scheduler-neutral, observable entry point. Does not start a timer or
// connect to YDB by itself; the authorized host supplies the scheduler and IAM.
export function createAdsMaintenanceJob({
  privacyService,emitMetric,emitAlert,clock=()=>Date.now()
}={}){
  if(!privacyService||typeof privacyService.runRetentionCycle!=='function')
    throw new Error('ads_maintenance_privacy_required');
  if(typeof emitMetric!=='function'||typeof emitAlert!=='function')
    throw new Error('ads_maintenance_observability_required');
  return async function run({principal}={}){
    const started=Number(clock());
    if(!Number.isFinite(started))throw new Error('invalid_ads_maintenance_clock');
    try{
      const result=await privacyService.runRetentionCycle({principal});
      await emitMetric({name:'awg_ads_retention_batches',value:result.batches});
      await emitMetric({name:'awg_ads_retention_deleted_events',value:result.deletedEvents});
      await emitMetric({name:'awg_ads_retention_deleted_subjects',value:result.deletedSubjects});
      await emitMetric({name:'awg_ads_retention_duration_ms',value:Math.max(0,Number(clock())-started)});
      if(result.status!=='complete'){
        await emitMetric({name:'awg_ads_retention_incomplete',value:1});
        await emitAlert({code:'awg_ads_retention_incomplete',severity:'high'});
        throw new Error('ads_retention_incomplete');
      }
      await emitMetric({name:'awg_ads_retention_success',value:1});
      return result;
    }catch(error){
      await emitMetric({name:'awg_ads_retention_failure',value:1});
      if(error?.message!=='ads_retention_incomplete'){
        await emitAlert({code:'awg_ads_retention_failed',severity:'high'});
      }
      throw error;
    }
  };
}

/**
 * Register daily execution with a trusted host scheduler. Stage A does not
 * create cloud jobs, credentials, network listeners or production cron tasks.
 * Scheduler must guarantee one registered job per deployment and supply its
 * own signed/verified principal for authorization.
 */
export function registerAdsDailyRetention({
  scheduler,runMaintenance,principal,cron='0 3 * * *',timeZone='UTC'
}={}){
  if(!scheduler||typeof scheduler.register!=='function'
    ||typeof runMaintenance!=='function'||cron!=='0 3 * * *'||timeZone!=='UTC'
    ||!principal||typeof principal.id!=='string')throw new Error('invalid_ads_retention_scheduler');
  return scheduler.register({
    id:'awg-ads-retention-daily',
    cron,timeZone,
    maxConcurrent:1
  },()=>runMaintenance({principal}));
}
