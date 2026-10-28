// Managed Yandex staging acceptance. Only the two physically reviewed databases.
// Synthetic identities only; no Telegram/VK network calls or production writes.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {Driver} from '@ydbjs/core';
import {fromBinary} from '@bufbuild/protobuf';
import {TableServiceDefinition,CreateSessionResultSchema,DescribeTableResultSchema} from '@ydbjs/api/table';
import {query} from '@ydbjs/query';
import {Type_PrimitiveTypeId} from '@ydbjs/api/value';
import {SchemeServiceDefinition,ListDirectoryResultSchema} from '@ydbjs/api/scheme';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbAdsAttributionRepository} from '../server/ads-attribution-ydb.mjs';
import {createAdsAttributionService,createAdsSubjectKey} from '../server/ads-attribution-core.mjs';
import {createAdsStageBBridge} from '../server/ads-attribution-stage-b.mjs';
import {createAdsStageBServerBridge} from '../server/ads-stage-b-runtime.mjs';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {legacyStateToDomainRows} from '../server/ydb-domain-migration.mjs';
import {mutateAutoSaleEntityBatch} from '../server/ydb-entity-commands.mjs';
import {sanitizeClientOperations} from '../server/auto-sale-access.mjs';
import {createAdsJobLeaseStore} from '../server/ads-stage-b-scheduled-jobs.mjs';

const cloud='b1ggsmuiq7tb2d27f89q';
const uri=id=>'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/'+cloud+'/'+id;
const ads=uri('etnseoqfsf7ojn52813t'),crm=uri('etnvd9hmimkt74vpuqa6');
const prod=uri('etn00ojk5iv1u7dgpdar');
const env=process.env;
assert.equal(env.AWG_ADS_MANAGED_ACCEPTANCE_APPROVED,'reviewed-two-staging-databases');
assert.equal(env.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING,ads);
assert.equal(env.YDB_CONNECTION_STRING,crm);
assert.ok(env.YDB_ACCESS_TOKEN_CREDENTIALS);
const creds=new AccessTokenCredentialsProvider({token:env.YDB_ACCESS_TOKEN_CREDENTIALS});
const driver=new Driver(ads,{credentialsProvider:creds});
const secret=randomBytes(32).toString('hex');
const suffix=randomUUID().replaceAll('-','');
const campaignA='QA-A-'+suffix,campaignB='QA-B-'+suffix;
const user='999'+String(Date.now()).slice(-10);
const identity={provider:'telegram',id:user,key:'telegram:'+user};
const access={role:'client',authenticated:true,authType:'telegram',user:{id:user}};
const report={managedDatabases:true,physicalTelegramVk:false};
let legacyStore,domainStore;
async function cli(kind){
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['scripts/run-awg-ads-staging-operations.mjs',kind],{
      stdio:'inherit',env:{...env,
        AWG_ADS_MANAGED_STAGING_ENABLED:'true',AWG_ADS_STAGE_B_MODE:'isolated-staging',
        AWG_ADS_STAGING_IAM_VERIFIED:'true',
        AWG_ADS_STAGING_YDB_CONNECTION_STRING:ads,
        AWG_ADS_STAGING_CRM_YDB_CONNECTION_STRING:crm,
        AWG_ADS_PRODUCTION_DB_PATH:new URL(prod).searchParams.get('database'),
        AWG_ADS_STAGING_APPROVED_DATABASE_PATHS:[ads,crm].map(x=>new URL(x).searchParams.get('database')).join(','),
        AWG_ADS_STAGING_SCHEDULER_PRINCIPAL:'aje3j5aat66lel86cd5r',
        AWG_ADS_STAGING_RETENTION_APPROVED:'true',
        AWG_ADS_STAGE_B_SUBJECT_SECRET:secret
      }});
    child.once('error',reject);child.once('exit',resolve);
  });
  assert.equal(result,0,'managed '+kind+' job must finish successfully');
}

async function prepareCrmStagingSchema(){
  assert.equal(env.YDB_CONNECTION_STRING,crm);
  const db=new Driver(crm,{credentialsProvider:creds});
  let client,sessionId;
  const decode=(response,schema,label)=>{
    const op=response?.operation;
    if(op?.ready!==true||op.status!==400000||!op.result?.value)
      throw new Error(label+'_'+op?.status);
    return fromBinary(schema,op.result.value);
  };
  try{
    await db.ready();
    const path=new URL(crm).searchParams.get('database');
    const scheme=db.createClient(SchemeServiceDefinition);
    const listing=decode(await scheme.listDirectory({path}),ListDirectoryResultSchema,'crm_list');
    const existing=new Set(listing.children.map(x=>x.name));
    const specs=[];
    // Use the existing application's simple CREATE declarations as the source
    // of truth; fail closed on any unsupported syntax/type or unexpected table.
    for(const file of ['server/ydb-state.mjs','server/ydb-domain-store.mjs']){
      const source=await readFile(file,'utf8');
      for(const match of source.matchAll(/CREATE TABLE IF NOT EXISTS (auto_sale_\w+) \(([\s\S]*?)PRIMARY KEY \(([^)]+)\)\s*\)/g)){
        const columns=match[2].split(',').map(x=>x.trim()).filter(Boolean).map(text=>{
          const m=text.match(/^(\w+)\s+(Utf8|Uint64|Bool|Double)( NOT NULL)?$/);
          if(!m)throw new Error('crm_schema_unsupported_column');
          const id=Type_PrimitiveTypeId[{Utf8:'UTF8',Uint64:'UINT64',Bool:'BOOL',Double:'DOUBLE'}[m[2]]];
          const primitive={type:{case:'typeId',value:id}};
          return {name:m[1],notNull:!!m[3],type:m[3]?primitive:
            {type:{case:'optionalType',value:{item:primitive}}}};
        });
        specs.push({name:match[1],columns,primaryKey:match[3].split(',').map(x=>x.trim())});
      }
    }
    const expected=["auto_sale_state","auto_sale_notification_outbox","auto_sale_admin_access","auto_sale_schema_meta","auto_sale_state_meta","auto_sale_leads","auto_sale_quotes","auto_sale_orders","auto_sale_payments","auto_sale_notes","auto_sale_team","auto_sale_catalog","auto_sale_telegram_bindings"];
    assert.deepEqual(specs.map(x=>x.name).sort(),[...expected].sort());
    client=db.createClient(TableServiceDefinition);
    sessionId=decode(await client.createSession({}),CreateSessionResultSchema,'crm_session').sessionId;
    for(const spec of specs){
      const fullPath=path+'/'+spec.name;
      if(!existing.has(spec.name)){
        const created=await client.createTable({sessionId,path:fullPath,columns:spec.columns,primaryKey:spec.primaryKey},
          {signal:AbortSignal.timeout(30000)});
        if(created.operation?.ready!==true||created.operation.status!==400000)
          throw new Error('crm_create_'+spec.name+'_'+created.operation?.status);
      }
      const described=decode(await client.describeTable({sessionId,path:fullPath}),
        DescribeTableResultSchema,'crm_describe_'+spec.name);
      assert.deepEqual(described.primaryKey,spec.primaryKey);
      assert.equal(described.columns.length,spec.columns.length);
      for(const column of spec.columns){
        const actual=described.columns.find(x=>x.name===column.name);
        assert.ok(actual,'missing CRM column '+column.name);
        assert.deepEqual(actual.type.type,column.type.type,'CRM column type '+column.name);
      }
      console.log('AWG_CRM_STAGING_TABLE_VERIFIED',spec.name);
    }
  }finally{
    if(sessionId)await client.deleteSession({sessionId}).catch(()=>{});
    await db.close();
  }
}

try{
  await driver.ready();
  const sql=query(driver);
  // Auditor can evaluate constants. Use TableService ReadTable so SQL
  // compilation cannot mask the actual read authorization result.
  // Request only the non-sensitive singleton key, never payload/customer data.
  const deniedDriver=new Driver(prod,{credentialsProvider:creds});
  let denied=false,productionTableClient,productionSessionId;
  try{
    await deniedDriver.ready();
    await query(deniedDriver)`SELECT 1 AS isolation_probe`.isolation('snapshotReadOnly').timeout(10000);
    report.productionConstantQueryAllowed=true;
    productionTableClient=deniedDriver.createClient(TableServiceDefinition);
    const response=await productionTableClient.createSession({}, {signal:AbortSignal.timeout(20000)});
    const op=response?.operation;
    if(op?.ready!==true||op.status!==400000||!op.result?.value)
      throw new Error('production_deny_session_inconclusive_'+op?.status);
    productionSessionId=fromBinary(CreateSessionResultSchema,op.result.value).sessionId;
    if(!productionSessionId)throw new Error('production_deny_session_missing');
    try{
      for await(const part of productionTableClient.streamReadTable({
        sessionId:productionSessionId,
        path:new URL(prod).searchParams.get('database')+'/auto_sale_state',
        columns:['id'],rowLimit:1n
      },{signal:AbortSignal.timeout(20000)})){
        if(part.status===400020){denied=true;break;}
        if(part.status!==400000)throw new Error('production_table_deny_probe_inconclusive_'+part.status);
        // A successful read response is a failed isolation check, even if empty.
        throw new Error('production_table_read_unexpectedly_allowed');
      }
    }catch(e){
      if(e?.code===7&&/permission|access denied|unauthoriz/i.test(String(e?.message)))denied=true;
      else throw e;
    }
  }finally{
    if(productionSessionId)await productionTableClient.deleteSession({sessionId:productionSessionId},
      {signal:AbortSignal.timeout(10000)}).catch(()=>{});
    await deniedDriver.close();
  }
  assert.equal(denied,true,'staging SA must be explicitly denied production table reads');
  report.productionTableReadDenied=true;
  console.log('AWG_STAGING_ISOLATION_VERIFIED',JSON.stringify({
    constantAllowed:true,productionTableReadDenied:true,productionWrites:0,customerColumnsRequested:0
  }));

  await prepareCrmStagingSchema();
  console.log('AWG_CRM_STAGING_SCHEMA_VERIFIED');
  legacyStore=await createYdbStateStore({connectionString:crm,credentialsProvider:creds,ensureSchema:false,domainDualWrite:false});
  domainStore=await createYdbDomainStore({connectionString:crm,credentialsProvider:creds,ensureSchema:false});
  console.log('AWG_CRM_STAGING_STORES_OPEN');

  const original=await legacyStore.loadState();
  // Bootstrap once; subsequent acceptance runs must preserve prior staging fixtures.
  const existing=await domainStore.loadState();
  if(!existing.initialized){
    await domainStore.replaceSnapshot(legacyStateToDomainRows(original),{sourceRevision:original.revision,status:'initialized'});
  }
  const repository=createYdbAdsAttributionRepository(sql);
  let now=new Date(Date.now()-180000).toISOString();
  const service=createAdsAttributionService({repository,subjectSecret:secret,clock:()=>new Date(now)});
  const bridge=createAdsStageBBridge({enabled:true,service,onFailure:async()=>{}});
  const a=(await service.issueCampaign({campaignId:campaignA})).token;
  const b=(await service.issueCampaign({campaignId:campaignB})).token;
  const update=String(Date.now());
  assert.equal((await bridge.recordBotStart({telegramUserId:user,startPayload:a,updateId:update})).status,'recorded');
  assert.equal((await bridge.recordBotStart({telegramUserId:user,startPayload:a,updateId:update})).status,'duplicate');
  now=new Date(Date.now()-120000).toISOString();
  const id='L-ADS-QA-'+suffix;
  const sanitized=sanitizeClientOperations(await domainStore.loadState(),[{
    resource:'lead',operation:'create',id,input:{name:'Synthetic ads staging QA',contact:'@synthetic',
      model:'QA vehicle',budget:29000,adsAttribution:{lastTouch:{campaignId:'forged'}}}
  }],{id:user,first_name:'Synthetic'},identity,{now:()=>now});
  assert.equal(sanitized.ok,true);
  assert.equal(sanitized.operations[0].input.adsAttribution,undefined);
  const operations=await bridge.enrichLeadOperations(sanitized.operations,access);
  assert.equal(operations[0].input.adsAttribution.lastTouch.campaignId,campaignA);
  assert.equal((await bridge.recordCommittedLeads(operations,access,{committed:false})).recorded,0);
  const committed=await mutateAutoSaleEntityBatch({legacyStore,domainStore,operations,prepareNotifications:null});
  assert.equal(committed.status,200,'real managed CRM transaction');
  assert.equal((await bridge.recordCommittedLeads(operations,access,{committed:true})).recorded,1);
  await bridge.recordCommittedLeads(operations,access,{committed:true});
  const saved=(await domainStore.loadState()).leads.find(x=>x.id===id);
  assert.equal(saved.adsAttribution.lastTouch.campaignId,campaignA);
  now=new Date(Date.now()-60000).toISOString();
  await bridge.recordBotStart({telegramUserId:user,startPayload:b,updateId:String(Number(update)+1)});
  await bridge.reconcilePersistedLead({...saved,firstManagerActionAt:now});
  const receipts=(await repository.listEvents({limit:1000})).events.filter(x=>x.campaignId===campaignA);
  assert.equal(receipts.filter(x=>x.eventType==='lead_submit').length,1);
  assert.equal(receipts.filter(x=>x.eventType==='first_manager_action').length,1);
  const vkOps=await bridge.enrichLeadOperations(sanitized.operations,{...access,authType:'vk'});
  assert.strictEqual(vkOps,sanitized.operations);
  report.realCrmCommit=true;report.idempotentReceipts=true;report.immutableCampaign=true;report.vkExcluded=true;

  const leases=createAdsJobLeaseStore(sql);
  const kind='reconciliation';
  const lease={kind,owner:'QA-A',at:new Date().toISOString(),leaseUntil:new Date(Date.now()+60000).toISOString()};
  assert.equal(await leases.acquire(lease),true);
  assert.equal(await leases.acquire({...lease,owner:'QA-B'}),false);
  assert.equal(await leases.release({kind,owner:'QA-A'}),true);
  report.managedLeaseExclusion=true;
  // Simulate a committed CRM lead whose conversion receipt was missed.
  const replayId='L-ADS-REPLAY-'+suffix;
  const replayOps=operations.map(op=>({...op,id:replayId,input:{...op.input}}));
  assert.equal((await mutateAutoSaleEntityBatch({legacyStore,domainStore,operations:replayOps,prepareNotifications:null})).status,200);
  const beforeReplay=(await repository.listEvents({limit:1000})).events
    .filter(x=>x.campaignId===campaignA&&x.eventType==='lead_submit').length;
  assert.equal(beforeReplay,1);
  // Retention must remove an expired synthetic subject and indexed event,
  // while keeping current campaign/CRM rows.
  const expiredAt=new Date(Date.now()-120*86400000).toISOString();
  const expiredSubject=createAdsSubjectKey(String(BigInt(user)+1n),secret);
  const expiredEvent='qa-expired-'+suffix;
  await repository.recordTouch({eventId:expiredEvent,subjectKey:expiredSubject,
    touch:{campaignId:campaignA,adId:'',creativeId:'',timestamp:expiredAt}});
  assert.ok(await repository.readSubject(expiredSubject));
  const jobsStartedAt=new Date().toISOString();
  await cli('reconciliation');
  const afterReplay=(await repository.listEvents({limit:1000})).events
    .filter(x=>x.campaignId===campaignA&&x.eventType==='lead_submit').length;
  assert.equal(afterReplay,2,'reconciliation must recover the missing committed lead receipt');
  report.reconciliationRecoveredReceipt=true;
  await cli('retention');
  assert.equal(await repository.readSubject(expiredSubject),null,'retention removes expired synthetic subject');
  assert.ok(!(await repository.listEvents({limit:1000})).events.some(x=>x.eventId===expiredEvent),
    'retention removes expired synthetic event');
  assert.ok((await domainStore.loadState()).leads.some(x=>x.id===id),'retention preserves CRM lead');
  report.retentionRemovedExpiredFixture=true;
  const [audit]=await sql`SELECT job_id,status,at FROM awg_ads_job_audit`.isolation('snapshotReadOnly');
  for(const job of ['reconciliation','retention']){
    assert.ok(audit.some(row=>String(row.job_id)===job&&String(row.status)==='ok'&&String(row.at)>=jobsStartedAt),
      'current '+job+' job must have a persistent success audit');
  }
  const [remainingLeases]=await sql`SELECT job_id FROM awg_ads_job_leases`.isolation('snapshotReadOnly');
  assert.equal(remainingLeases.length,0,'one-time jobs must release all staging leases');
  report.jobAuditReadback=true;report.jobLeasesReleased=true;
  report.managedJobs=true;
  // Feature-off rollback smoke at the bridge boundary; no deployment rollback claimed.
  const off=await createAdsStageBServerBridge({env:{},credentialsProvider:creds});
  assert.equal(off.enabled,false);
  assert.deepEqual(await off.enrichLeadOperations(sanitized.operations,access),sanitized.operations);
  const restored=await createAdsStageBServerBridge({env:{
    AWG_ADS_STAGE_B_ENABLED:'true',AWG_ADS_STAGE_B_MODE:'isolated-staging',
    AWG_ADS_STAGE_B_YDB_CONNECTION_STRING:ads,YDB_CONNECTION_STRING:crm,
    AWG_ADS_STAGE_B_SUBJECT_SECRET:secret
  },credentialsProvider:creds});
  try{assert.equal(restored.enabled,true);}finally{await restored.close();}
  report.featureFlagRollbackSmoke=true;report.deploymentRollback=false;
  console.log('AWG_MANAGED_STAGING_ACCEPTANCE_PASS',JSON.stringify(report));
}finally{
  await Promise.allSettled([legacyStore?.close(),domainStore?.close(),driver.close()]);
}
