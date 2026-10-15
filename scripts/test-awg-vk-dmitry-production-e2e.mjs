import assert from 'node:assert/strict';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {sanitizeClientOperations,stateForAccess} from '../server/auto-sale-access.mjs';

const base='https://awgcars.ru';
const customerId='26443041';
const groupId='242103542';
const runId=String(process.env.GITHUB_RUN_ID||'');
const leadId='L-QA-VK-'+runId;
const botToken=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'');
const vkToken=String(process.env.AWG_VK_COMMUNITY_TOKEN||'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
const db=String(process.env.YDB_CONNECTION_STRING||'');
const apiTimeout=35000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={runId,leadId,mode:'admin-api-created-from-vk-client-sanitized-input',
  userAuthenticatedFromVK:false,db:'production-ydb',phases:[],delivered:{},cleanup:null,ok:false};
if(process.env.AWG_E2E_GUARD!=='VK26443041_DMITRY_TEST_ONLY_20261015')throw Error('missing_one_time_test_guard');
if(process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('one_time_test_refuses_replay');
if(!/^386\d{8}$/.test(runId))throw Error('unexpected_run_identifier');
if(!db.endsWith('/etn00ojk5iv1u7dgpdar'))throw Error('wrong_database_guard');
if(!apiKey||!botToken||!vkToken||!process.env.YC_IAM_TOKEN)throw Error('missing_qa_credentials');
assert.equal(process.env.AUTO_SALE_VK_GROUP_ID,groupId);
assert.equal(process.env.AUTO_SALE_TELEGRAM_RELAY_URL,'https://integration-telegram.viiversion.com/telegram/send');
assert.equal(process.env.AUTO_SALE_VK_ENABLED,'true');

async function request(path,options={}){
  const response=await fetch(base+path,{
    ...options,
    headers:{'content-type':'application/json','x-auto-sale-key':apiKey,...options.headers},
    signal:AbortSignal.timeout(apiTimeout)
  });
  const data=await response.json().catch(()=>({}));
  return{status:response.status,ok:response.ok,data};
}
async function state(){
  const r=await request('/api/auto-sale/state');
  if(!r.ok||r.data?._access?.role!=='admin')throw Error('admin_state_read_failed_'+r.status);
  return r.data;
}
async function vk(method,params){
  const r=await fetch('https://api.vk.com/method/'+method,{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({access_token:vkToken,v:'5.199',...params}).toString(),
    signal:AbortSignal.timeout(16000)
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.error)throw Error('vk_preflight_'+method+'_code_'+(j.error?.error_code||r.status));
  return j.response;
}
async function waitSent(ids,expected,phase){
  assert.equal(ids.length,expected,'unexpected_notifications_count_'+phase);
  const unique=[...new Set(ids)];
  assert.equal(unique.length,ids.length,'duplicate_notification_ids_'+phase);
  const query=new URLSearchParams();
  for(const id of ids)query.append('id',id);
  let last=[];
  for(let n=0;n<36;n++){
    const r=await request('/api/auto-sale/notifications/status?'+query);
    if(!r.ok)throw Error('notification_status_http_'+r.status);
    last=r.data.deliveries||[];
    const allSent=last.length===ids.length&&last.every(x=>x.status==='sent'&&String(x.messageId||''));
    if(allSent)return last;
    const terminal=last.filter(x=>['dead','failed'].includes(x.status));
    if(terminal.length)throw Error('notification_terminal_failure_'+phase+'_'+JSON.stringify(terminal.map(x=>({target:x.target,event:x.event,error:String(x.error).slice(0,120)}))));
    if(n%4===2){
      const p=await request('/api/auto-sale/notifications/process?'+query,{method:'POST',body:'{}'});
      if(!p.ok)throw Error('notification_process_http_'+p.status);
    }
    await sleep(1800);
  }
  throw Error('notification_timeout_'+phase+'_'+JSON.stringify(last.map(x=>({event:x.event,target:x.target,status:x.status,attempts:x.attempts,error:String(x.error||'').slice(0,100)}))));
}
const cred=new AccessTokenCredentialsProvider({token:String(process.env.YC_IAM_TOKEN)});
let createdAttempted=false;
let primaryError=null;
try{
  const [users,permission,health]=await Promise.all([
    vk('users.get',{user_ids:'flyer_flyer',fields:'screen_name'}),
    vk('messages.isMessagesFromGroupAllowed',{group_id:groupId,user_id:customerId}),
    fetch(base+'/api/health',{signal:AbortSignal.timeout(20000)}).then(r=>r.json())
  ]);
  assert.equal(String(users?.[0]?.id),customerId);
  assert.equal(String(users?.[0]?.screen_name||'').toLowerCase(),'flyer_flyer');
  assert.equal(Number(permission?.is_allowed),1,'VK client cannot receive AWG messages');
  assert.equal(health.persistence,'ydb-serverless');
  assert.equal(health.vkMessaging,'enabled');
  assert.equal(health.telegramNotifications,'enabled');
  assert.equal(health.telegramRoutableManagers,3);
  report.phases.push({name:'preflight',ok:true,channels:['vk','telegram']});

  const store=await createYdbStateStore({connectionString:db,credentialsProvider:cred,ensureSchema:false,domainDualWrite:false});
  let pins;
  try{pins=await store.adminAccessList();}finally{await store.close();}
  const pinMap=new Map(pins.map(x=>[String(x.username||'').replace(/^@/,'').toLowerCase(),String(x.telegramUserId||'')]));
  const members=['Дмитрий','Алексей','Иван'];
  const before=await state();
  assert.equal(before.initialized,true);
  assert.ok(!(before.leads||[]).some(x=>x.id===leadId),'repeated_test_lead');
  const team=(before.team||[]).map(member=>{
    const uname=String(member.telegramUsername||member.telegram||'').replace(/^@/,'').toLowerCase();
    return{...member,telegramUserId:String(member.telegramUserId||pinMap.get(uname)||'')};
  });
  for(const member of members){
    const m=team.find(x=>x.name===member&&x.role==='Менеджер'&&x.active!==false);
    assert.ok(m&&/^\d+$/.test(m.telegramUserId),'missing_manager_routing_'+member);
  }
  const dmitry=team.find(x=>x.name==='Дмитрий');
  assert.equal(String(dmitry.telegramUsername||'').toLowerCase(),'flyer_flyer');
  const planner=createTelegramService({token:botToken,managerChatIds:''});
  const user={provider:'vk',id:customerId,first_name:'Тест',last_name:'AWG'};
  const identity={provider:'vk',id:customerId,key:'vk:'+customerId};
  const ops=sanitizeClientOperations(before,[{
    resource:'lead',operation:'create',id:leadId,
    input:{id:leadId,name:'ТЕСТ AWG · VK → Telegram',contact:'VK: flyer_flyer (тест)',
      model:'ТЕСТ: Toyota Camry, проверка уведомлений',origin:'Грузия',budget:15000,
      note:'Автоматический тест, не реальная заявка'}
  }],user,identity);
  assert.equal(ops.ok,true);
  const created={...before,initialized:true,team,leads:[...(before.leads||[]),ops.operations[0].input]};
  const planned=await planner.collectStateChanges({...before,initialized:true,team},created,{telegramEnabled:true,vkEnabled:true});
  const creationManagers=planned.filter(x=>x.leadId===leadId&&x.target==='manager'&&x.event==='lead_created');
  const clientConfirm=planned.filter(x=>x.leadId===leadId&&x.target==='client'&&x.event==='lead_created_confirmation');
  assert.equal(creationManagers.length,3,'expected exactly three managers on initial lead');
  assert.equal(new Set(creationManagers.map(x=>x.chatId)).size,3);
  assert.equal(clientConfirm.length,1);
  assert.equal(clientConfirm[0].vkUserId,customerId);
  assert.equal(clientConfirm[0].channel,'vk');
  report.phases.push({name:'creation-plan',managerRecipients:3,vkClientRecipients:1,ok:true});

  // Administrative API commits a *synthetic* lead. It does NOT fake a VK login/session.
  createdAttempted=true;
  const create=await request('/api/auto-sale/entities/batch',{
    method:'POST',body:JSON.stringify({operations:ops.operations})});
  if(!create.ok)throw Error('production_creation_http_'+create.status+'_'+String(create.data?.error||''));
  let persisted=await state();
  let lead=(persisted.leads||[]).find(x=>x.id===leadId);
  assert.ok(lead&&lead.clientProvider==='vk'&&String(lead.clientProviderUserId)===customerId);
  assert.equal(lead.status,'Новый');
  assert.equal(lead.manager,'');
  assert.ok(stateForAccess(persisted,{role:'client',identity}).leads.some(x=>x.id===leadId),'client_view_missing');
  assert.ok(!stateForAccess(persisted,{role:'client',identity:{provider:'vk',id:'26443042',key:'vk:26443042'}}).leads.some(x=>x.id===leadId),'identity_isolation_failed');
  const firstIds=(create.data.notifications?.ids||[]).map(String);
  assert.deepEqual(new Set(firstIds),new Set(planned.map(x=>x.id)),'creation_outbox_does_not_match_notification_plan');
  report.phases.push({name:'creation-committed',ok:true,revision:persisted.revision,ids:firstIds.length});
  const first=await waitSent(firstIds,4,'lead_created');
  report.delivered.creation={
    allSent:true,
    manager:first.filter(x=>x.event==='lead_created'&&x.target==='manager').length,
    client:first.filter(x=>x.event==='lead_created_confirmation'&&x.target==='client').length,
    messagesWithIds:first.filter(x=>x.messageId).length
  };
  assert.equal(report.delivered.creation.manager,3);
  assert.equal(report.delivered.creation.client,1);
  report.phases.push({name:'creation-delivered',ok:true});

  persisted=await state();
  lead=(persisted.leads||[]).find(x=>x.id===leadId);
  const version=Number(persisted._rowVersions?.lead?.[leadId]);
  assert.ok(Number.isInteger(version)&&version>0);
  const now=new Date().toISOString();
  const managerPatch={
    status:'В работе',manager:'Дмитрий',managerClaimedAt:now,
    firstManagerActionAt:now,managerClaimedByTelegramUserId:dmitry.telegramUserId,
    managerClaimedByTelegramUsername:'Flyer_Flyer',
    managerTelegramUserId:dmitry.telegramUserId,managerTelegramUsername:'Flyer_Flyer'
  };
  const after={...persisted,initialized:true,team,leads:persisted.leads.map(x=>x.id===leadId?{...x,...managerPatch}:x)};
  const stagePlan=await planner.collectStateChanges({...persisted,initialized:true,team},after,{telegramEnabled:true,vkEnabled:true});
  const stageManager=stagePlan.filter(x=>x.target==='manager'&&x.leadId===leadId);
  const stageClient=stagePlan.filter(x=>x.target==='client'&&x.leadId===leadId);
  assert.equal(stageManager.length,1);
  assert.equal(stageManager[0].chatId,dmitry.telegramUserId);
  assert.equal(stageClient.length,1);
  assert.equal(stageClient[0].vkUserId,customerId);
  const patch=await request('/api/auto-sale/leads/'+encodeURIComponent(leadId),{
    method:'PATCH',body:JSON.stringify({...managerPatch,baseRowVersion:version})});
  if(!patch.ok)throw Error('manager_status_patch_http_'+patch.status+'_'+String(patch.data?.error||''));
  const updated=await state();
  const saved=(updated.leads||[]).find(x=>x.id===leadId);
  assert.equal(saved?.manager,'Дмитрий');
  assert.equal(saved?.status,'В работе');
  assert.equal(String(saved.managerTelegramUserId),dmitry.telegramUserId);
  const statusIds=(patch.data.notifications?.ids||[]).map(String);
  assert.deepEqual(new Set(statusIds),new Set(stagePlan.map(x=>x.id)),'status_outbox_does_not_match_notification_plan');
  const second=await waitSent(statusIds,2,'lead_status');
  assert.equal(second.filter(x=>x.target==='manager'&&x.event==='lead_status').length,1);
  assert.equal(second.filter(x=>x.target==='client'&&x.event==='lead_status').length,1);
  report.delivered.status={allSent:true,manager:1,client:1,messagesWithIds:second.filter(x=>x.messageId).length};
  report.phases.push({name:'status-updated-and-delivered',ok:true,assignedManager:'Дмитрий'});
  report.ok=true;
}catch(err){
  primaryError=err;
  report.error=String(err?.message||err).slice(0,700);
}finally{
  // Remove ONLY our new uniquely prefixed lead; never restore an old state snapshot.
  if(createdAttempted){
    try{
      const current=await state();
      const row=(current.leads||[]).find(x=>x.id===leadId);
      if(!row)report.cleanup={ok:true,alreadyAbsent:true};
      else{
        assert.equal(row.clientProvider,'vk','cleanup_refuses_unrelated_lead');
        assert.equal(String(row.clientProviderUserId),customerId,'cleanup_refuses_unrelated_identity');
        assert.ok(String(row.name||'').startsWith('ТЕСТ AWG'),'cleanup_refuses_non_test_lead');
        const version=Number(current._rowVersions?.lead?.[leadId]);
        assert.ok(version>0,'cleanup_missing_row_version');
        const deleted=await request('/api/auto-sale/leads/'+encodeURIComponent(leadId)+'?cascade=1',{
          method:'DELETE',body:JSON.stringify({baseRowVersion:version})});
        if(!deleted.ok)throw Error('cleanup_http_'+deleted.status+'_'+String(deleted.data?.error||''));
        const finalState=await state();
        assert.ok(!(finalState.leads||[]).some(x=>x.id===leadId),'lead_persisted_after_cleanup');
        report.cleanup={ok:true,removedOneTestLead:true,otherLeadsPreserved:true};
      }
    }catch(err){
      report.cleanup={ok:false,error:String(err?.message||err).slice(0,200)};
      report.ok=false;
      if(!primaryError)primaryError=err;
    }
  }
  // Keep the report non-sensitive. Notification IDs, names, tokens and PIN IDs never leave the runner.
  console.log('AWG_VK_DMITRY_PRODUCTION_E2E',JSON.stringify(report));
}
if(primaryError)throw primaryError;
if(!report.ok||!report.cleanup?.ok)throw Error('incomplete_live_e2e');
