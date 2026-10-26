import {createAdsSubjectKey} from './ads-attribution-core.mjs';

export const ADS_RETENTION_POLICY=Object.freeze({
  eventRetentionDays:90,
  subjectRetentionDays:90,
  maxErasureEventsPerSubject:1000,
  batchSize:100
});

function secrets(value){
  if(!Array.isArray(value)||value.length===0||value.length>3
    ||value.some(v=>typeof v!=='string'||v.length<32)||new Set(value).size!==value.length){
    throw new Error('invalid_ads_subject_secret_ring');
  }
  return value;
}
function timestamp(clock){
  const now=clock();
  const date=now instanceof Date?now:new Date(now);
  if(!Number.isFinite(date.getTime()))throw new Error('invalid_ads_privacy_clock');
  return date.getTime();
}
export function adsSubjectKeysForIdentity(telegramUserId,subjectSecrets){
  return secrets(subjectSecrets).map(secret=>createAdsSubjectKey(telegramUserId,secret));
}

// No public endpoint and no automatic schedule: the authenticated host application
// must explicitly authorize erasure and supply a verified Telegram subject.
export function createAdsPrivacyService({
  repository,
  subjectSecrets,
  clock=()=>new Date(),
  policy=ADS_RETENTION_POLICY
}={}){
  secrets(subjectSecrets);
  if(!repository||typeof repository.eraseSubjects!=='function'||typeof repository.purgeExpired!=='function'){
    throw new Error('ads_privacy_repository_required');
  }
  const {eventRetentionDays,subjectRetentionDays,batchSize,maxErasureEventsPerSubject}=policy;
  if(!Number.isInteger(eventRetentionDays)||eventRetentionDays<1||eventRetentionDays>365
    ||!Number.isInteger(subjectRetentionDays)||subjectRetentionDays<1||subjectRetentionDays>365
    ||!Number.isInteger(batchSize)||batchSize<1||batchSize>500
    ||!Number.isInteger(maxErasureEventsPerSubject)||maxErasureEventsPerSubject<1||maxErasureEventsPerSubject>5000){
    throw new Error('invalid_ads_retention_policy');
  }
  async function eraseVerifiedTelegramUser({telegramUserId,authorized=false}={}){
    if(authorized!==true)throw new Error('ads_erasure_authorization_required');
    const subjectKeys=adsSubjectKeysForIdentity(telegramUserId,subjectSecrets);
    const result=await repository.eraseSubjects({subjectKeys,maxEventsPerSubject:maxErasureEventsPerSubject});
    return {deletedSubjects:result.deletedSubjects,deletedEvents:result.deletedEvents};
  }
  async function runRetentionSweep({authorized=false,cursor=''}={}){
    if(authorized!==true)throw new Error('ads_retention_authorization_required');
    if(typeof cursor!=='string'||cursor.length>120)throw new Error('invalid_ads_retention_cursor');
    const now=timestamp(clock);
    const day=86_400_000;
    return repository.purgeExpired({
      eventCutoff:new Date(now-eventRetentionDays*day).toISOString(),
      subjectCutoff:new Date(now-subjectRetentionDays*day).toISOString(),
      batchSize,
      cursor
    });
  }
  return {eraseVerifiedTelegramUser,runRetentionSweep,policy:Object.freeze({...policy})};
}
