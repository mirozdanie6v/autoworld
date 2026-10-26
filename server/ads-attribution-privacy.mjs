import {createAdsSubjectKey} from './ads-attribution-core.mjs';

// Defaults are a technical proposal; real-data retention requires approval.
export const ADS_RETENTION_POLICY=Object.freeze({
  eventRetentionDays:90,
  subjectRetentionDays:90,
  batchSize:50,
  maxBatchesPerCall:2000
});

function secrets(value){
  if(!Array.isArray(value)||!value.length||value.length>3
    ||value.some(v=>typeof v!=='string'||v.length<32)||new Set(value).size!==value.length){
    throw new Error('invalid_ads_subject_secret_ring');
  }
  return value;
}
function timestamp(clock){
  const value=clock(),date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('invalid_ads_privacy_clock');
  return date.getTime();
}
export function adsSubjectKeysForIdentity(telegramUserId,subjectSecrets){
  return secrets(subjectSecrets).map(secret=>createAdsSubjectKey(telegramUserId,secret));
}
function principalIsValid(principal){
  return principal&&typeof principal==='object'&&typeof principal.id==='string'
    &&/^[A-Za-z0-9_.:@-]{3,128}$/.test(principal.id);
}
export function createAdsPrivacyService({
  repository,subjectSecrets,clock=()=>new Date(),
  policy=ADS_RETENTION_POLICY,authorizeOperation,onAudit=()=>{}
}={}){
  secrets(subjectSecrets);
  if(!repository||typeof repository.eraseSubjects!=='function'||typeof repository.purgeExpired!=='function')
    throw new Error('ads_privacy_repository_required');
  if(typeof authorizeOperation!=='function')throw new Error('ads_operation_authorizer_required');
  if(typeof onAudit!=='function')throw new Error('ads_audit_handler_required');
  const {eventRetentionDays,subjectRetentionDays,batchSize,maxBatchesPerCall}=policy;
  if(!Number.isInteger(eventRetentionDays)||eventRetentionDays<1||eventRetentionDays>365
    ||!Number.isInteger(subjectRetentionDays)||subjectRetentionDays<1||subjectRetentionDays>365
    ||!Number.isInteger(batchSize)||batchSize<1||batchSize>100
    ||!Number.isInteger(maxBatchesPerCall)||maxBatchesPerCall<1||maxBatchesPerCall>10000)
    throw new Error('invalid_ads_retention_policy');
  const audit=async payload=>{await onAudit({...payload,at:new Date(timestamp(clock)).toISOString()});};
  async function authorize(permission,principal){
    if(!principalIsValid(principal)||await authorizeOperation({permission,principal})!==true)
      throw new Error('ads_operation_forbidden');
  }
  async function eraseVerifiedTelegramUser({telegramUserId,principal}={}){
    await authorize('ads:erase',principal);
    const subjectKeys=adsSubjectKeysForIdentity(telegramUserId,subjectSecrets);
    const op='erasure';
    let deletedEvents=0,deletedSubjects=0;
    try{
      for(let n=0;n<maxBatchesPerCall;n++){
        const result=await repository.eraseSubjects({
          subjectKeys,batchSize,blockedAt:new Date(timestamp(clock)).toISOString()
        });
        deletedEvents+=result.deletedEvents;
        deletedSubjects+=result.deletedSubjects;
        if(!result.hasMore){
          const outcome={status:'complete',deletedSubjects,deletedEvents,batches:n+1};
          await audit({operation:op,outcome:'success',actorId:principal.id,...outcome});
          return outcome;
        }
      }
      const incomplete={status:'incomplete',deletedSubjects,deletedEvents,batches:maxBatchesPerCall};
      await audit({operation:op,outcome:'incomplete',actorId:principal.id,...incomplete});
      return incomplete;
    }catch(error){
      await audit({operation:op,outcome:'failure',actorId:principal.id,errorCode:'ads_erasure_failed'});
      throw error;
    }
  }
  async function runRetentionSweep({principal,cursor=''}={}){
    await authorize('ads:retention',principal);
    if(typeof cursor!=='string'||cursor.length>120)throw new Error('invalid_ads_retention_cursor');
    const now=timestamp(clock),day=86_400_000;
    return repository.purgeExpired({
      eventCutoff:new Date(now-eventRetentionDays*day).toISOString(),
      subjectCutoff:new Date(now-subjectRetentionDays*day).toISOString(),
      batchSize,cursor
    });
  }
  // Scheduler-agnostic full maintenance cycle. Host should call from an
  // authenticated scheduled worker and alert on incomplete or failed cycles.
  async function runRetentionCycle({principal}={}){
    await authorize('ads:retention',principal);
    const total={deletedEvents:0,deletedSubjects:0,compactedSubjects:0,batches:0};
    let cursor='';
    try{
      for(let n=0;n<maxBatchesPerCall;n++){
        const result=await runRetentionSweep({principal,cursor});
        total.deletedEvents+=result.deletedEvents;
        total.deletedSubjects+=result.deletedSubjects;
        total.compactedSubjects+=result.compactedSubjects;
        total.batches++;
        if(result.nextCursor===null&&!result.hasMoreEvents){
          await audit({operation:'retention',outcome:'success',actorId:principal.id,...total});
          return {...total,status:'complete'};
        }
        // Start another page at the first subject whenever expired events
        // remain; old events are fetched in stable timestamp key order.
        cursor=result.nextCursor||'';
      }
      await audit({operation:'retention',outcome:'incomplete',actorId:principal.id,...total});
      return {...total,status:'incomplete'};
    }catch(error){
      await audit({operation:'retention',outcome:'failure',actorId:principal.id,errorCode:'ads_retention_failed',...total});
      throw error;
    }
  }
  return {eraseVerifiedTelegramUser,runRetentionSweep,runRetentionCycle,policy:Object.freeze({...policy})};
}
