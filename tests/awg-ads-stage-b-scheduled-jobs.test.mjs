import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdsScheduledJobRunner,createAdsJobLeaseStore,
  ensureAdsOperationsSchema} from '../server/ads-stage-b-scheduled-jobs.mjs';
const principal={id:'staging-cron-operator'};
function setup({deny=false,incomplete=false,broken=false}={}){
  const jobs=new Map(),audits=[],metrics=[],alerts=[],executions=[];
  let now='2026-10-27T08:00:00Z';
  const run=createAdsScheduledJobRunner({
    store:{
      acquire:async({kind,owner,leaseUntil,at})=>{
        if(jobs.get(kind)?.until>at)return false;
        jobs.set(kind,{owner,until:leaseUntil});return true;
      },
      release:async({kind,owner})=>{
        if(jobs.get(kind)?.owner!==owner)return false;
        jobs.delete(kind);return true;
      },
      audit:async row=>{audits.push(row);}
    },
    authorizeOperation:async()=>!deny,
    runReconciliation:async()=>{
      executions.push('reconciliation');
      if(broken)throw Error('transient storage failure');
      return {complete:!incomplete,errors:0,scanned:10};
    },
    runRetention:async()=>{
      executions.push('retention');
      if(broken)throw Error('transient storage failure');
      return {status:incomplete?'incomplete':'complete',batches:1};
    },
    emitMetric:async value=>metrics.push(value),
    emitAlert:async value=>alerts.push(value),
    clock:()=>new Date(now)
  });
  return {run,jobs,audits,metrics,alerts,executions};
}
test('scheduled job is authorized, leased, audited and releases lock',async()=>{
  const x=setup();
  assert.equal((await x.run({kind:'reconciliation',principal})).status,'ok');
  assert.equal((await x.run({kind:'retention',principal})).status,'ok');
  assert.deepEqual(x.executions,['reconciliation','retention']);
  assert.deepEqual(x.audits.map(a=>a.status),['ok','ok']);
  assert.equal(x.jobs.size,0);
});
test('retention failures and incomplete reconciliation emit alert and release',async()=>{
  for(const opts of [{broken:true},{incomplete:true}]){
    const x=setup(opts);
    await assert.rejects(x.run({kind:'reconciliation',principal}));
    assert.equal(x.audits[0].status,opts.incomplete?'incomplete':'failed');
    assert.equal(x.alerts[0].severity,'high');
    assert.equal(x.jobs.size,0);
  }
});
test('non-authorized scheduler principal does not enter data plane',async()=>{
  const x=setup({deny:true});
  await assert.rejects(x.run({kind:'retention',principal}),/forbidden/);
  assert.equal(x.audits.length,0);
});
test('concurrent runners cannot both execute the same job',async()=>{
  const x=setup();
  x.jobs.set('retention',{owner:'other',until:'2026-10-27T08:15:00Z'});
  assert.equal((await x.run({kind:'retention',principal})).status,'skipped_locked');
  assert.equal(x.executions.length,0);
});
test('separate scheduler DDL cannot be run without explicit isolated target',async()=>{
  const statements=[];
  const sql=async p=>{statements.push(p.join(''));return [[]]};
  await assert.rejects(ensureAdsOperationsSchema(sql),/isolated_target/);
  assert.equal(statements.length,0);
  await ensureAdsOperationsSchema(sql,{target:'isolated-test-database'});
  assert.equal(statements.length,2);
  assert.match(statements[0],/awg_ads_job_leases/);
  assert.match(statements[1],/awg_ads_job_audit/);
  assert.doesNotMatch(statements.join(' '),/auto_sale_leads|auto_sale_orders/);
});
