// Persistent, database-level lease and audit records for external managed jobs.
// All SQL is scoped to a separately reviewed advertisements database.
const JOBS=new Set(['awg-ads-reconcile','awg-ads-retention']);
const VALID_OWNER=/^[A-Za-z0-9_-]{12,80}$/;
export async function ensureAdsManagedJobSchema(sql,{target}={}){
  if(target!=='isolated-test-database'||typeof sql!=='function')
    throw new Error('ads_jobs_schema_requires_isolated_test_database');
  await sql`
    CREATE TABLE IF NOT EXISTS awg_ads_job_leases (
      job_id Utf8 NOT NULL,
      owner_id Utf8 NOT NULL,
      lease_until Utf8 NOT NULL,
      acquired_at Utf8 NOT NULL,
      PRIMARY KEY (job_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS awg_ads_job_runs (
      job_id Utf8 NOT NULL,
      owner_id Utf8 NOT NULL,
      status Utf8 NOT NULL,
      started_at Utf8 NOT NULL,
      finished_at Utf8 NOT NULL,
      PRIMARY KEY (job_id,owner_id)
    )
  `;
}
export function createYdbAdsManagedJobRepository(sql){
  if(typeof sql!=='function'||typeof sql.begin!=='function')
    throw new Error('ads_jobs_transactional_sql_required');
  const validate=(jobId,ownerId)=>{
    if(!JOBS.has(jobId)||!VALID_OWNER.test(String(ownerId||'')))
      throw new Error('invalid_ads_managed_job_identity');
  };
  return {
    async acquire({jobId,ownerId,now,leaseUntil}={}){
      validate(jobId,ownerId);
      if(!Number.isFinite(Date.parse(now))||!Number.isFinite(Date.parse(leaseUntil))
        ||Date.parse(leaseUntil)<=Date.parse(now))
        throw new Error('invalid_ads_managed_lease_time');
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [rows]=await tx`SELECT owner_id,lease_until FROM awg_ads_job_leases WHERE job_id=${jobId}`;
        if(rows.length&&String(rows[0].lease_until)>now)return {acquired:false};
        await tx`UPSERT INTO awg_ads_job_leases (job_id,owner_id,lease_until,acquired_at)
          VALUES (${jobId},${ownerId},${leaseUntil},${now})`;
        await tx`UPSERT INTO awg_ads_job_runs (job_id,owner_id,status,started_at,finished_at)
          VALUES (${jobId},${ownerId},${'running'},${now},${''})`;
        return {acquired:true,expiredOwnerReplaced:rows.length>0};
      });
    },
    async complete({jobId,ownerId,status,finishedAt}={}){
      validate(jobId,ownerId);
      if(!['success','failure'].includes(status)||!Number.isFinite(Date.parse(finishedAt)))
        throw new Error('invalid_ads_managed_job_completion');
      return sql.begin({isolation:'serializableReadWrite',idempotent:true},async tx=>{
        const [rows]=await tx`SELECT owner_id FROM awg_ads_job_leases WHERE job_id=${jobId}`;
        if(!rows.length||String(rows[0].owner_id)!==ownerId)
          throw new Error('ads_managed_job_lease_lost');
        const [runs]=await tx`SELECT started_at FROM awg_ads_job_runs
          WHERE job_id=${jobId} AND owner_id=${ownerId}`;
        if(!runs.length)throw new Error('ads_managed_job_run_missing');
        await tx`UPSERT INTO awg_ads_job_runs (job_id,owner_id,status,started_at,finished_at)
          VALUES (${jobId},${ownerId},${status},${String(runs[0].started_at)},${finishedAt})`;
        await tx`DELETE FROM awg_ads_job_leases WHERE job_id=${jobId}`;
        return {completed:true};
      });
    }
  };
}
