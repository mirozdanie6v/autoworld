// Synthetic end-to-end bridge proof on a real, localhost-only YDB engine.
// Does NOT write live CRM leads or send Telegram messages.
import assert from 'node:assert/strict';
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {AnonymousCredentialsProvider} from '@ydbjs/auth/anonymous';
import {createYdbAdsAttributionRepository,ensureAdsAttributionSchema} from '../server/ads-attribution-ydb.mjs';
import {ensureAdsOperationsSchema,createAdsJobLeaseStore} from '../server/ads-stage-b-scheduled-jobs.mjs';
import {createAdsAttributionService,createAdsSubjectKey} from '../server/ads-attribution-core.mjs';
import {createAdsPrivacyService} from '../server/ads-attribution-privacy.mjs';
import {createAdsCrossStoreErasure} from '../server/ads-stage-b-cross-store-erasure.mjs';
import {createAdsStageBBridge} from '../server/ads-attribution-stage-b.mjs';
import {sanitizeClientOperations} from '../server/auto-sale-access.mjs';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {legacyStateToDomainRows} from '../server/ydb-domain-migration.mjs';
import {mutateAutoSaleEntityBatch} from '../server/ydb-entity-commands.mjs';

if(process.env.AWG_ADS_LOCAL_YDB_TEST!=='yes'
  ||process.env.YDB_CONNECTION_STRING
  ||process.env.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING
  ||process.env.YDB_ACCESS_TOKEN_CREDENTIALS){
  throw new Error('stage_b_real_local_ydb_test_isolation_required');
}
const driver=new Driver('grpc://localhost:2136/local',{
  credentialsProvider:new AnonymousCredentialsProvider()
});
await driver.ready();
try{
  const sql=query(driver);
  await ensureAdsAttributionSchema(sql,{target:'isolated-test-database'});
  // Lock and durable audit exercise use the REAL local YDB transaction layer.
  await ensureAdsOperationsSchema(sql,{target:'isolated-test-database'});
  const maintenance=createAdsJobLeaseStore(sql);
  const firstLease={kind:'reconciliation',owner:'test-run-A',
    at:'2026-10-27T08:00:00Z',leaseUntil:'2026-10-27T08:20:00Z'};
  assert.equal(await maintenance.acquire(firstLease),true);
  assert.equal(await maintenance.acquire({...firstLease,owner:'test-run-B'}),false);
  assert.equal(await maintenance.release({kind:'reconciliation',owner:'test-run-B'}),false);
  assert.equal(await maintenance.release({kind:'reconciliation',owner:'test-run-A'}),true);
  assert.equal(await maintenance.acquire({...firstLease,owner:'test-run-B'}),true);
  await maintenance.audit({kind:'reconciliation',status:'ok',at:'2026-10-27T08:01:00Z'});
  assert.equal(await maintenance.release({kind:'reconciliation',owner:'test-run-B'}),true);
  console.log('AWG_STAGE_B_YDB_DURABLE_LEASE_AUDIT_PASS');
  const repository=createYdbAdsAttributionRepository(sql);
  const service=createAdsAttributionService({repository,
    subjectSecret:'stage-b-real-local-ydb-ci-only-secret-0123456789',
    clock:()=>new Date('2026-10-27T06:00:00Z')
  });
  const errors=[];
  const bridge=createAdsStageBBridge({enabled:true,service,
    onFailure:async warning=>errors.push(warning)
  });
  const campaign=await service.issueCampaign({campaignId:'StageB-Real-YDB',adId:'ad-01'});
  const recorded=await bridge.recordBotStart({
    telegramUserId:111111,startPayload:campaign.token,updateId:9990101
  });
  assert.equal(recorded.status,'recorded');
  assert.equal((await bridge.recordBotStart({
    telegramUserId:111111,startPayload:campaign.token,updateId:9990101
  })).status,'duplicate');

  const source=[{resource:'lead',operation:'create',id:'L-stageB-local-01',input:{
    id:'L-stageB-local-01',name:'Test Telegram',model:'Honda',source:'fake',
    adsAttribution:{lastTouch:{campaignId:'forged'}}
  }}];
  const identity={provider:'telegram',id:'111111',key:'telegram:111111'};
  const access={role:'client',authenticated:true,authType:'telegram',user:{id:'111111'}};
  const sanitized=sanitizeClientOperations({
    initialized:true,leads:[],quotes:[],catalog:[],notes:{}
  },source,{id:'111111',first_name:'Test'},identity);
  assert.equal(sanitized.ok,true);
  assert.equal('adsAttribution' in sanitized.operations[0].input,false);
  const trusted=await bridge.enrichLeadOperations(sanitized.operations,access);
  assert.equal(trusted[0].input.adsAttribution.lastTouch.campaignId,'StageB-Real-YDB');

  // No lead_submit receipt before the authoritative CRM transaction commits.
  let page=await repository.listEvents({limit:20});
  assert.equal(page.events.filter(x=>x.eventType==='lead_submit').length,0);
  assert.equal((await bridge.recordCommittedLeads(trusted,access,{committed:false})).recorded,0);
  // This simulates a successful application-level commit. Full staging CRM
  // transaction E2E remains a separate Stage B release requirement.
  const authoritativeCrm=[structuredClone(trusted[0].input)];
  assert.equal(authoritativeCrm[0].adsAttribution.lastTouch.campaignId,'StageB-Real-YDB');
  assert.equal((await bridge.recordCommittedLeads(trusted,access,{committed:true})).recorded,1);
  assert.equal((await bridge.recordCommittedLeads(trusted,access,{committed:true})).recorded,1);
  page=await repository.listEvents({limit:20});
  const leads=page.events.filter(x=>x.eventType==='lead_submit');
  assert.equal(leads.length,1);
  assert.equal(leads[0].campaignId,'StageB-Real-YDB');

  // Client-side event payload cannot choose a campaign; the server verifies
  // catalog identity and creates one receipt per user/car/day.
  assert.equal((await bridge.recordMiniAppEvent({access,eventType:'miniapp_open'})).status,'recorded');
  assert.equal((await bridge.recordMiniAppEvent({access,eventType:'miniapp_open'})).status,'duplicate');
  assert.equal((await bridge.recordMiniAppEvent({
    access,eventType:'vehicle_detail_click',carId:'verified-car',
    catalog:[{id:'verified-car',active:true}]
  })).status,'recorded');
  assert.equal((await bridge.recordMiniAppEvent({
    access,eventType:'vehicle_detail_click',carId:'hidden-car',
    catalog:[{id:'hidden-car',active:false}]
  })).reason,'vehicle_not_in_current_catalog');

  // Once the CRM lead was saved under A, a later B touch must NOT
  // retroactively re-attribute that old lead or the manager's first contact.
  const other=await service.issueCampaign({campaignId:'StageB-Other-Campaign'});
  await bridge.recordBotStart({
    telegramUserId:111111,startPayload:other.token,updateId:9990102
  });
  const persistedLead={...authoritativeCrm[0],id:'L-stageB-local-01',
    clientProvider:'telegram',clientProviderUserId:'111111',
    firstManagerActionAt:'2026-10-27T06:00:00Z'
  };
  assert.equal((await bridge.reconcilePersistedLead(persistedLead)).status,'duplicate');
  const finalReceipts=(await repository.listEvents({limit:30})).events;
  assert.equal(finalReceipts.filter(x=>x.eventType==='lead_submit').length,1);
  assert.equal(finalReceipts.find(x=>x.eventType==='lead_submit').campaignId,'StageB-Real-YDB');
  assert.equal(finalReceipts.find(x=>x.eventType==='first_manager_action').campaignId,'StageB-Real-YDB');
  assert.equal(finalReceipts.filter(x=>x.eventType==='miniapp_open').length,1);
  assert.equal(finalReceipts.filter(x=>x.eventType==='vehicle_detail_click').length,1);

  const vkOps=await bridge.enrichLeadOperations(sanitized.operations,{
    role:'client',authenticated:true,authType:'vk',user:{id:'111111'}
  });
  assert.strictEqual(vkOps,sanitized.operations);
  assert.deepEqual(errors,[]);

  // The separate ads DB may be unreachable during a real CRM commit.
  // Recover only from the indexed immutable bot history *before* submission.
  let recoveryNow='2026-10-27T05:00:00Z';
  const recoveringService=createAdsAttributionService({
    repository,subjectSecret:'stage-b-real-local-ydb-ci-only-secret-0123456789',
    clock:()=>new Date(recoveryNow)
  });
  const outageA=(await recoveringService.issueCampaign({campaignId:'outage-campaign-A'})).token;
  const outageB=(await recoveringService.issueCampaign({campaignId:'later-campaign-B'})).token;
  await recoveringService.recordBotStart({telegramUserId:222222,startPayload:outageA,updateId:9990201});
  recoveryNow='2026-10-27T05:10:00Z';
  const interrupted=createAdsStageBBridge({enabled:true,service:{
    ...recoveringService,getAttribution:async()=>{throw Error('simulated ads read outage')}
  },onFailure:async()=>{}});
  const outageAccess={role:'client',authenticated:true,authType:'telegram',user:{id:'222222'}};
  const lost=await interrupted.enrichLeadOperations([{
    resource:'lead',operation:'create',id:'L-stageB-ads-outage',input:{
      clientProvider:'telegram',clientProviderUserId:'222222',
      clientSubmittedAt:recoveryNow
    }
  }],outageAccess);
  assert.equal(lost[0].input.adsAttributionStatus,'lookup_unavailable');
  const savedOutageLead={...lost[0].input,id:'L-stageB-ads-outage'};
  recoveryNow='2026-10-27T05:20:00Z';
  await recoveringService.recordBotStart({telegramUserId:222222,startPayload:outageB,updateId:9990202});
  const historical=await recoveringService.getAttributionAtTime({
    telegramUserId:'222222',asOf:savedOutageLead.clientSubmittedAt
  });
  assert.equal(historical.lastTouch.campaignId,'outage-campaign-A');
  assert.equal((await interrupted.reconcilePersistedLead(savedOutageLead)).status,'recorded');
  const recoveredReceipts=(await repository.listEvents({limit:100})).events;
  assert.equal(recoveredReceipts.find(e=>e.eventType==='lead_submit'
    &&e.eventId.startsWith('ads:lead_')&&e.campaignId==='outage-campaign-A')?.campaignId,'outage-campaign-A');
  console.log('AWG_STAGE_B_LOCAL_YDB_AS_OF_RECOVERY_PASS');

  // Actual normalized CRM YDB transaction, not an in-memory mock. All tables
  // reside exclusively in this disposable localhost CI process. No notifications.
  const localConnection='grpc://localhost:2136/local';
  const credentialsProvider=new AnonymousCredentialsProvider();
  const legacyStore=await createYdbStateStore({
    connectionString:localConnection,credentialsProvider,
    ensureSchema:true,domainDualWrite:false
  });
  const domainStore=await createYdbDomainStore({
    connectionString:localConnection,credentialsProvider,ensureSchema:true
  });
  try{
    const original=await legacyStore.loadState();
    await domainStore.replaceSnapshot(legacyStateToDomainRows(original),{
      sourceRevision:original.revision,status:'initialized'
    });
    const initial=await domainStore.loadState();
    const realOps=sanitizeClientOperations(initial,[{
      resource:'lead',operation:'create',id:'L-ADS-REAL-NORMALIZED',input:{
        name:'Synthetic Stage B Client',contact:'@synthetic',
        model:'BMW 320',budget:29000,
        adsAttribution:{source:'Telegram Ads',lastTouch:{campaignId:'injected'}}
      }
    }],{id:'111111',first_name:'Synthetic'},identity,{
      now:()=> '2026-10-27T06:00:00Z'
    });
    assert.equal(realOps.ok,true);
    assert.equal(realOps.operations[0].input.adsAttribution,undefined);
    const trustedOps=await bridge.enrichLeadOperations(realOps.operations,access);
    assert.equal(trustedOps[0].input.adsAttribution.lastTouch.campaignId,'StageB-Other-Campaign');
    // A newer campaign at commit time is expected; the snapshot cannot change
    // after CRM successfully saves it.
    const committed=await mutateAutoSaleEntityBatch({
      legacyStore,domainStore,operations:trustedOps,
      prepareNotifications:null
    });
    assert.equal(committed.status,200,JSON.stringify(committed.data));
    const persisted=await domainStore.loadState();
    const saved=persisted.leads.find(x=>x.id==='L-ADS-REAL-NORMALIZED');
    assert.ok(saved);
    assert.equal(saved.clientProvider,'telegram');
    assert.equal(saved.adsAttribution.lastTouch.campaignId,'StageB-Other-Campaign');
    const snapshotAtCommit=saved.adsAttribution;
    assert.equal((await bridge.recordCommittedLeads(trustedOps,access,{committed:true})).recorded,1);
    const final=await domainStore.loadState();
    assert.deepEqual(final.leads.find(x=>x.id===saved.id).adsAttribution,snapshotAtCommit);
    // Recovery marker also survives a REAL normalized CRM commit. After
    // historical reconstruction it is repaired via version-checked mutation.
    const outageIdentity={provider:'telegram',id:'222222',key:'telegram:222222'};
    const outageCreate=sanitizeClientOperations(await domainStore.loadState(),[{
      resource:'lead',operation:'create',id:'L-ADS-REAL-RECOVERY',input:{
        name:'Synthetic historical recovery',contact:'@synthetic',
        model:'Kia Sportage',budget:22000
      }
    }],{id:'222222',first_name:'Synthetic'},outageIdentity,{
      now:()=> '2026-10-27T05:10:00Z'
    });
    assert.equal(outageCreate.ok,true);
    const pendingOps=await interrupted.enrichLeadOperations(outageCreate.operations,outageAccess);
    assert.equal(pendingOps[0].input.adsAttributionStatus,'lookup_unavailable');
    const pendingCommit=await mutateAutoSaleEntityBatch({
      legacyStore,domainStore,operations:pendingOps,prepareNotifications:null
    });
    assert.equal(pendingCommit.status,200,JSON.stringify(pendingCommit.data));
    const stateBeforeRepair=await domainStore.loadState();
    const missing=stateBeforeRepair.leads.find(x=>x.id==='L-ADS-REAL-RECOVERY');
    assert.equal(missing.adsAttribution,undefined);
    const restored=await interrupted.reconcilePersistedLead(missing);
    assert.equal(restored.recoveredSnapshot.lastTouch.campaignId,'outage-campaign-A');
    const baseRowVersion=await domainStore.entityRowVersion('lead',missing.id);
    const patch=await mutateAutoSaleEntityBatch({
      legacyStore,domainStore,operations:[{
        resource:'lead',operation:'patch',id:missing.id,baseRowVersion,
        input:{adsAttribution:restored.recoveredSnapshot,adsAttributionStatus:'recovered'}
      }],prepareNotifications:null
    });
    assert.equal(patch.status,200,JSON.stringify(patch.data));
    const stateAfterRepair=await domainStore.loadState();
    const repaired=stateAfterRepair.leads.find(x=>x.id===missing.id);
    assert.equal(repaired.adsAttribution.lastTouch.campaignId,'outage-campaign-A');
    assert.equal(repaired.adsAttributionStatus,'recovered');
    // A stale writer must not rewrite immutable provenance.
    const stale=await mutateAutoSaleEntityBatch({
      legacyStore,domainStore,operations:[{
        resource:'lead',operation:'patch',id:missing.id,baseRowVersion,
        input:{adsAttribution:{source:'Telegram Ads',
          lastTouch:{campaignId:'later-campaign-B'}}}
      }],prepareNotifications:null
    });
    assert.equal(stale.status,409);

    // Full datastore-level erasure: the ads ledger is tombstoned first,
    // then only the matching Telegram lead's campaign metadata is scrubbed
    // using authoritative normalized CRM row versions. A VK client with the
    // same numeric provider ID must remain untouched.
    const vkCreated=await mutateAutoSaleEntityBatch({
      legacyStore,domainStore,prepareNotifications:null,operations:[{
        resource:'lead',operation:'create',id:'L-ADS-REAL-VK',input:{
          id:'L-ADS-REAL-VK',clientProvider:'vk',clientProviderUserId:'111111',
          name:'Synthetic VK control',model:'Skoda Octavia',source:'Mini App'
        }
      }]
    });
    assert.equal(vkCreated.status,200,JSON.stringify(vkCreated.data));
    const erasurePrincipal={id:'ads-staging-test-privacy-controller'};
    const privacyService=createAdsPrivacyService({
      repository,subjectSecrets:['stage-b-real-local-ydb-ci-only-secret-0123456789'],
      authorizeOperation:async({permission,principal})=>
        permission==='ads:erase'&&principal.id===erasurePrincipal.id,
      onAudit:async()=>{},
      clock:()=>new Date('2026-10-27T06:45:00Z')
    });
    const erasureAlerts=[];
    const crossStoreErasure=createAdsCrossStoreErasure({
      privacyService,
      readCommittedLeads:async()=>(await domainStore.loadState()).leads,
      readLeadVersion:id=>domainStore.entityRowVersion('lead',id),
      patchLead:async({id,expectedRowVersion,expectedProvider,expectedProviderUserId,input})=>{
        const state=await domainStore.loadState();
        const current=(state.leads||[]).find(x=>String(x.id)===id);
        if(!current||current.clientProvider!==expectedProvider
          ||String(current.clientProviderUserId)!==expectedProviderUserId)
          return {ok:false,reason:'not_found'};
        const result=await mutateAutoSaleEntityBatch({
          legacyStore,domainStore,prepareNotifications:null,operations:[{
            resource:'lead',operation:'patch',id,baseRowVersion:expectedRowVersion,input
          }]
        });
        return {ok:result.status===200,
          reason:result.status===409?'conflict':result.status===404?'not_found':'server_failure'};
      },
      authorizeOperation:async({permission,principal})=>
        permission==='ads:erase'&&principal.id===erasurePrincipal.id,
      onAudit:async()=>{},onAlert:async value=>erasureAlerts.push(value)
    });
    const erased=await crossStoreErasure.erase({
      telegramUserId:'111111',principal:erasurePrincipal
    });
    assert.equal(erased.status,'complete');
    assert.equal(erased.scrubbedLeads,1);
    const afterErase=await domainStore.loadState();
    const cleanedLead=afterErase.leads.find(x=>x.id==='L-ADS-REAL-NORMALIZED');
    assert.equal(cleanedLead.adsAttribution,null);
    assert.equal(cleanedLead.adsAttributionStatus,'erased');
    assert.equal(cleanedLead.model,saved.model);
    assert.equal(afterErase.leads.find(x=>x.id==='L-ADS-REAL-VK').model,'Skoda Octavia');
    assert.equal(afterErase.leads.find(x=>x.id==='L-ADS-REAL-RECOVERY')
      .adsAttribution.lastTouch.campaignId,'outage-campaign-A');
    assert.equal((await repository.listBotTouchesAt({
      subjectKey:createAdsSubjectKey('111111','stage-b-real-local-ydb-ci-only-secret-0123456789'),
      asOf:'2026-10-27T09:00:00Z'
    })).length,0);
    assert.equal((await crossStoreErasure.erase({
      telegramUserId:'111111',principal:erasurePrincipal
    })).scrubbedLeads,0);
    assert.deepEqual(erasureAlerts,[]);
    console.log('AWG_STAGE_B_LOCAL_YDB_CROSS_STORE_ERASURE_VK_PASS');
    console.log('AWG_STAGE_B_LOCAL_YDB_RECOVERY_CAS_PASS');
    console.log('AWG_STAGE_B_LOCAL_YDB_REAL_CRM_COMMIT_PASS',JSON.stringify({
      committed:true,normalizedSource:true,immutableCampaign:true,clientForgeryStripped:true
    }));
  }finally{
    await Promise.allSettled([legacyStore.close(),domainStore.close()]);
  }
  console.log('AWG_STAGE_B_LOCAL_YDB_BRIDGE_PASS',JSON.stringify({
    campaign:'StageB-Real-YDB',verifiedLeadReceipts:leads.length,
    duplicateLeadSubmitDeduped:true,vkExcluded:true,
    serverSourceOfTruth:true,immutableConversionCampaign:true,
    managerContactDerived:true,miniAppAndVehicleViewsVerified:true
  }));
}finally{await driver.close();}
