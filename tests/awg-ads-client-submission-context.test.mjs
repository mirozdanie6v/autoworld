import test from 'node:test';
import assert from 'node:assert/strict';
import {clientSubmissionAccess} from '../server/ads-client-submission-context.mjs';
import {createAdsStageBBridge} from '../server/ads-attribution-stage-b.mjs';
import {createAdsAttributionService,createMemoryAdsAttributionRepository} from '../server/ads-attribution-core.mjs';
const staff={role:'admin',authenticated:true,authType:'telegram',apiKey:false,user:{id:'999000001'},identity:{provider:'telegram',id:'999000001',key:'telegram:999000001'}};
const own=()=>[{resource:'lead',operation:'create',id:'L-SELF',input:{clientCreated:true,name:'QA',contact:'@synthetic',model:'Test'}},{resource:'note',operation:'create',leadId:'L-SELF',input:{text:'Created'}}];
test('own customer form preserves verified staff identity but uses client validation',()=>{
  const result=clientSubmissionAccess(own(),staff);
  assert.equal(result.role,'client');assert.strictEqual(result.user,staff.user);
  assert.strictEqual(result.identity,staff.identity);assert.equal(staff.role,'admin');
});
test('staff manual, mixed operations, API keys, VK and anonymous identities remain excluded',()=>{
  const manual=own();manual[0].input.clientCreated=false;
  assert.strictEqual(clientSubmissionAccess(manual,staff),staff);
  for(const ops of [[...own(),{resource:'lead',operation:'patch',id:'OTHER',input:{}}],[...own(),{resource:'note',operation:'create',leadId:'OTHER',input:{}}],[],[...own(),own()[0]]])assert.strictEqual(clientSubmissionAccess(ops,staff),staff);
  for(const access of [{...staff,apiKey:true},{...staff,authType:'api-key'},{...staff,authType:'vk-web'},{...staff,authenticated:false},{...staff,user:{id:'invalid'}}])assert.strictEqual(clientSubmissionAccess(own(),access),access);
});
test('self-service staff request receives only the campaign recorded by a verified bot start',async()=>{
  const repository=createMemoryAdsAttributionRepository();
  const service=createAdsAttributionService({repository,subjectSecret:'isolated-staging-test-subject-secret-123456'});
  const bridge=createAdsStageBBridge({enabled:true,service,onFailure:async()=>{}});
  const campaign=await service.issueCampaign({campaignId:'QA-SELF',adId:'QA-AD',creativeId:'QA-TEXT'});
  await bridge.recordBotStart({telegramUserId:staff.user.id,startPayload:campaign.token,updateId:'999000001'});
  const operations=own(),effective=clientSubmissionAccess(operations,staff);
  const enriched=await bridge.enrichLeadOperations(operations,effective);
  assert.equal(enriched[0].input.adsAttribution.lastTouch.campaignId,'QA-SELF');
  assert.equal(enriched[0].input.adsAttribution.lastTouch.adId,'QA-AD');
  assert.equal((await bridge.recordCommittedLeads(enriched,effective,{committed:true})).recorded,1);
  assert.equal(repository.snapshotForTests().events.filter(e=>e.eventType==='lead_submit').length,1);
  assert.strictEqual(await bridge.enrichLeadOperations(operations,staff),operations);
});
test('self-service form without a recorded advertising start is not assigned a campaign',async()=>{
  const service=createAdsAttributionService({repository:createMemoryAdsAttributionRepository(),subjectSecret:'isolated-staging-test-subject-secret-123456'});
  const bridge=createAdsStageBBridge({enabled:true,service,onFailure:async()=>{}});
  const operations=own();
  assert.strictEqual(await bridge.enrichLeadOperations(operations,clientSubmissionAccess(operations,staff)),operations);
});
