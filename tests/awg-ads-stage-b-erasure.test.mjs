import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdsCrossStoreErasure} from '../server/ads-stage-b-cross-store-erasure.mjs';

const user='1234567',principal={id:'privacy-maintenance-staging'};
function harness({staleOnce=false,failPatch=false,deny=false,adsIncomplete=false}={}){
  const leads=[
    {id:'L-tg-a',clientProvider:'telegram',clientProviderUserId:user,
      adsAttribution:{source:'Telegram Ads',lastTouch:{campaignId:'A'}},name:'Test',payments:[{id:'pay-1'}]},
    {id:'L-tg-b',clientProvider:'telegram',clientProviderUserId:user,
      adsAttributionStatus:'lookup_unavailable',name:'Other'},
    {id:'L-vk',clientProvider:'vk',clientProviderUserId:user,
      adsAttribution:{source:'Telegram Ads',lastTouch:{campaignId:'Never touch VK'}}},
    {id:'L-tg-other',clientProvider:'telegram',clientProviderUserId:'999',
      adsAttribution:{source:'Telegram Ads',lastTouch:{campaignId:'Other'}}}
  ];
  const versions=new Map(leads.map(x=>[x.id,1])), audits=[],alerts=[],writes=[];
  let didConflict=false,privacyCalls=0;
  const job=createAdsCrossStoreErasure({
    privacyService:{eraseVerifiedTelegramUser:async()=>{privacyCalls++;return{
      status:adsIncomplete?'incomplete':'complete'};}},
    readCommittedLeads:async()=>structuredClone(leads),
    readLeadVersion:async id=>versions.get(id)??null,
    patchLead:async({id,expectedRowVersion,expectedProvider,expectedProviderUserId,input})=>{
      writes.push(id);
      if(failPatch)return {ok:false,reason:'server_failure'};
      if(staleOnce&&!didConflict){didConflict=true;versions.set(id,versions.get(id)+1);
        return {ok:false,reason:'conflict'};}
      const row=leads.find(x=>x.id===id);
      if(!row||versions.get(id)!==expectedRowVersion)return {ok:false,reason:'conflict'};
      if(row.clientProvider!==expectedProvider||row.clientProviderUserId!==expectedProviderUserId)
        throw Error('wrong_subject');
      Object.assign(row,input);
      versions.set(id,expectedRowVersion+1);
      return {ok:true};
    },
    authorizeOperation:async()=>!deny,
    onAudit:async x=>audits.push(x),
    onAlert:async x=>alerts.push(x),
    maxRetries:4
  });
  return {job,leads,audits,alerts,writes,privacyCalls:()=>privacyCalls};
}
test('erases only verified Telegram ad metadata, never business leads or VK',async()=>{
  const {job,leads,writes,audits}=harness();
  assert.deepEqual(await job.erase({telegramUserId:user,principal}),
    {status:'complete',scrubbedLeads:2,attempts:2});
  assert.equal(writes.length,2);
  assert.equal(leads.length,4);
  assert.equal(leads[0].name,'Test');
  assert.deepEqual(leads[0].payments,[{id:'pay-1'}]);
  assert.equal(leads[0].adsAttribution,null);
  assert.equal(leads[0].adsAttributionStatus,'erased');
  assert.equal(leads[1].adsAttributionStatus,'erased');
  assert.equal(leads[2].adsAttribution.lastTouch.campaignId,'Never touch VK');
  assert.equal(leads[3].adsAttribution.lastTouch.campaignId,'Other');
  assert.equal(audits[0].status,'complete');
  assert.equal(JSON.stringify(audits).includes(user),false);
  assert.deepEqual(await job.erase({telegramUserId:user,principal}),
    {status:'complete',scrubbedLeads:0,attempts:0});
});
test('stale row version is retried after read and no other record is corrupted',async()=>{
  const {job,leads,alerts}=harness({staleOnce:true});
  const result=await job.erase({telegramUserId:user,principal});
  assert.equal(result.status,'complete');
  assert.equal(leads[0].adsAttribution,null);
  assert.deepEqual(alerts,[]);
});
test('forbidden caller cannot trigger cross-store deletion',async()=>{
  const {job,leads}=harness({deny:true});
  await assert.rejects(job.erase({telegramUserId:user,principal}),/forbidden/);
  assert.notEqual(leads[0].adsAttribution,null);
  await assert.rejects(job.erase({telegramUserId:'fake',principal}),/forbidden/);
});
test('failed ads tombstone or CRM CAS emits critical alert and fails closed',async()=>{
  for(const opts of [{adsIncomplete:true},{failPatch:true}]){
    const {job,leads,alerts,audits}=harness(opts);
    await assert.rejects(job.erase({telegramUserId:user,principal}));
    assert.equal(alerts[0].severity,'critical');
    assert.equal(audits[0].status,'incomplete');
    assert.ok(leads[0].adsAttribution);
  }
});
