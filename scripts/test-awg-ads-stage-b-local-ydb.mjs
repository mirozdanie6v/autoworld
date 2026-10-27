// Synthetic end-to-end bridge proof on a real, localhost-only YDB engine.
// Does NOT write live CRM leads or send Telegram messages.
import assert from 'node:assert/strict';
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {AnonymousCredentialsProvider} from '@ydbjs/auth/anonymous';
import {createYdbAdsAttributionRepository,ensureAdsAttributionSchema} from '../server/ads-attribution-ydb.mjs';
import {createAdsAttributionService} from '../server/ads-attribution-core.mjs';
import {createAdsStageBBridge} from '../server/ads-attribution-stage-b.mjs';
import {sanitizeClientOperations} from '../server/auto-sale-access.mjs';

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

  const vkOps=await bridge.enrichLeadOperations(sanitized.operations,{
    role:'client',authenticated:true,authType:'vk',user:{id:'111111'}
  });
  assert.strictEqual(vkOps,sanitized.operations);
  assert.deepEqual(errors,[]);
  console.log('AWG_STAGE_B_LOCAL_YDB_BRIDGE_PASS',JSON.stringify({
    campaign:'StageB-Real-YDB',verifiedLeadReceipts:leads.length,
    duplicateLeadSubmitDeduped:true,vkExcluded:true,
    serverSourceOfTruth:true
  }));
}finally{await driver.close();}
