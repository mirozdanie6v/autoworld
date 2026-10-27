import {createHash, createHmac, randomBytes} from 'node:crypto';

// Stage A: independent attribution domain. Nothing here registers routes,
// calls Telegram, mutates CRM leads, or connects to production resources.
const TOKEN_PATTERN=/^[A-Za-z0-9_-]{24,64}$/;
const ID_PATTERN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const TELEGRAM_ID_PATTERN=/^[1-9][0-9]{0,19}$/;
const ALLOWED_EVENTS=new Set(['miniapp_open','vehicle_view','lead_submit','manager_contact']);
const MAX_WINDOW_DAYS=90;
const MAX_FUTURE_SKEW_MS=5*60*1000;
const HASH_PATTERN=/^[a-f0-9]{64}$/;

function id(value,label,{optional=false}={}){
  if(optional&&(value===undefined||value===null||value===''))return '';
  if(typeof value!=='string'||!ID_PATTERN.test(value))throw new Error(`invalid_${label}`);
  return value;
}
function at(clock){
  const value=clock();
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('invalid_clock');
  return date;
}
function validateTelegramUserId(value){
  if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<=0))throw new Error('invalid_telegram_user_id');
  const normalized=String(value??'');
  if(!TELEGRAM_ID_PATTERN.test(normalized))throw new Error('invalid_telegram_user_id');
  return normalized;
}
function validateEventId(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(value)){
    throw new Error('invalid_event_id');
  }
  return value;
}
export function parseAdsStartPayload(value){
  if(typeof value!=='string'||!TOKEN_PATTERN.test(value))return null;
  return value;
}
export function hashAdsToken(token){
  if(!parseAdsStartPayload(token))throw new Error('invalid_ads_token');
  return createHash('sha256').update(token,'utf8').digest('hex');
}
export function createAdsSubjectKey(telegramUserId,secret){
  const userId=validateTelegramUserId(telegramUserId);
  if(typeof secret!=='string'||secret.length<32)throw new Error('ads_subject_secret_required');
  return createHmac('sha256',secret).update(`tg-user:v1:${userId}`).digest('hex');
}
export function generateAdsToken(){
  return randomBytes(24).toString('base64url'); // 192 random bits; 32 Telegram-safe chars
}
function safeTouch(touch){
  if(!touch)return null;
  return {
    campaignId:touch.campaignId,
    adId:touch.adId||null,
    creativeId:touch.creativeId||null,
    source:'Telegram Ads',
    timestamp:touch.timestamp
  };
}
function snapshot(subject,cutoff,now){
  const first=Date.parse(subject?.firstTouch?.timestamp);
  const last=Date.parse(subject?.lastTouch?.timestamp);
  if(!Number.isFinite(first)||!Number.isFinite(last)||first>last||last<cutoff||last>now+MAX_FUTURE_SKEW_MS)return null;
  if(!subject.firstTouch?.campaignId||!subject.lastTouch?.campaignId)return null;
  return {
    firstTouch:safeTouch(subject.firstTouch),
    lastTouch:safeTouch(subject.lastTouch)
  };
}
export function createAdsAttributionService({
  repository,
  subjectSecret,
  previousSubjectSecrets=[],
  clock=()=>new Date(),
  attributionWindowDays=30
}={}){
  if(!repository||['createCampaign','findCampaignByTokenHash','setCampaignTokenActive','recordTouch','readSubject','recordEvent','listEvents'].some(k=>typeof repository[k]!=='function')){
    throw new Error('ads_repository_required');
  }
  if(typeof subjectSecret!=='string'||subjectSecret.length<32)throw new Error('ads_subject_secret_required');
  if(!Array.isArray(previousSubjectSecrets)||previousSubjectSecrets.length>2
    ||previousSubjectSecrets.some(secret=>typeof secret!=='string'||secret.length<32||secret===subjectSecret)
    ||new Set(previousSubjectSecrets).size!==previousSubjectSecrets.length){
    throw new Error('invalid_ads_previous_subject_secrets');
  }
  if(!Number.isInteger(attributionWindowDays)||attributionWindowDays<1||attributionWindowDays>MAX_WINDOW_DAYS){
    throw new Error('invalid_ads_attribution_window');
  }
  const windowMs=attributionWindowDays*86400000;
  const subjectKey=userId=>createAdsSubjectKey(userId,subjectSecret);
  const allSubjectKeys=userId=>[subjectSecret,...previousSubjectSecrets]
    .map(secret=>createAdsSubjectKey(userId,secret));
  async function activeSubject(telegramUserId,now){
    for(const key of allSubjectKeys(telegramUserId)){
      const subject=await repository.readSubject(key);
      const attribution=snapshot(subject,now-windowMs,now);
      if(attribution)return {key,attribution};
    }
    return null;
  }
  async function issueCampaign({campaignId,adId='',creativeId=''}={}){
    const campaign={
      campaignId:id(campaignId,'campaign_id'),
      adId:id(adId,'ad_id',{optional:true}),
      creativeId:id(creativeId,'creative_id',{optional:true}),
      source:'Telegram Ads',
      active:true,
      createdAt:at(clock).toISOString()
    };
    const token=generateAdsToken();
    await repository.createCampaign({...campaign,tokenHash:hashAdsToken(token)});
    // The raw token is returned once. Only its hash is persisted.
    return {...campaign,token};
  }
  async function setCampaignTokenActive({tokenHash,active}={}){
    if(typeof tokenHash!=='string'||!HASH_PATTERN.test(tokenHash))throw new Error('invalid_ads_token_hash');
    if(typeof active!=='boolean')throw new Error('invalid_ads_token_active_state');
    return repository.setCampaignTokenActive({tokenHash,active});
  }
  async function recordBotStart({telegramUserId,startPayload,updateId}={}){
    validateTelegramUserId(telegramUserId);
    if(!/^[0-9]{1,20}$/.test(String(updateId??'')))throw new Error('invalid_telegram_update_id');
    const token=parseAdsStartPayload(startPayload);
    if(!token)return {status:'ignored',reason:'not_ads_payload'};
    const campaign=await repository.findCampaignByTokenHash(hashAdsToken(token));
    if(!campaign||campaign.active!==true)return {status:'ignored',reason:'unknown_or_inactive_campaign'};
    const touch={
      campaignId:campaign.campaignId,
      adId:campaign.adId||'',
      creativeId:campaign.creativeId||'',
      timestamp:at(clock).toISOString()
    };
    // During a bounded rotation overlap, continue with the existing subject
    // key. This avoids splitting one user's first/last touch history.
    const previous=await activeSubject(telegramUserId,at(clock).getTime());
    const result=await repository.recordTouch({
      eventId:`tg-start:${updateId}`,
      subjectKey:previous?.key||subjectKey(telegramUserId),
      touch
    });
    return result.blocked?{status:'ignored',reason:'erased_subject'}
      :result.recorded?{status:'recorded',campaignId:campaign.campaignId}:{status:'duplicate'};
  }
  async function getAttribution({telegramUserId}={}){
    return (await activeSubject(telegramUserId,at(clock).getTime()))?.attribution||null;
  }
  async function recordTrustedEvent({telegramUserId,eventType,eventId}={}){
    if(!ALLOWED_EVENTS.has(eventType))throw new Error('invalid_ads_event_type');
    const matched=await activeSubject(telegramUserId,at(clock).getTime());
    if(!matched)return {status:'ignored',reason:'no_active_attribution'};
    const {key,attribution}=matched;
    const result=await repository.recordEvent({
      eventId:`ads:${validateEventId(eventId)}`,
      subjectKey:key,
      eventType,
      occurredAt:at(clock).toISOString(),
      campaignId:attribution.lastTouch.campaignId,
      adId:attribution.lastTouch.adId||'',
      creativeId:attribution.lastTouch.creativeId||''
    });
    return result.blocked?{status:'ignored',reason:'erased_subject'}
      :result.recorded?{status:'recorded',attribution}:{status:'duplicate'};
  }
  // Server-originated immutable CRM snapshot, never a client-supplied payload.
  // Replays after a new /start MUST remain on the original campaign.
  async function recordTrustedSnapshotEvent({
    telegramUserId,eventType,eventId,attributionSnapshot
  }={}){
    if(!ALLOWED_EVENTS.has(eventType))throw new Error('invalid_ads_event_type');
    const key=subjectKey(telegramUserId);
    const target=attributionSnapshot?.lastTouch;
    if(!target||typeof target!=='object')throw new Error('invalid_ads_snapshot');
    const campaignId=id(target.campaignId,'campaign_id');
    const adId=id(target.adId||'','ad_id',{optional:true});
    const creativeId=id(target.creativeId||'','creative_id',{optional:true});
    const timestamp=Date.parse(target.timestamp);
    const now=at(clock).getTime();
    if(!Number.isFinite(timestamp)||timestamp>now+MAX_FUTURE_SKEW_MS
      ||timestamp<now-365*86400000)throw new Error('invalid_ads_snapshot_timestamp');
    // During HMAC rotation, prefer any existing subject key. The immutable
    // CRM snapshot controls campaign, not today's lastTouch.
    let receiptKey=key;
    for(const candidate of allSubjectKeys(telegramUserId)){
      if(await repository.readSubject(candidate)){receiptKey=candidate;break;}
    }
    const result=await repository.recordEvent({
      eventId:`ads:${validateEventId(eventId)}`,
      subjectKey:receiptKey,eventType,occurredAt:at(clock).toISOString(),
      campaignId,adId,creativeId
    });
    return result.blocked?{status:'ignored',reason:'erased_subject'}
      :result.recorded?{status:'recorded'}:{status:'duplicate'};
  }
  async function listVerifiedEvents({cursor='',limit=250}={}){
    if(typeof cursor!=='string'||cursor.length>120)throw new Error('invalid_ads_event_cursor');
    if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('invalid_ads_event_limit');
    return repository.listEvents({cursor,limit});
  }
  return {issueCampaign,setCampaignTokenActive,recordBotStart,getAttribution,recordTrustedEvent,recordTrustedSnapshotEvent,listVerifiedEvents};
}

// Test-only/in-memory adapter. Do not use for a persistent runtime.
export function createMemoryAdsAttributionRepository(){
  const campaigns=new Map(),subjects=new Map(),events=new Map(),erasureBlocks=new Map();
  return {
    async createCampaign(campaign){
      if(campaigns.has(campaign.tokenHash))throw new Error('duplicate_ads_token_hash');
      campaigns.set(campaign.tokenHash,structuredClone(campaign));
    },
    async findCampaignByTokenHash(hash){
      const row=campaigns.get(hash);
      return row?structuredClone(row):null;
    },
    async setCampaignTokenActive({tokenHash,active}){
      const existing=campaigns.get(tokenHash);
      if(!existing)return {updated:false};
      campaigns.set(tokenHash,{...existing,active});
      return {updated:true};
    },
    async recordTouch({eventId,subjectKey,touch}){
      if(erasureBlocks.has(subjectKey))return {recorded:false,blocked:true};
      if(events.has(eventId)){
        const existing=events.get(eventId);
        if(existing.subjectKey!==subjectKey)throw new Error('ads_event_id_collision');
        return {recorded:false};
      }
      const existing=subjects.get(subjectKey);
      const firstTouch=existing?.firstTouch&&existing.firstTouch.timestamp<=touch.timestamp
        ? existing.firstTouch:structuredClone(touch);
      const lastTouch=existing?.lastTouch&&existing.lastTouch.timestamp>touch.timestamp
        ? existing.lastTouch:structuredClone(touch);
      subjects.set(subjectKey,{firstTouch,lastTouch});
      events.set(eventId,{eventId,subjectKey,eventType:'bot_start',...touch,occurredAt:touch.timestamp});
      return {recorded:true};
    },
    async readSubject(key){
      const row=subjects.get(key);
      return row?structuredClone(row):null;
    },
    async recordEvent(event){
      if(erasureBlocks.has(event.subjectKey))return {recorded:false,blocked:true};
      if(events.has(event.eventId)){
        const existing=events.get(event.eventId);
        if(existing.subjectKey!==event.subjectKey||existing.eventType!==event.eventType){
          throw new Error('ads_event_id_collision');
        }
        return {recorded:false};
      }
      events.set(event.eventId,structuredClone(event));
      return {recorded:true};
    },
    async eraseSubjects({subjectKeys,batchSize=50,blockedAt=new Date().toISOString()}={}){
      let deletedSubjects=0,deletedEvents=0,hasMore=false;
      for(const key of subjectKeys){
        erasureBlocks.set(key,blockedAt);
        const affected=[...events.values()].filter(event=>event.subjectKey===key)
          .sort((a,b)=>a.eventId<b.eventId?-1:a.eventId>b.eventId?1:0);
        if(affected.length>batchSize)hasMore=true;
        for(const event of affected.slice(0,batchSize)){events.delete(event.eventId);deletedEvents++;}
        if(subjects.delete(key))deletedSubjects++;
      }
      return {deletedSubjects,deletedEvents,hasMore};
    },
    async purgeExpired({eventCutoff,subjectCutoff,batchSize=100,cursor=''}={}){
      const oldEvents=[...events.values()].filter(e=>e.occurredAt<eventCutoff).slice(0,batchSize+1);
      for(const event of oldEvents.slice(0,batchSize))events.delete(event.eventId);
      const allSubjects=[...subjects.entries()].filter(([key])=>key>cursor)
        .sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,batchSize+1);
      let removed=0,compacted=0;
      for(const [key,subject] of allSubjects.slice(0,batchSize)){
        if(subject.lastTouch.timestamp<subjectCutoff){subjects.delete(key);removed++;}
        else if(subject.firstTouch.timestamp<subjectCutoff){
          subjects.set(key,{firstTouch:structuredClone(subject.lastTouch),lastTouch:subject.lastTouch});compacted++;
        }
      }
      return {deletedEvents:Math.min(oldEvents.length,batchSize),deletedSubjects:removed,
        compactedSubjects:compacted,hasMoreEvents:oldEvents.length>batchSize,
        nextCursor:allSubjects.length>batchSize?allSubjects[batchSize-1][0]:null};
    },
    async listEvents({cursor='',limit=250}={}){
      const sorted=[...events.values()].filter(event=>event.eventId>cursor)
        .sort((a,b)=>a.eventId<b.eventId?-1:a.eventId>b.eventId?1:0);
      const result=sorted.slice(0,limit).map(event=>structuredClone(event));
      return {events:result,nextCursor:sorted.length>limit?result.at(-1).eventId:null};
    },
    // For offline tests only; hashed subject identifiers, no raw Telegram IDs.
    snapshotForTests(){return {
      campaigns:Array.from(campaigns.values()).map(x=>structuredClone(x)),
      subjects:Array.from(subjects.values()).map(x=>structuredClone(x)),
      events:Array.from(events.values()).map(x=>structuredClone(x)),
      erasureBlocks:Array.from(erasureBlocks.keys())
    };}
  };
}
