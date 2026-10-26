import {createHash, createHmac, randomBytes} from 'node:crypto';

// Stage A: independent attribution domain. Nothing here registers routes,
// calls Telegram, mutates CRM leads, or connects to production resources.
const TOKEN_PATTERN=/^[A-Za-z0-9_-]{24,64}$/;
const ID_PATTERN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const TELEGRAM_ID_PATTERN=/^[1-9][0-9]{0,19}$/;
const ALLOWED_EVENTS=new Set(['miniapp_open','vehicle_view','lead_submit','manager_contact']);
const MAX_WINDOW_DAYS=90;

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
function snapshot(subject,cutoff){
  if(!subject||Date.parse(subject.lastTouch?.timestamp)<cutoff)return null;
  return {
    firstTouch:safeTouch(subject.firstTouch),
    lastTouch:safeTouch(subject.lastTouch)
  };
}
export function createAdsAttributionService({
  repository,
  subjectSecret,
  clock=()=>new Date(),
  attributionWindowDays=30
}={}){
  if(!repository||['createCampaign','findCampaignByTokenHash','recordTouch','readSubject','recordEvent'].some(k=>typeof repository[k]!=='function')){
    throw new Error('ads_repository_required');
  }
  if(typeof subjectSecret!=='string'||subjectSecret.length<32)throw new Error('ads_subject_secret_required');
  if(!Number.isInteger(attributionWindowDays)||attributionWindowDays<1||attributionWindowDays>MAX_WINDOW_DAYS){
    throw new Error('invalid_ads_attribution_window');
  }
  const windowMs=attributionWindowDays*86400000;
  const subjectKey=userId=>createAdsSubjectKey(userId,subjectSecret);
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
    const result=await repository.recordTouch({
      eventId:`tg-start:${updateId}`,
      subjectKey:subjectKey(telegramUserId),
      touch
    });
    return result.recorded
      ? {status:'recorded',campaignId:campaign.campaignId}
      : {status:'duplicate'};
  }
  async function getAttribution({telegramUserId}={}){
    const subject=await repository.readSubject(subjectKey(telegramUserId));
    return snapshot(subject,at(clock).getTime()-windowMs);
  }
  async function recordTrustedEvent({telegramUserId,eventType,eventId}={}){
    if(!ALLOWED_EVENTS.has(eventType))throw new Error('invalid_ads_event_type');
    const key=subjectKey(telegramUserId);
    const subject=await repository.readSubject(key);
    const attribution=snapshot(subject,at(clock).getTime()-windowMs);
    if(!attribution)return {status:'ignored',reason:'no_active_attribution'};
    const result=await repository.recordEvent({
      eventId:`ads:${validateEventId(eventId)}`,
      subjectKey:key,
      eventType,
      occurredAt:at(clock).toISOString(),
      campaignId:attribution.lastTouch.campaignId,
      adId:attribution.lastTouch.adId||'',
      creativeId:attribution.lastTouch.creativeId||''
    });
    return result.recorded
      ? {status:'recorded',attribution}
      : {status:'duplicate'};
  }
  return {issueCampaign,recordBotStart,getAttribution,recordTrustedEvent};
}

// Test-only/in-memory adapter. Do not use for a persistent runtime.
export function createMemoryAdsAttributionRepository(){
  const campaigns=new Map(),subjects=new Map(),events=new Map();
  return {
    async createCampaign(campaign){
      if(campaigns.has(campaign.tokenHash))throw new Error('duplicate_ads_token_hash');
      campaigns.set(campaign.tokenHash,structuredClone(campaign));
    },
    async findCampaignByTokenHash(hash){
      const row=campaigns.get(hash);
      return row?structuredClone(row):null;
    },
    async recordTouch({eventId,subjectKey,touch}){
      if(events.has(eventId))return {recorded:false};
      const existing=subjects.get(subjectKey);
      const firstTouch=existing?.firstTouch&&existing.firstTouch.timestamp<=touch.timestamp
        ? existing.firstTouch:structuredClone(touch);
      const lastTouch=existing?.lastTouch&&existing.lastTouch.timestamp>touch.timestamp
        ? existing.lastTouch:structuredClone(touch);
      subjects.set(subjectKey,{firstTouch,lastTouch});
      events.set(eventId,{eventId,subjectKey,eventType:'bot_start',...touch});
      return {recorded:true};
    },
    async readSubject(key){
      const row=subjects.get(key);
      return row?structuredClone(row):null;
    },
    async recordEvent(event){
      if(events.has(event.eventId))return {recorded:false};
      events.set(event.eventId,structuredClone(event));
      return {recorded:true};
    },
    // For offline tests only; hashed subject identifiers, no raw Telegram IDs.
    snapshotForTests(){return {
      campaigns:Array.from(campaigns.values()).map(x=>structuredClone(x)),
      subjects:Array.from(subjects.values()).map(x=>structuredClone(x)),
      events:Array.from(events.values()).map(x=>structuredClone(x))
    };}
  };
}
