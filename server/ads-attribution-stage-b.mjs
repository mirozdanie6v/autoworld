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
    const snapshot=safeSnapshot(await service.getAttribution({telegramUserId}));
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
        const result=await service.recordTrustedEvent({
          telegramUserId,eventType:'lead_submit',eventId
        });
        if(result.status==='recorded'||result.status==='duplicate')recorded++;
        else {pending++;await onFailure({code:'ads_lead_receipt_pending',eventType:'lead_submit'});}
      }catch(error){
        pending++;
        // The authoritative CRM lead already contains the immutable attribution
        // snapshot; follow-on reconciliation must use that persisted source.
        await onFailure({code:'ads_lead_receipt_failed',eventType:'lead_submit'});
      }
    }
    return {attempted:attributed.length,recorded,pending};
  }
  return {enabled,recordBotStart,enrichLeadOperations,recordCommittedLeads};
}
