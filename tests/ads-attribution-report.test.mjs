import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeAdsCampaigns,summarizeAdsCampaignsFromRepository} from '../server/ads-attribution-report.mjs';

const A='a'.repeat(64), B='b'.repeat(64);
const evt=(eventId,campaignId,eventType,subjectKey=A)=>({eventId,campaignId,eventType,subjectKey});

test('report counts unique users, distinct events, leads and verified campaign CPL',()=>{
  const rows=summarizeAdsCampaigns({
    events:[
      evt('start-1','a','bot_start',A),
      evt('start-2','a','bot_start',A),
      evt('start-3','a','bot_start',B),
      evt('view-1','a','vehicle_view',A),
      evt('lead-1','a','lead_submit',A),
      evt('lead-1','a','lead_submit',A),
      evt('lead-2','a','lead_submit',B),
      evt('start-4','b','bot_start',B)
    ],
    verifiedSpend:[{campaignId:'a',amount:3000,currency:'RUB',verified:true}]
  });
  assert.equal(rows.length,2);
  assert.equal(rows[0].botStarts,3);
  assert.equal(rows[0].uniqueBotUsers,2);
  assert.equal(rows[0].vehicleViews,1);
  assert.equal(rows[0].leadSubmissions,2);
  assert.deepEqual(rows[0].costPerLead,{amount:1500,currency:'RUB'});
  assert.equal(rows[0].paidClicks,null);
  assert.equal(rows[0].impressions,null);
  assert.equal(rows[1].costPerLead,null);
});
test('no verified spend means CPL is unknown, including when leads are measured',()=>{
  const rows=summarizeAdsCampaigns({events:[evt('lead-1','camp','lead_submit')]});
  assert.equal(rows[0].leadSubmissions,1);
  assert.equal(rows[0].verifiedSpend,null);
  assert.equal(rows[0].costPerLead,null);
});
test('verified spend with zero leads must not divide by zero',()=>{
  const rows=summarizeAdsCampaigns({verifiedSpend:[{campaignId:'no-lead',amount:5000,currency:'RUB',verified:true}]});
  assert.deepEqual(rows[0].verifiedSpend,{amount:5000,currency:'RUB'});
  assert.equal(rows[0].costPerLead,null);
});
test('duplicate event identifier mapped to another campaign must be rejected',()=>{
  assert.throws(()=>summarizeAdsCampaigns({events:[
    evt('same','campaign-A','bot_start'),evt('same','campaign-B','bot_start')
  ]}),/event_id_collision/);
});
test('unverified, mixed and invalid spend must never create a fake CPL',()=>{
  assert.throws(()=>summarizeAdsCampaigns({verifiedSpend:[
    {campaignId:'a',currency:'RUB',amount:100}
  ]}),/unverified_or_invalid/);
  assert.throws(()=>summarizeAdsCampaigns({verifiedSpend:[
    {campaignId:'a',currency:'USD',amount:-1,verified:true}
  ]}),/unverified_or_invalid/);
  assert.throws(()=>summarizeAdsCampaigns({verifiedSpend:[
    {campaignId:'a',currency:'RUB',amount:10,verified:true},
    {campaignId:'a',currency:'USD',amount:10,verified:true}
  ]}),/duplicate_ads_spend_campaign/);
});
test('all events require HMAC subject keys, known type and valid identifiers',()=>{
  assert.throws(()=>summarizeAdsCampaigns({events:[evt('1','campaign','ad_click')]}),/invalid_ads_reporting_event/);
  assert.throws(()=>summarizeAdsCampaigns({events:[evt('1','campaign','bot_start','12345')]}),/invalid_ads_reporting_event/);
  assert.throws(()=>summarizeAdsCampaigns({events:[evt('1','bad campaign','bot_start')]}),/invalid_ads_report_campaign/);
});

test('paged read from repository produces complete real receipt counts',async()=>{
  const events=[
    evt('ads:lead-1','camp','lead_submit',A),
    evt('ads:lead-2','camp','lead_submit',B),
    evt('tg-start:1','camp','bot_start',A)
  ];
  const repository={
    async listEvents({cursor='',limit}){
      const remaining=events.filter(item=>item.eventId>cursor);
      return {
        events:remaining.slice(0,limit),
        nextCursor:remaining.length>limit?remaining[limit-1].eventId:null
      };
    }
  };
  const rows=await summarizeAdsCampaignsFromRepository({
    repository,pageSize:2,maxPages:3,
    verifiedSpend:[{campaignId:'camp',currency:'RUB',amount:1200,verified:true}]
  });
  assert.equal(rows[0].leadSubmissions,2);
  assert.equal(rows[0].uniqueBotUsers,1);
  assert.equal(rows[0].costPerLead.amount,600);
  await assert.rejects(summarizeAdsCampaignsFromRepository({repository,pageSize:2,maxPages:1}),/ads_report_page_limit_reached/);
});
test('malformed event order and missing continuation page fail closed',async()=>{
  await assert.rejects(summarizeAdsCampaignsFromRepository({
    repository:{listEvents:async()=>({events:[evt('z','camp','bot_start'),evt('a','camp','bot_start')],nextCursor:null})}
  }),/invalid_ads_event_order/);
  await assert.rejects(summarizeAdsCampaignsFromRepository({
    repository:{listEvents:async()=>({events:[],nextCursor:'orphan'})}
  }),/invalid_ads_event_cursor/);
});
