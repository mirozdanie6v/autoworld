import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeClientOperations,applyManagerLeadClaims} from '../server/auto-sale-access.mjs';
import {leadChannel,channelSourceStats,channelResponseStats,responseTimeLabel} from '../public/auto-sale-channel-analytics.mjs';
import {filterLeads} from '../public/auto-sale-core.mjs';

const submitted='2026-10-11T01:00:00.000Z',firstAction='2026-10-11T01:12:00.000Z';
const team=[{name:'Иван',role:'Менеджер',active:true,telegramUserId:'800',telegramUsername:'Ivan_AWG'}];
const access={role:'admin',apiKey:false,user:{id:'800',username:'Ivan_AWG'}};

test('channel and submission time come from authenticated identity and server clock',()=>{
  const result=sanitizeClientOperations({leads:[]},[{resource:'lead',operation:'create',id:'L',input:{model:'Toyota',acquisitionChannel:'telegram',clientSubmittedAt:'1990-01-01',firstManagerActionAt:'1990-01-01'}}],{id:'42',provider:'vk'},null,{now:()=>submitted});
  const lead=result.operations[0].input;
  assert.equal(lead.acquisitionChannel,'vk');assert.equal(lead.clientSubmittedAt,submitted);
  assert.equal(lead.firstManagerActionAt,undefined);
  assert.equal(leadChannel({...lead,clientProvider:'telegram'}),'ВКонтакте','server-owned acquisition channel takes priority');
});

test('first manager reaction remains unchanged when another manager later changes the status',()=>{
  const state={team,leads:[{id:'L',status:'Новый',clientSubmittedAt:submitted}]};
  const first=applyManagerLeadClaims(state,[{resource:'lead',operation:'patch',id:'L',input:{status:'В работе',firstManagerActionAt:'1990-01-01'}}],access,{now:()=>firstAction});
  const lead={...state.leads[0],...first.operations[0].input};
  assert.equal(lead.firstManagerActionAt,firstAction);
  const next=applyManagerLeadClaims({...state,leads:[lead]},[{resource:'lead',operation:'patch',id:'L',input:{status:'Расчёт',firstManagerActionAt:'1990-01-01',clientSubmittedAt:'1990-01-01'}}],access,{now:()=>'2026-10-11T02:00:00Z'});
  assert.equal(next.operations[0].input.firstManagerActionAt,undefined);
  assert.equal(next.operations[0].input.clientSubmittedAt,undefined);
  assert.equal({...lead,...next.operations[0].input}.firstManagerActionAt,firstAction);
});

test('channel analytics separates VK from Telegram and associates orders through their lead',()=>{
  const leads=[{id:'VK',source:'Mini App',clientProvider:'vk'},{id:'TG',source:'Mini App',telegramUserId:'43'}];
  const stats=channelSourceStats(leads,[{id:'O',leadId:'VK',source:'Mini App'}]);
  assert.deepEqual(stats.find(row=>row.source==='ВКонтакте'),{source:'ВКонтакте',leads:1,deals:1,conversion:100});
  assert.equal(stats.find(row=>row.source==='Telegram').leads,1);
  assert.deepEqual(filterLeads(leads,{source:'ВКонтакте'}).map(row=>row.id),['VK']);
  assert.deepEqual(filterLeads(leads,{source:'Mini App'}).map(row=>row.id),['VK','TG']);
});

test('waiting leads and unmeasured legacy reactions do not inflate measured response time',()=>{
  const leads=[
    {id:'DONE',clientProvider:'vk',status:'В работе',clientSubmittedAt:submitted,firstManagerActionAt:firstAction},
    {id:'WAIT',clientProvider:'vk',status:'Новый',clientSubmittedAt:submitted},
    {id:'LEGACY',clientProvider:'vk',status:'В работе',createdAt:submitted},
    {id:'FUTURE',clientProvider:'vk',status:'В работе',clientSubmittedAt:submitted,firstManagerActionAt:'2027-01-01T00:00:00Z'}
  ];
  const row=channelResponseStats(leads,{now:Date.parse('2026-10-11T02:00:00Z')})[0];
  assert.equal(row.measured,1);assert.equal(row.averageResponseMinutes,12);
  assert.equal(row.waiting,1);assert.equal(row.waitingOverLimit,1);assert.deepEqual(row.waitingLeadIds,['WAIT']);
  assert.equal(row.unmeasured,2);
  assert.equal(responseTimeLabel(null),'Нет измерений');
});
