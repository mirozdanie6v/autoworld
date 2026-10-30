// Stage B: server-only verified-user advertising erasure across two databases.
// No routes, background timers, secrets or connections are created here.
// The caller must provide a durable job request and a privileged CRM CAS writer.
const TG=/^[1-9][0-9]{0,19}$/;
const PERMISSION='ads:erase';
export function createAdsCrossStoreErasure({
  privacyService,readCommittedLeads,readLeadVersion,patchLead,
  authorizeOperation,onAudit,onAlert,maxRetries=4
}={}){
  if(typeof privacyService?.eraseVerifiedTelegramUser!=='function'
    ||![readCommittedLeads,readLeadVersion,patchLead,authorizeOperation,onAudit,onAlert]
      .every(value=>typeof value==='function')
    ||!Number.isInteger(maxRetries)||maxRetries<1||maxRetries>12)
    throw new Error('ads_cross_store_erasure_dependencies_required');

  async function erase({telegramUserId,principal}={}){
    const id=String(telegramUserId??'');
    if(!TG.test(id)||typeof principal?.id!=='string'
      ||await authorizeOperation({permission:PERMISSION,principal})!==true)
      throw new Error('ads_cross_store_erasure_forbidden');
    let affected=0,attempts=0;
    try{
      // First: irrevocable ads tombstone blocks fresh attribution while CRM
      // records are being scrubbed. Repeated calls are idempotent.
      const ads=await privacyService.eraseVerifiedTelegramUser({telegramUserId:id,principal});
      if(ads.status!=='complete')throw new Error('ads_erasure_incomplete');
      // Each retry operates against the authoritative persisted CRM state.
      // Never delete a lead, payment, quote or other business record.
      for(let iteration=0;iteration<maxRetries;iteration++){
        const source=await readCommittedLeads();
        if(!Array.isArray(source))throw new Error('invalid_ads_crm_lead_reader');
        const outstanding=source.filter(lead=>lead?.clientProvider==='telegram'
          &&String(lead.clientProviderUserId||'')===id
          &&(lead.adsAttribution!==undefined&&lead.adsAttribution!==null
            ||lead.adsAttributionStatus==='lookup_unavailable'
            ||lead.adsAttributionStatus==='recovered'));
        if(!outstanding.length){
          await onAudit({operation:'ads_cross_store_erasure',status:'complete',
            actorId:principal.id,processed:affected,attempts});
          return {status:'complete',scrubbedLeads:affected,attempts};
        }
        for(const lead of outstanding){
          const version=await readLeadVersion(String(lead.id));
          if(!Number.isSafeInteger(version)||version<0)
            throw new Error('ads_crm_row_version_missing');
          const outcome=await patchLead({
            id:String(lead.id),expectedRowVersion:version,
            expectedProvider:'telegram',expectedProviderUserId:id,
            input:{adsAttribution:null,adsAttributionStatus:'erased'}
          });
          attempts++;
          if(outcome?.ok===true)affected++;
          else if(!['conflict','not_found','already_erased'].includes(outcome?.reason))
            throw new Error('ads_crm_scrub_failed');
        }
      }
      throw new Error('ads_crm_erasure_retry_exhausted');
    }catch(error){
      // No raw Telegram user ID or campaign metadata enters operational logs.
      await onAlert({code:'ads_cross_store_erasure_incomplete',severity:'critical'});
      await onAudit({operation:'ads_cross_store_erasure',status:'incomplete',
        actorId:principal.id,processed:affected,attempts});
      throw error;
    }
  }
  return {erase};
}
