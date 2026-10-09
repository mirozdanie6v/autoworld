import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {sanitizeClientOperations,applyManagerLeadClaims,stateForAccess} from '../server/auto-sale-access.mjs';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {mutateAutoSaleEntityBatch,deleteAutoSaleLeadCascade} from '../server/ydb-entity-commands.mjs';

const DB='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnhujtu1t6f89tdtohs';
if(process.env.YDB_CONNECTION_STRING!==DB)throw Error('refusing_non_staging_ydb');
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'');
if(!token)throw Error('staging_token_required');
const credential=new AccessTokenCredentialsProvider({token});
const domainStore=await createYdbDomainStore({connectionString:DB,credentialsProvider:credential,ensureSchema:false});
const legacyStore=await createYdbStateStore({connectionString:DB,credentialsProvider:credential,ensureSchema:false,domainDualWrite:false});
const id='L-VK-LAST-MANAGER-E2E-'+randomUUID();
const TEAM=[
  {id:'S-TEST-800',name:'Дмитрий',role:'Менеджер',active:true,telegramUsername:'Flyer_Flyer',telegramUserId:'800'},
  {id:'S-TEST-801',name:'Алексей',role:'Менеджер',active:true,telegramUsername:'smit44744',telegramUserId:'801'},
  {id:'S-TEST-802',name:'Иван',role:'Менеджер',active:true,telegramUsername:'Ivan_AWG',telegramUserId:'802'}
];
const identity={provider:'vk',id:'999999890',key:'vk:999999890'};
const user={provider:'vk',id:identity.id,first_name:'Автотест',last_name:'VK ID'};
const service=createTelegramService({
  token:'123456:FAKE_AUTOTEST_ONLY',
  fetchImpl:async()=>{throw Error('forbidden_test_network_delivery')},
  managerChatIds:''
});
const op=({input,baseRowVersion})=>({resource:'lead',operation:'patch',id,input,baseRowVersion});
const storeBatch=ops=>mutateAutoSaleEntityBatch({legacyStore,domainStore,operations:ops,prepareNotifications:null,maxAttempts:2});
const findLead=state=>state.leads?.find(lead=>lead.id===id);
let created=false,passed=false;
let checkCount=0;
function check(ok,message){assert.ok(ok,message);checkCount++;}
try{
  const before=await domainStore.loadState();
  check((before.catalog||[]).some(car=>car.id==='VK-STAGING-DEMO-CAR-001'&&car.image==='https://vk-test.awgcars.ru/favicon-64.webp'),'isolated catalog fixture');
  const input={id,name:'Тест полного цикла VK',contact:'https://vk.com/id999999890',
    model:'Toyota Camry — тест VK ID',origin:'Грузия',budget:15000,yearFrom:'2021',
    nextAction:new Date().toISOString().slice(0,10),source:'Mini App',status:'Новый'};
  const initialOps=[
    {resource:'lead',operation:'create',id,input},
    {resource:'note',operation:'create',leadId:id,input:{id:'N-'+randomUUID(),text:'Автотест полного цикла'}}
  ];
  const safe=sanitizeClientOperations(before,initialOps,user,identity);
  check(safe.ok,'server sanitizes VK user request');
  check(safe.operations[0].input.manager===''&&safe.operations[0].input.status==='Новый','unassigned new lead');
  const create=await storeBatch(safe.operations);
  if(create.status!==200)throw Error('creation_failed:'+JSON.stringify(create.data));
  created=true;
  let state=await domainStore.loadState();
  let lead=findLead(state);
  check(lead?.clientProvider==='vk'&&lead?.clientProviderUserId===identity.id&&lead?.budget===15000,'VK identity persisted');
  check((state.notes[id]||[]).length===1,'note persisted');
  check(stateForAccess(state,{role:'client',identity}).leads.some(x=>x.id===id),'owner sees own lead');
  check(!stateForAccess(state,{role:'client',identity:{provider:'vk',id:'999999891',key:'vk:999999891'}}).leads.some(x=>x.id===id),'foreign VK user cannot see lead');
  check(!stateForAccess(state,{role:'public'}).leads.some(x=>x.id===id),'guest cannot see lead');

  const notifications=await service.collectStateChanges({...before,team:TEAM,initialized:true}, {...state,team:TEAM});
  const managers=notifications.filter(x=>x.event==='lead_created'&&x.leadId===id&&x.target==='manager');
  check(new Set(managers.map(x=>x.chatId)).size===3,'fanout to three manager targets planned');
  check(notifications.some(x=>x.event==='lead_created_confirmation'&&x.channel==='vk'&&x.vkUserId===identity.id),'VK client confirmation planned');
  console.log('STAGE_CREATED',JSON.stringify({status:lead.status,manager:lead.manager||'',plannedManagerTargets:managers.length,clientChannel:'vk'}));

  let previousVersion=null;
  const transitions=[
    {username:'Ivan_AWG',userId:'802',name:'Иван',status:'В работе'},
    {username:'smit44744',userId:'801',name:'Алексей',status:'Расчёт'},
    {username:'Flyer_Flyer',userId:'800',name:'Дмитрий',status:'Ожидает клиента'}
  ];
  for(const step of transitions){
    const access={role:'admin',apiKey:false,authType:'telegram',user:{id:step.userId,username:step.username}};
    state=await domainStore.loadState();
    previousVersion=await domainStore.entityRowVersion('lead',id);
    const claims=applyManagerLeadClaims({...state,team:TEAM},[op({
      input:{status:step.status,manager:'ПОДМЕНА',managerTelegramUserId:'999'},
      baseRowVersion:previousVersion
    })],access);
    check(claims.ok,'verified Telegram manager can change status');
    check(claims.operations[0].input.manager===step.name,'server owns new assigned manager');
    check(claims.operations[0].input.managerTelegramUserId===step.userId,'latest manager routing set');
    const updated=await storeBatch(claims.operations);
    if(updated.status!==200)throw Error('status_change_failed:'+step.name+':'+JSON.stringify(updated.data));
    const persisted=await domainStore.loadState();
    lead=findLead(persisted);
    check(lead.status===step.status&&lead.manager===step.name,'status and LAST manager persisted');
    check(lead.managerTelegramUserId===step.userId,'last manager Telegram route persisted');
    const routed=service.managerIds(lead,{team:TEAM});
    check(routed.length===1&&routed[0]===step.userId,'status update routed to latest owner only');
    const planned=await service.collectStateChanges({...state,team:TEAM,initialized:true},{...persisted,team:TEAM});
    check(planned.some(x=>x.event==='lead_status'&&x.target==='manager'&&x.chatId===step.userId),'status manager notification planned');
    check(planned.some(x=>x.event==='lead_status'&&x.target==='client'&&x.channel==='vk'),'status VK confirmation planned');
    console.log('STAGE_MANAGER_UPDATED',JSON.stringify({status:step.status,assignedManager:step.name,route:step.userId}));
  }

  // Verify a stale competing update does not steal assignment.
  const staleAccess={role:'admin',apiKey:false,user:{id:'801',username:'smit44744'}};
  const stalePolicy=applyManagerLeadClaims({...state,team:TEAM},[op({
    input:{status:'Ожидает клиента'},baseRowVersion:previousVersion
  })],staleAccess);
  // It was the current status in stale view, hence it must be treated as no-op.
  check(stalePolicy.ok&&stalePolicy.operations[0].input.manager===undefined,'same status does not reassign');
  const staleWrite=await storeBatch(stalePolicy.operations);
  check(staleWrite.status===409&&staleWrite.data.error==='entity_conflict','stale update denied by row version');

  state=await domainStore.loadState();
  const noop=applyManagerLeadClaims({...state,team:TEAM},[op({
    input:{nextAction:'2026-10-31',manager:'Алексей',managerTelegramUserId:'801'},
    baseRowVersion:await domainStore.entityRowVersion('lead',id)
  })],staleAccess);
  check(noop.ok&&!Object.hasOwn(noop.operations[0].input,'manager'),'non-status edit cannot transfer lead');
  const notePatch=await storeBatch(noop.operations);
  if(notePatch.status!==200)throw Error('same_status_patch_failed:'+notePatch.data.error);
  state=await domainStore.loadState();
  lead=findLead(state);
  check(lead.manager==='Дмитрий'&&lead.status==='Ожидает клиента','last status editor still assigned');

  const forged=applyManagerLeadClaims({...state,team:TEAM},[op({
    input:{status:'Расчёт',manager:'Алексей'}
  })],{role:'admin',apiKey:false,user:{id:'999',username:'not_a_manager'}});
  check(forged.ok===false&&forged.status===403,'unknown manager denied');
  check(stateForAccess(state,{role:'client',identity}).leads.some(x=>x.id===id),'customer still sees updated request');
  check(!stateForAccess(state,{role:'client',identity:{provider:'vk',id:'999999891'}}).leads.some(x=>x.id===id),'foreign client still isolated');
  passed=true;
  console.log('STAGING_FULL_CYCLE_VERIFIED',JSON.stringify({checks:checkCount,id,status:lead.status,manager:lead.manager,clientProvider:lead.clientProvider,notificationMode:'planned-only-no-delivery'}));
}finally{
  try{
    if(created){
      const rowVersion=await domainStore.entityRowVersion('lead',id);
      if(rowVersion===null)throw Error('synthetic_lead_not_found_for_cleanup');
      const clean=await deleteAutoSaleLeadCascade({legacyStore,domainStore,id,expectedRowVersion:rowVersion,maxAttempts:2});
      if(clean.status!==200)throw Error('synthetic_lead_cleanup_failed:'+clean.data.error);
      const after=await domainStore.loadState();
      if(findLead(after)||(after.notes[id]||[]).length)throw Error('test_lead_still_present_after_cleanup');
      console.log('STAGING_FULL_CYCLE_CLEANUP_VERIFIED',JSON.stringify({id,revision:after.revision}));
    }
  }finally{await Promise.allSettled([legacyStore.close(),domainStore.close()]);}
}
if(!passed)throw Error('full_cycle_incomplete');
