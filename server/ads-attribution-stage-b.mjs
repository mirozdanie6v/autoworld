// Stage B server-only seam. Never read a campaign from client-supplied form,
// URL or Telegram initDataUnsafe; access must come from verified server auth.
import {createHash} from 'node:crypto';

const CREATE_LEAD=operation=>operation?.resource==='lead'&&operation?.operation==='create'
  &&typeof operation?.id==='string'&&operation.id.length>0;
export function verifiedAdsTelegramIdentity(access){
  if(access?.authenticated!==true||access?.authType!=='telegram'||access?.role!=='client')return null;
  const id=String(access?.user?.id??'');
  return /^[1-9][0-9]{0,19}$/.test(id)?id:null;
}
function safeSnapshot(attribution){
  if(!attribution?.firstTouch?.campaignId||!attribution?.lastTouch?.campaignId)return null;
  const touch=value=>({
    campaignId:String(value.campaignId),
    adId:value.adId?String(value.adId):null,
    creativeId:value.creativeId?String(value.creativeId):null,
    timestamp:String(value.timestamp)
  });
  return {source:'Telegram Ads',firstTouch:touch(attribution.firstTouch),
    lastTouch:touch(attribution.lastTouch)};
}
export function createAdsStageBBridge({enabled=false,service,onFailure}={}){
  if(typeof enabled!=='boolean')throw new Error('invalid_ads_stage_b_flag');
  if(enabled&&(!service||typeof service.recordBotStart!=='function'
      ||typeof service.getAttribution!=='function'||typeof service.recordTrustedEvent!=='function'))
    throw new Error('ads_stage_b_service_required');
  if(enabled&&typeof onFailure!=='function')throw new Error('ads_stage_b_failure_sink_required');

  const warn=async data=>{try{await onFailure(data)}catch{/* audit sink cannot break a saved lead */}};
  async function recordBotStart(payload){
    if(!enabled)return {status:'disabled'};
    // Called only after the Telegram webhook secret is verified by the host.
    // In strict mode any storage error must propagate to HTTP 503 / Telegram retry.
    return service.recordBotStart(payload);
  }
  async function enrichLeadOperations(operations,access){
    if(!enabled)return operations;
    const telegramUserId=verifiedAdsTelegramIdentity(access);
    if(!telegramUserId||!operations.some(CREATE_LEAD))return operations;
    let snapshot=null;
    try{
      snapshot=safeSnapshot(await service.getAttribution({telegramUserId}));
    }catch(error){
      // Never turn a working client request into a failed request because the
      // separate advertising database is temporarily unavailable.
      await warn({code:'ads_snapshot_unavailable',eventType:'lead_create'});
      // Durable, server-owned marker survives CRM commit. Reconciliation will
      // use only verified bot touches AS OF clientSubmittedAt, never today.
      return operations.map(operation=>CREATE_LEAD(operation)
        ? {...operation,input:{...operation.input,
            adsAttributionStatus:'lookup_unavailable'}}
        : operation);
    }
    if(!snapshot)return operations;
    // Never modify any original operation or mutate a manager/VK request.
    return operations.map(operation=>CREATE_LEAD(operation)
      ? {...operation,input:{...operation.input,adsAttribution:snapshot}}
      : operation);
  }
  async function recordCommittedLeads(operations,access,{committed=false}={}){
    if(!enabled||!committed)return {attempted:0,recorded:0,pending:0};
    const telegramUserId=verifiedAdsTelegramIdentity(access);
    if(!telegramUserId)return {attempted:0,recorded:0,pending:0};
    const attributed=(operations||[]).filter(operation=>CREATE_LEAD(operation)
      &&operation.input?.adsAttribution?.source==='Telegram Ads');
    let recorded=0,pending=0;
    for(const operation of attributed){
      const eventId='lead_'+createHash('sha256').update(operation.id).digest('hex');
      try{
        const record=typeof service.recordTrustedSnapshotEvent==='function'
          ? service.recordTrustedSnapshotEvent({
              telegramUserId,eventType:'lead_submit',eventId,
              attributionSnapshot:operation.input.adsAttribution
            })
          : service.recordTrustedEvent({telegramUserId,eventType:'lead_submit',eventId});
        const result=await record;
        if(result.status==='recorded'||result.status==='duplicate')recorded++;
        else {pending++;await warn({code:'ads_lead_receipt_pending',eventType:'lead_submit'});}
      }catch(error){
        pending++;
        // The authoritative CRM lead already contains the immutable attribution
        // snapshot; follow-on reconciliation must use that persisted source.
        await warn({code:'ads_lead_receipt_failed',eventType:'lead_submit'});
      }
    }
    return {attempted:attributed.length,recorded,pending};
  }
  async function recordMiniAppEvent({access,eventType,carId='',catalog=[]}={}){
    if(!enabled)return {status:'disabled'};
    const telegramUserId=verifiedAdsTelegramIdentity(access);
    if(!telegramUserId)return {status:'forbidden'};
    if(!['miniapp_open','vehicle_detail_click'].includes(eventType))
      throw new Error('invalid_ads_miniapp_event_type');
    if(eventType==='vehicle_detail_click'){
      if(typeof carId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(carId)
        ||!Array.isArray(catalog)||!catalog.some(car=>car?.active!==false&&String(car?.id)===carId)){
        return {status:'ignored',reason:'vehicle_not_in_current_catalog'};
      }
    }else if(carId!==''){
      throw new Error('invalid_ads_miniapp_open_payload');
    }
    // One event per verified user, event type, vehicle and UTC day.
    // Raw user ID is hashed, not persisted as an event ID.
    const day=new Date().toISOString().slice(0,10);
    const eventId='mini_'+createHash('sha256').update(JSON.stringify([
      telegramUserId,eventType,carId,day
    ])).digest('hex');
    return service.recordTrustedEvent({telegramUserId,eventType,eventId});
  }
  // A persisted lead (not a browser request) is a durable replay source:
  // reprocess after crashes and never attribute it to a newer campaign.
  async function reconcilePersistedLead(lead){
    if(!enabled)return {status:'disabled'};
    const leadId=String(lead?.id||'');
    const telegramUserId=String(lead?.clientProviderUserId||lead?.telegramUserId||'');
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(leadId)
      ||lead?.clientProvider!=='telegram'
      ||!/^[1-9][0-9]{0,19}$/.test(telegramUserId)){
      return {status:'ignored',reason:'not_verified_telegram_ads_lead'};
    }
    let campaignSnapshot=lead?.adsAttribution;
    if(campaignSnapshot?.source!=='Telegram Ads'
      ||!campaignSnapshot.lastTouch?.campaignId){
      if(lead?.adsAttributionStatus!=='lookup_unavailable')
        return {status:'ignored',reason:'not_attributed'};
      // Only immutable, SERVER-written CRM timestamp is admissible.
      const submitted=String(lead.clientSubmittedAt||'');
      if(!Number.isFinite(Date.parse(submitted)))
        return {status:'ignored',reason:'unrecoverable_missing_server_timestamp'};
      if(typeof service.getAttributionAtTime!=='function')
        throw new Error('ads_as_of_recovery_required');
      const historical=await service.getAttributionAtTime({
        telegramUserId,asOf:submitted
      });
      campaignSnapshot=safeSnapshot(historical);
      if(!campaignSnapshot)return {status:'ignored',reason:'no_verified_historical_touch'};
    }
    const eventId='lead_'+createHash('sha256').update(leadId).digest('hex');
    if(typeof service.recordTrustedSnapshotEvent!=='function')
      throw new Error('ads_snapshot_event_recorder_required');
    const outcome=await service.recordTrustedSnapshotEvent({
      telegramUserId,eventType:'lead_submit',eventId,
      attributionSnapshot:campaignSnapshot
    });
    // firstManagerActionAt is set by the existing server-controlled
    // manager-claim policy. Client-reported "contacts" never count.
    if(lead.firstManagerActionAt&&Number.isFinite(Date.parse(lead.firstManagerActionAt))){
      const contactEventId='manager_action_'+createHash('sha256').update(leadId).digest('hex');
      await service.recordTrustedSnapshotEvent({
        telegramUserId,eventType:'first_manager_action',eventId:contactEventId,
        attributionSnapshot:campaignSnapshot
      });
    }
    return outcome;
  }
  return {enabled,recordBotStart,enrichLeadOperations,recordCommittedLeads,reconcilePersistedLead,recordMiniAppEvent};
}
