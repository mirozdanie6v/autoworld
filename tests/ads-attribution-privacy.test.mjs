import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdsAttributionService,
  createMemoryAdsAttributionRepository,
  createAdsSubjectKey
} from '../server/ads-attribution-core.mjs';
import {
  createAdsPrivacyService,
  adsSubjectKeysForIdentity,
  ADS_RETENTION_POLICY
} from '../server/ads-attribution-privacy.mjs';

const aSecret='ads-test-subject-current-key-0123456789-ABCDEFG';
const bSecret='ads-test-subject-prior-key-0123456789-ABCDEFG';
function setup(now='2026-10-26T12:00:00Z'){
  let current=now;
  const repository=createMemoryAdsAttributionRepository();
  const service=createAdsAttributionService({
    repository,subjectSecret:aSecret,clock:()=>new Date(current)
  });
  const privacy=createAdsPrivacyService({
    repository,subjectSecrets:[aSecret,bSecret],clock:()=>new Date(current)
  });
  return {repository,service,privacy,setNow:t=>{current=t;}};
}

test('erasure removes only authorized identity and all linked events, including historical key aliases',async()=>{
  const {repository,service,privacy}=setup();
  const campaign=await service.issueCampaign({campaignId:'RU'});
  await service.recordBotStart({telegramUserId:111,startPayload:campaign.token,updateId:1});
  await service.recordBotStart({telegramUserId:222,startPayload:campaign.token,updateId:2});
  await service.recordTrustedEvent({telegramUserId:111,eventType:'lead_submit',eventId:'lead-1'});
  await assert.rejects(privacy.eraseVerifiedTelegramUser({telegramUserId:111}),/authorization_required/);
  assert.equal(repository.snapshotForTests().events.length,3);
  assert.deepEqual(await privacy.eraseVerifiedTelegramUser({telegramUserId:111,authorized:true}),{
    deletedSubjects:1,deletedEvents:2
  });
  assert.equal(await service.getAttribution({telegramUserId:111}),null);
  assert.equal(repository.snapshotForTests().events.length,1);
  assert.equal((await service.getAttribution({telegramUserId:222})).firstTouch.campaignId,'RU');
});
test('old pseudonymous identifiers remain readable through bounded dual-key rotation, then erasure removes them',async()=>{
  const repository=createMemoryAdsAttributionRepository();
  const original=createAdsAttributionService({repository,subjectSecret:bSecret,clock:()=>new Date('2026-10-26T12:00:00Z')});
  const token=(await original.issueCampaign({campaignId:'old-key'})).token;
  await original.recordBotStart({telegramUserId:100,startPayload:token,updateId:90});
  const rotated=createAdsAttributionService({
    repository,subjectSecret:aSecret,previousSubjectSecrets:[bSecret],clock:()=>new Date('2026-10-27T12:00:00Z')
  });
  assert.equal((await rotated.getAttribution({telegramUserId:100})).firstTouch.campaignId,'old-key');
  await rotated.recordTrustedEvent({telegramUserId:100,eventType:'lead_submit',eventId:'lead-after-rotate'});
  assert.equal((await rotated.recordBotStart({telegramUserId:100,startPayload:token,updateId:91})).status,'recorded');
  assert.equal(repository.snapshotForTests().subjects.length,1);
  const subjects=repository.snapshotForTests().subjects;
  assert.equal(subjects[0].firstTouch.campaignId,'old-key');
  const privacy=createAdsPrivacyService({repository,subjectSecrets:[aSecret,bSecret]});
  assert.deepEqual(await privacy.eraseVerifiedTelegramUser({telegramUserId:100,authorized:true}),{
    deletedSubjects:1,deletedEvents:3
  });
  assert.equal((await rotated.getAttribution({telegramUserId:100})),null);
  assert.notEqual(createAdsSubjectKey(100,aSecret),createAdsSubjectKey(100,bSecret));
  assert.equal(adsSubjectKeysForIdentity(100,[aSecret,bSecret]).length,2);
});
test('retention removes expired events/subjects while preserving fresh ones',async()=>{
  const {repository,service,privacy,setNow}=setup();
  const token=(await service.issueCampaign({campaignId:'RU'})).token;
  await service.recordBotStart({telegramUserId:10,startPayload:token,updateId:1});
  setNow('2027-01-27T12:00:00Z'); // > 90 days after old touch
  await service.recordBotStart({telegramUserId:20,startPayload:token,updateId:2});
  await assert.rejects(privacy.runRetentionSweep(),/authorization_required/);
  const result=await privacy.runRetentionSweep({authorized:true});
  assert.equal(result.deletedEvents,1);
  assert.equal(result.deletedSubjects,1);
  assert.equal(repository.snapshotForTests().events.length,1);
  assert.equal((await service.getAttribution({telegramUserId:20})).lastTouch.campaignId,'RU');
  assert.equal((await service.getAttribution({telegramUserId:10})),null);
});
test('retention compacts an old first-touch even when newer last-touch remains',async()=>{
  const {repository,service,privacy,setNow}=setup();
  const token=(await service.issueCampaign({campaignId:'RU'})).token;
  await service.recordBotStart({telegramUserId:10,startPayload:token,updateId:1});
  setNow('2027-01-20T12:00:00Z'); // within the 90 day retention window
  await service.recordBotStart({telegramUserId:10,startPayload:token,updateId:2});
  setNow('2027-01-27T12:00:00Z');
  const result=await privacy.runRetentionSweep({authorized:true});
  assert.equal(result.deletedEvents,1);
  assert.equal(result.compactedSubjects,1);
  assert.equal(repository.snapshotForTests().subjects.length,1);
  assert.equal(repository.snapshotForTests().subjects[0].firstTouch.timestamp,'2027-01-20T12:00:00.000Z');
});
test('privacy invalid parameters fail closed; keys never expose Telegram identity',async()=>{
  const {repository}=setup();
  assert.equal(ADS_RETENTION_POLICY.eventRetentionDays,90);
  assert.throws(()=>createAdsPrivacyService({repository,subjectSecrets:['short']}),/invalid_ads_subject_secret_ring/);
  assert.throws(()=>createAdsPrivacyService({repository,subjectSecrets:[aSecret,aSecret]}),/invalid_ads_subject_secret_ring/);
  assert.throws(()=>createAdsPrivacyService({repository,subjectSecrets:[aSecret],policy:{...ADS_RETENTION_POLICY,batchSize:99999}}),/invalid_ads_retention_policy/);
  assert.throws(()=>createAdsAttributionService({repository,subjectSecret:aSecret,previousSubjectSecrets:[aSecret]}),/invalid_ads_previous_subject_secrets/);
  assert.doesNotMatch(adsSubjectKeysForIdentity('12345',[aSecret])[0],/12345/);
});
