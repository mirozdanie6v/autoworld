// Replay missed conversions from the authoritative, persisted CRM.
// Idempotent event IDs let the job restart from the beginning safely.
export function createAdsLeadReconciliationJob({
  listCommittedLeads,bridge,onAudit,onAlert,persistRecoveredSnapshot=null,
  pageSize=100,maxPages=50
}={}){
  if(typeof listCommittedLeads!=='function'||!bridge?.enabled
    ||typeof bridge.reconcilePersistedLead!=='function'
    ||typeof onAudit!=='function'||typeof onAlert!=='function'
    ||(persistRecoveredSnapshot!==null&&typeof persistRecoveredSnapshot!=='function'))
    throw new Error('ads_reconciliation_dependencies_required');
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>250
    ||!Number.isInteger(maxPages)||maxPages<1||maxPages>1000)
    throw new Error('invalid_ads_reconciliation_bounds');
  async function run({authorized=false,cursor=''}={}){
    if(authorized!==true)throw new Error('ads_reconciliation_authorization_required');
    if(typeof cursor!=='string'||cursor.length>120)throw new Error('invalid_ads_reconciliation_cursor');
    let scanned=0,recorded=0,duplicates=0,ignored=0,errors=0,recovered=0;
    let current=cursor,nextCursor=null,complete=false;
    for(let page=0;page<maxPages;page++){
      const result=await listCommittedLeads({cursor:current,limit:pageSize});
      if(!result||!Array.isArray(result.leads)||result.leads.length>pageSize
        ||(result.nextCursor!==null&&typeof result.nextCursor!=='string'))
        throw new Error('invalid_ads_reconciliation_page');
      let last=current;
      for(const lead of result.leads){
        const id=String(lead?.id||'');
        if(!id||id<=last)throw new Error('invalid_ads_reconciliation_order');
        last=id;scanned++;
        try{
          const outcome=await bridge.reconcilePersistedLead(lead);
          if(outcome.recoveredSnapshot){
            // Durable CRM replay source must be repaired too. Otherwise the
            // next manager action after attribution TTL could lose its origin.
            if(!persistRecoveredSnapshot)throw new Error('ads_recovery_persistor_required');
            const saved=await persistRecoveredSnapshot(lead,outcome.recoveredSnapshot);
            if(saved?.ok!==true)throw new Error('ads_recovery_cas_failed');
            recovered++;
          }
          if(outcome.status==='recorded')recorded++;
          else if(outcome.status==='duplicate')duplicates++;
          else ignored++;
        }catch{
          errors++;
          await onAlert({code:'ads_reconciliation_lead_error'});
        }
      }
      if(result.nextCursor===null){
        complete=true;nextCursor=null;break;
      }
      if(!result.leads.length||result.nextCursor!==last)
        throw new Error('invalid_ads_reconciliation_cursor_progress');
      nextCursor=last;current=last;
    }
    const summary={scanned,recorded,duplicates,ignored,errors,recovered,complete,nextCursor};
    await onAudit({action:'ads_reconcile_committed_leads',...summary});
    if(!complete||errors)await onAlert({
      code:errors?'ads_reconciliation_incomplete_with_errors':'ads_reconciliation_more_pages',
      scanned,errors,complete
    });
    return summary;
  }
  return {run};
}
// Authorized application-side callback. Never trust client-supplied lead arrays.
export function createPersistedLeadPageReader({readAuthoritativeState}={}){
  if(typeof readAuthoritativeState!=='function')throw new Error('ads_authoritative_state_reader_required');
  return async({cursor='',limit=100}={})=>{
    if(typeof cursor!=='string'||!Number.isInteger(limit)||limit<1||limit>250)
      throw new Error('invalid_ads_authoritative_read_bounds');
    const state=await readAuthoritativeState();
    const leads=(state?.leads||[]).filter(x=>x?.id&&String(x.id)>cursor)
      .sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);
    const rows=leads.slice(0,limit);
    return {leads:rows,nextCursor:leads.length>limit?String(rows.at(-1).id):null};
  };
}
