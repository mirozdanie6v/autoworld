// Explicit isolated-YDB schema for managed Stage B maintenance coordination.
// Never call automatically from an API bootstrap or production deployment.
import {randomUUID} from 'node:crypto';
export async function ensureAdsOperationsSchema(sql,{target}={}){
  if(target!=='isolated-test-database'||typeof sql!=='function')
    throw new Error('ads_operations_schema_isolated_target_required');
  await sql`CREATE TABLE IF NOT EXISTS awg_ads_job_leases (
    job_id Utf8 NOT NULL,
    owner_id Utf8 NOT NULL,
    lease_until Utf8 NOT NULL,
    PRIMARY KEY (job_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS awg_ads_job_audit (
    record_id Utf8 NOT NULL,
    job_id Utf8 NOT NULL,
    status Utf8 NOT NULL,
    at Utf8 NOT NULL,
    PRIMARY KEY (record_id)
  )`;
}
const VALID_KIND=new Set(['reconciliation','retention']);
export function createAdsJobLeaseStore(sql){
  if(typeof sql?.begin!=='function')throw new Error('ads_job_store_transaction_required');
  return {
    async acquire({kind,owner,at,leaseUntil}={}){
      if(!VALID_KIND.has(kind)||!owner||!at||!leaseUntil
        ||!Number.isFinite(Date.parse(at))||!Number.isFinite(Date.parse(leaseUntil))
        ||leaseUntil<=at)throw new Error('ads_job_invalid_lease');
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [rows]=await tx`SELECT owner_id,lease_until FROM awg_ads_job_leases
          WHERE job_id=${kind}`;
        if(rows.length&&String(rows[0].lease_until)>at)return false;
        await tx`UPSERT INTO awg_ads_job_leases (job_id,owner_id,lease_until)
          VALUES (${kind},${owner},${leaseUntil})`;
        return true;
      });
    },
    async release({kind,owner}={}){
      if(!VALID_KIND.has(kind)||!owner)throw new Error('ads_job_invalid_release');
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [rows]=await tx`SELECT owner_id FROM awg_ads_job_leases WHERE job_id=${kind}`;
        if(!rows.length||String(rows[0].owner_id)!==owner)return false;
        await tx`DELETE FROM awg_ads_job_leases WHERE job_id=${kind}`;
        return true;
      });
    },
    async audit({kind,status,at}={}){
      if(!VALID_KIND.has(kind)||!['ok','incomplete','failed','skipped'].includes(status)
        ||!Number.isFinite(Date.parse(at)))throw new Error('ads_job_invalid_audit');
      const recordId=randomUUID();
      await sql`UPSERT INTO awg_ads_job_audit (record_id,job_id,status,at)
        VALUES (${recordId},${kind},${status},${at})`;
      return recordId;
    }
  };
}
// Called by an authenticated, dedicated scheduler/Cloud Function, NOT a
// request handler or process timer. No in-process scheduler is registered.
export function createAdsScheduledJobRunner({
  store,authorizeOperation,runReconciliation,runRetention,
  emitMetric,emitAlert,clock=()=>new Date(),leaseMinutes=20
}={}){
  if(typeof store?.acquire!=='function'||typeof store?.release!=='function'
    ||typeof store?.audit!=='function'
    ||![authorizeOperation,runReconciliation,runRetention,emitMetric,emitAlert]
       .every(x=>typeof x==='function')
    ||!Number.isInteger(leaseMinutes)||leaseMinutes<1||leaseMinutes>30)
    throw new Error('ads_scheduler_dependencies_required');
  return async function run({kind,principal}={}){
    if(!VALID_KIND.has(kind)||typeof principal?.id!=='string'
      ||await authorizeOperation({principal,permission:kind==='retention'?'ads:retention':'ads:reconcile'})!==true)
      throw new Error('ads_scheduled_job_forbidden');
    const started=clock();
    const time=started instanceof Date?started:new Date(started);
    if(!Number.isFinite(time.getTime()))throw new Error('ads_scheduler_invalid_clock');
    const owner=randomUUID(),at=time.toISOString();
    const acquired=await store.acquire({kind,owner,at,leaseUntil:new Date(
      time.getTime()+leaseMinutes*60000).toISOString()});
    if(!acquired){
      await emitMetric({name:'awg_ads_job_skipped_locked',kind,value:1});
      return {status:'skipped_locked'};
    }
    let status='failed';
    try{
      const result=kind==='retention'
        ?await runRetention({principal}):await runReconciliation({principal});
      const complete=kind==='retention'
        ?result?.status==='complete'
        :result?.complete===true&&Number.isInteger(result?.errors)&&result.errors===0;
      if(!complete){
        status='incomplete';
        throw new Error('ads_job_incomplete');
      }
      // Do not mark success until the observability sink acknowledged it.
      await emitMetric({name:'awg_ads_job_success',kind,value:1});
      status='ok';
      return {status:'ok',result};
    }catch(error){
      if(status!=='incomplete')status='failed';
      // A failed metrics sink must not swallow the primary job error.
      await Promise.allSettled([
        emitAlert({code:'awg_ads_scheduled_job_failed',kind,severity:'high'}),
        emitMetric({name:'awg_ads_job_failed',kind,value:1})
      ]);
      throw error;
    }finally{
      try{await store.audit({kind,status,at:new Date(clock()).toISOString()});}
      finally{await store.release({kind,owner});}
    }
  };
}
