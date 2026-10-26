import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdsMaintenanceJob} from '../server/ads-attribution-maintenance.mjs';

const principal={id:'scheduler-stage-a-local'};
test('scheduler handler emits completion metrics without leaking identities',async()=>{
  const metrics=[],alerts=[];
  const run=createAdsMaintenanceJob({
    privacyService:{runRetentionCycle:async()=>({status:'complete',batches:3,deletedEvents:150,
      deletedSubjects:12,compactedSubjects:2})},
    emitMetric:async value=>metrics.push(value),
    emitAlert:async value=>alerts.push(value),
    clock:()=>100
  });
  const result=await run({principal});
  assert.equal(result.status,'complete');
  assert.ok(metrics.some(m=>m.name==='awg_ads_retention_deleted_events'&&m.value===150));
  assert.ok(metrics.some(m=>m.name==='awg_ads_retention_success'));
  assert.equal(alerts.length,0);
  assert.equal(JSON.stringify(metrics).includes(principal.id),false);
});
test('incomplete retention is an alerting failure, never silent success',async()=>{
  const alerts=[],metrics=[];
  const run=createAdsMaintenanceJob({
    privacyService:{runRetentionCycle:async()=>({status:'incomplete',batches:20,deletedEvents:300,deletedSubjects:2})},
    emitMetric:async value=>metrics.push(value),
    emitAlert:async value=>alerts.push(value)
  });
  await assert.rejects(run({principal}),/ads_retention_incomplete/);
  assert.deepEqual(alerts,[{code:'awg_ads_retention_incomplete',severity:'high'}]);
  assert.ok(metrics.some(m=>m.name==='awg_ads_retention_failure'));
});
test('YDB maintenance errors surface alerts, no hardcoded scheduler permission',async()=>{
  const alerts=[];
  const run=createAdsMaintenanceJob({
    privacyService:{runRetentionCycle:async()=>{throw new Error('ads_operation_forbidden');}},
    emitMetric:async()=>{},emitAlert:async value=>alerts.push(value)
  });
  await assert.rejects(run({principal}),/ads_operation_forbidden/);
  assert.equal(alerts[0].code,'awg_ads_retention_failed');
  assert.throws(()=>createAdsMaintenanceJob({privacyService:{runRetentionCycle:()=>{}}}),/observability_required/);
});
