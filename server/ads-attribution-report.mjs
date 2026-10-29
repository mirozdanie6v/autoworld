// Read-only statistics built exclusively from verified server receipts.
// Paid clicks, impressions and spend require separately verified platform evidence.
const TYPES={
  bot_start:'botStarts',
  miniapp_open:'miniappOpens',
  vehicle_view:'vehicleViews',
  vehicle_detail_click:'vehicleDetailClicks',
  lead_submit:'leadSubmissions',
  manager_contact:'managerContacts',
  first_manager_action:'managerActions'
};
const CAMPAIGN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
function createRow(campaignId){
  return {campaignId,botStarts:0,uniqueBotUsers:0,miniappOpens:0,
    vehicleViews:0,vehicleDetailClicks:0,leadSubmissions:0,
    managerContacts:0,managerActions:0,
    paidClicks:null,impressions:null,verifiedSpend:null,costPerLead:null};
}
function accumulator(verifiedSpend=[]){
  const rows=new Map(),seen=new Map(),users=new Map();
  const rowFor=campaignId=>{
    if(typeof campaignId!=='string'||!CAMPAIGN.test(campaignId))
      throw new Error('invalid_ads_report_campaign');
    if(!rows.has(campaignId))rows.set(campaignId,createRow(campaignId));
    return rows.get(campaignId);
  };
  function add(event,{orderedUnique=false}={}){
    const {eventId,eventType,campaignId,subjectKey}=event||{};
    if(typeof eventId!=='string'||!eventId
      ||typeof subjectKey!=='string'||!/^[a-f0-9]{64}$/.test(subjectKey)
      ||!TYPES[eventType])throw new Error('invalid_ads_reporting_event');
    if(!orderedUnique){
      const identity=`${campaignId}:${eventType}:${subjectKey}`;
      const previous=seen.get(eventId);
      if(previous!==undefined){
        if(previous!==identity)throw new Error('ads_report_event_id_collision');
        return;
      }
      seen.set(eventId,identity);
    }
    const row=rowFor(campaignId);
    row[TYPES[eventType]]++;
    if(eventType==='bot_start'){
      if(!users.has(campaignId))users.set(campaignId,new Set());
      users.get(campaignId).add(subjectKey);
    }
  }
  function finish(){
    for(const [campaignId,keys] of users)rows.get(campaignId).uniqueBotUsers=keys.size;
    for(const spend of verifiedSpend){
      const {campaignId,currency,amount,verified}=spend||{};
      const row=rowFor(campaignId);
      if(verified!==true||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)
        ||typeof amount!=='number'||!Number.isFinite(amount)||amount<0)
        throw new Error('unverified_or_invalid_ads_spend');
      if(row.verifiedSpend)throw new Error('duplicate_ads_spend_campaign');
      row.verifiedSpend={currency,amount};
    }
    for(const row of rows.values()){
      if(row.verifiedSpend&&row.leadSubmissions>0)
        row.costPerLead={currency:row.verifiedSpend.currency,
          amount:row.verifiedSpend.amount/row.leadSubmissions};
    }
    return [...rows.values()].sort((a,b)=>a.campaignId.localeCompare(b.campaignId));
  }
  return {add,finish};
}
export function summarizeAdsCampaigns({events=[],verifiedSpend=[]}={}){
  if(!Array.isArray(events)||!Array.isArray(verifiedSpend))
    throw new Error('invalid_ads_reporting_input');
  const aggregate=accumulator(verifiedSpend);
  for(const event of events)aggregate.add(event);
  return aggregate.finish();
}
/**
 * Aggregate over a validated primary-key stream without loading all events into
 * an array or storing every already-seen event ID. PK ordering guarantees event
 * uniqueness. Memory is bounded by campaign count + distinct bot subjects,
 * rather than all views and conversion receipts.
 *
 * This is NOT a cross-page transactional snapshot. For very large accounts,
 * provision a materialized rollup before the explicit maxPages limit is reached.
 */
export async function summarizeAdsCampaignsFromRepository({
  repository,verifiedSpend=[],pageSize=250,maxPages=1000
}={}){
  if(!repository||typeof repository.listEvents!=='function')
    throw new Error('ads_report_repository_required');
  if(!Array.isArray(verifiedSpend)||!Number.isInteger(pageSize)
    ||pageSize<1||pageSize>1000
    ||!Number.isInteger(maxPages)||maxPages<1||maxPages>10000)
    throw new Error('invalid_ads_report_pagination');
  const aggregate=accumulator(verifiedSpend);
  let cursor='';
  for(let pageNumber=0;pageNumber<maxPages;pageNumber++){
    const page=await repository.listEvents({cursor,limit:pageSize});
    if(!page||!Array.isArray(page.events)||page.events.length>pageSize)
      throw new Error('invalid_ads_event_page');
    let previous=cursor;
    for(const event of page.events){
      if(typeof event?.eventId!=='string'||event.eventId<=previous)
        throw new Error('invalid_ads_event_order');
      previous=event.eventId;
      aggregate.add(event,{orderedUnique:true});
    }
    if(page.nextCursor===null)return aggregate.finish();
    if(!page.events.length||page.nextCursor!==previous)
      throw new Error('invalid_ads_event_cursor');
    cursor=page.nextCursor;
  }
  throw new Error('ads_report_page_limit_reached');
}
