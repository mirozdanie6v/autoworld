import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';

const connectionString=String(process.env.YDB_CONNECTION_STRING||'').trim();
const accessToken=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||process.env.YC_IAM_TOKEN||'').trim();
assert.ok(connectionString,'YDB_CONNECTION_STRING is required');
assert.ok(accessToken,'YDB access token is required');
const credentialsProvider=new AccessTokenCredentialsProvider({token:accessToken});

const stateStore=await createYdbStateStore({connectionString,credentialsProvider,domainDualWrite:false,ensureSchema:false});
const domainStore=await createYdbDomainStore({connectionString,credentialsProvider,ensureSchema:false});
const report={ok:false,at:new Date().toISOString(),before:{},after:{},preserved:{}};

try{
  const before=await domainStore.loadState();
  const beforeCounts=await domainStore.counts();
  const [adminBeforeRows]=await domainStore.sql`SELECT COUNT(*) AS count FROM auto_sale_admin_access`;
  const [outboxRows]=await domainStore.sql`SELECT id FROM auto_sale_notification_outbox`;
  const adminBefore=Number(adminBeforeRows[0]?.count||0n);

  report.before={
    revision:Number(before.revision)||0,
    leads:(before.leads||[]).length,
    quotes:(before.quotes||[]).length,
    orders:(before.orders||[]).length,
    notes:Object.values(before.notes||{}).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0),
    payments:(beforeCounts.auto_sale_payments||0),
    telegramBindings:(beforeCounts.auto_sale_telegram_bindings||0),
    outbox:outboxRows.length,
    team:(before.team||[]).length,
    catalog:(before.catalog||[]).length,
    adminAccess:adminBefore
  };

  const next={
    ...before,
    initialized:true,
    leads:[],
    quotes:[],
    orders:[],
    notes:{},
    team:Array.isArray(before.team)?before.team:[],
    catalog:Array.isArray(before.catalog)?before.catalog:[]
  };
  delete next.revision;

  const result=await stateStore.commitDomainState(before,next,{expectedRevision:before.revision,notifications:[]});
  assert.equal(result.status,200,'CRM clear transaction failed');

  // Old delivery receipts/pending retries must not fire during the customer demo.
  for(const row of outboxRows){
    await domainStore.sql`DELETE FROM auto_sale_notification_outbox WHERE id=${String(row.id)}`;
  }

  const after=await domainStore.loadState();
  const afterCounts=await domainStore.counts();
  const [adminAfterRows]=await domainStore.sql`SELECT COUNT(*) AS count FROM auto_sale_admin_access`;
  const [outboxAfterRows]=await domainStore.sql`SELECT COUNT(*) AS count FROM auto_sale_notification_outbox`;
  const adminAfter=Number(adminAfterRows[0]?.count||0n);

  report.after={
    revision:Number(after.revision)||0,
    leads:(after.leads||[]).length,
    quotes:(after.quotes||[]).length,
    orders:(after.orders||[]).length,
    notes:Object.values(after.notes||{}).reduce((sum,rows)=>sum+(Array.isArray(rows)?rows.length:0),0),
    payments:(afterCounts.auto_sale_payments||0),
    telegramBindings:(afterCounts.auto_sale_telegram_bindings||0),
    outbox:Number(outboxAfterRows[0]?.count||0n),
    team:(after.team||[]).length,
    catalog:(after.catalog||[]).length,
    adminAccess:adminAfter
  };

  assert.equal(report.after.leads,0);
  assert.equal(report.after.quotes,0);
  assert.equal(report.after.orders,0);
  assert.equal(report.after.notes,0);
  assert.equal(report.after.payments,0);
  assert.equal(report.after.outbox,0);
  assert.equal(report.after.team,report.before.team,'team must be preserved');
  assert.equal(report.after.catalog,report.before.catalog,'catalog must be preserved');
  assert.equal(report.after.adminAccess,report.before.adminAccess,'admin access registry must be preserved');

  // Remaining Telegram bindings may only belong to preserved staff rows.
  const [bindingRows]=await domainStore.sql`SELECT subject_type,subject_id FROM auto_sale_telegram_bindings`;
  const clientBindings=bindingRows.filter(row=>String(row.subject_type||'')==='client');
  report.after.telegramBindings=bindingRows.length;
  report.after.telegramBindingTypes=Object.fromEntries([...new Set(bindingRows.map(row=>String(row.subject_type||'')))].map(type=>[type,bindingRows.filter(row=>String(row.subject_type||'')===type).length]));
  report.preserved={team:true,catalog:true,adminAccess:true,legacyCompatibilitySnapshotUntouched:true};
  await writeFile('auto-sale-demo-cleanup-report.json',JSON.stringify(report,null,2));
  assert.equal(clientBindings.length,0,'client Telegram bindings must be removed');

  report.ok=true;
  await writeFile('auto-sale-demo-cleanup-report.json',JSON.stringify(report,null,2));
  console.log('AUTO_SALE_DEMO_CLEANUP_OK',JSON.stringify(report));
} finally {
  await Promise.allSettled([stateStore.close(),domainStore.close()]);
}
