// Read-only campaign statistics built only from verified server receipts.
// Paid impressions/clicks must come separately from a reseller/ad platform.
const TYPES={
  bot_start:'botStarts',
  miniapp_open:'miniappOpens',
  vehicle_view:'vehicleViews',
  lead_submit:'leadSubmissions',
  manager_contact:'managerContacts'
};
const CAMPAIGN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function createRow(campaignId){
  return {
    campaignId,
    botStarts:0,
    uniqueBotUsers:0,
    miniappOpens:0,
    vehicleViews:0,
    leadSubmissions:0,
    managerContacts:0,
    paidClicks:null,
    impressions:null,
    verifiedSpend:null,
    costPerLead:null
  };
}
export function summarizeAdsCampaigns({events=[],verifiedSpend=[]}={}){
  if(!Array.isArray(events)||!Array.isArray(verifiedSpend))throw new Error('invalid_ads_reporting_input');
  const rows=new Map(),seen=new Map(),users=new Map();
  const rowFor=campaignId=>{
    if(!CAMPAIGN.test(campaignId))throw new Error('invalid_ads_report_campaign');
    if(!rows.has(campaignId))rows.set(campaignId,createRow(campaignId));
    return rows.get(campaignId);
  };
  for(const event of events){
    const {eventId,eventType,campaignId,subjectKey}=event||{};
    if(typeof eventId!=='string'||!eventId||typeof subjectKey!=='string'||!/^[a-f0-9]{64}$/.test(subjectKey)||!TYPES[eventType]){
      throw new Error('invalid_ads_reporting_event');
    }
    const identity=`${campaignId}:${eventType}:${subjectKey}`;
    const previous=seen.get(eventId);
    if(previous!==undefined){
      if(previous!==identity)throw new Error('ads_report_event_id_collision');
      continue;
    }
    seen.set(eventId,identity);
    const row=rowFor(campaignId);
    row[TYPES[eventType]]+=1;
    if(eventType==='bot_start'){
      if(!users.has(campaignId))users.set(campaignId,new Set());
      users.get(campaignId).add(subjectKey);
    }
  }
  for(const [campaignId,subjectKeys] of users)rows.get(campaignId).uniqueBotUsers=subjectKeys.size;
  for(const spend of verifiedSpend){
    const {campaignId,currency,amount,verified}=spend||{};
    const row=rowFor(campaignId);
    if(verified!==true||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)
      ||typeof amount!=='number'||!Number.isFinite(amount)||amount<0){
      throw new Error('unverified_or_invalid_ads_spend');
    }
    if(row.verifiedSpend)throw new Error('duplicate_ads_spend_campaign');
    row.verifiedSpend={currency,amount};
  }
  for(const row of rows.values()){
    if(row.verifiedSpend&&row.leadSubmissions>0){
      row.costPerLead={
        currency:row.verifiedSpend.currency,
        amount:row.verifiedSpend.amount/row.leadSubmissions
      };
    }
  }
  return [...rows.values()].sort((a,b)=>a.campaignId.localeCompare(b.campaignId));
}

/**
 * Read an entire bounded receipt stream from the repository before aggregating.
 * Deliberately refuses to publish a partial report when the bound is exceeded.
 * This is an application-level aggregation, not a transactional snapshot.
 */
export async function summarizeAdsCampaignsFromRepository({
  repository,
  verifiedSpend=[],
  pageSize=250,
  maxPages=100
}={}){
  if(!repository||typeof repository.listEvents!=='function')throw new Error('ads_report_repository_required');
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000
    ||!Number.isInteger(maxPages)||maxPages<1||maxPages>1000){
    throw new Error('invalid_ads_report_pagination');
  }
  const events=[];
  let cursor='';
  for(let pageNumber=0;pageNumber<maxPages;pageNumber++){
    const page=await repository.listEvents({cursor,limit:pageSize});
    if(!page||!Array.isArray(page.events)||page.events.length>pageSize)throw new Error('invalid_ads_event_page');
    let previous=cursor;
    for(const event of page.events){
      if(typeof event?.eventId!=='string'||event.eventId<=previous){
        throw new Error('invalid_ads_event_order');
      }
      previous=event.eventId;
      events.push(event);
    }
    if(page.nextCursor===null)return summarizeAdsCampaigns({events,verifiedSpend});
    if(!page.events.length||page.nextCursor!==previous)throw new Error('invalid_ads_event_cursor');
    cursor=page.nextCursor;
  }
  throw new Error('ads_report_page_limit_reached');
}
