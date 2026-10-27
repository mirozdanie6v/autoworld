// Explicit server-only, staging-gated privacy operation.
// Erase attribution receipts first (creates a durable HMAC tombstone), then
// CAS-scrub only advertising metadata from the authoritative CRM lead.
// On partial failure the operator must retry; no success is reported early.
const USER_ID=/^[1-9][0-9]{0,19}$/;
const LEAD_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export function createAdsCrmPrivacyErasure({
  privacyService,readAuthoritativeState,getLeadVersion,patchLead,
  onAudit,onAlert,maxPasses=4,maxLeads=1000
}={}){
  if(typeof privacyService?.eraseVerifiedTelegramUser!=='function'
    ||typeof readAuthoritativeState!=='function'
    ||typeof getLeadVersion!=='function'||typeof patchLead!=='function'
    ||typeof onAudit!=='function'||typeof onAlert!=='function'
    ||!Number.isInteger(maxPasses)||maxPasses<1||maxPasses>10
    ||!Number.isInteger(maxLeads)||maxLeads<1||maxLeads>10000)
    throw new Error('ads_crm_erasure_dependencies_invalid');

  async function erase({telegramUserId,principal}={}){
    const subject=String(telegramUserId??'');
    if(!USER_ID.test(subject))throw new Error('invalid_ads_erasure_subject');
    // The privacy service verifies principal and applies the HMAC block before
    // deleting events. A nonauthorized principal cannot reach the CRM scrub.
    const receipt=await privacyService.eraseVerifiedTelegramUser({
      telegramUserId:subject,principal
    });
    if(receipt?.status!=='complete'){
      await onAlert({code:'ads_cross_store_erasure_ads_incomplete',severity:'high'});
      throw new Error('ads_cross_store_erasure_ads_incomplete');
    }
    let scrubbed=0;
    for(let pass=0;pass<maxPasses;pass++){
      const state=await readAuthoritativeState();
      if(!Array.isArray(state?.leads)||state.leads.length>maxLeads){
        await onAlert({code:'ads_crm_erasure_scope_invalid',severity:'high'});
        throw new Error('ads_crm_erasure_scope_invalid');
      }
      const affected=state.leads.filter(lead=>
        lead?.clientProvider==='telegram'
        &&String(lead.clientProviderUserId||'')===subject
        &&(lead.adsAttribution!=null||['lookup_unavailable','recovered'].includes(lead.adsAttributionStatus)));
      if(!affected.length){
        await onAudit({operation:'ads_cross_store_erasure',outcome:'complete',
          scrubbed,pass:pass+1,adsDeletedEvents:receipt.deletedEvents});
        return {status:'complete',scrubbed,adsDeletedEvents:receipt.deletedEvents};
      }
      let conflict=false;
      for(const lead of affected){
        const id=String(lead.id||'');
        if(!LEAD_ID.test(id))throw new Error('ads_crm_erasure_invalid_lead');
        const version=await getLeadVersion(id);
        if(!Number.isInteger(version)||version<1){
          conflict=true;continue;
        }
        const result=await patchLead({
          id,baseRowVersion:version,
          input:{adsAttribution:null,adsAttributionStatus:'erased'}
        });
        if(result?.status===200){scrubbed++;continue;}
        if(result?.status===409||result?.status===404){conflict=true;continue;}
        await onAlert({code:'ads_crm_erasure_patch_failed',severity:'high'});
        throw new Error('ads_crm_erasure_patch_failed');
      }
      if(!conflict)continue; // Re-read before declaring completion.
    }
    await onAlert({code:'ads_crm_erasure_retry_exhausted',severity:'high'});
    await onAudit({operation:'ads_cross_store_erasure',
      outcome:'incomplete',scrubbed});
    throw new Error('ads_crm_erasure_retry_exhausted');
  }
  return {erase};
}
