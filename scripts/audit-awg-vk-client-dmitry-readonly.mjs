import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {createTelegramService} from '../server/telegram-bot.mjs';

const BASE='https://awgcars.ru';
const vkToken=String(process.env.AWG_VK_COMMUNITY_TOKEN||'').trim();
const botToken=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'').trim();
const apiKey=String(process.env.AUTO_SALE_API_KEY||'').trim();
const groupId='242103542';
const ydb=String(process.env.YDB_CONNECTION_STRING||'');
if(!ydb.endsWith('/etn00ojk5iv1u7dgpdar'))throw Error('production_ydb_guard_failed');
const creds=new AccessTokenCredentialsProvider({token:String(process.env.YC_IAM_TOKEN||'')});
if(!vkToken||!botToken||!apiKey)throw Error('required_production_readonly_credentials_missing');
const timeout=ms=>AbortSignal.timeout(ms);
async function vk(method,params={}){
  const res=await fetch('https://api.vk.com/method/'+method,{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({access_token:vkToken,v:'5.199',...params}).toString(),
    signal:timeout(15000)
  });
  const json=await res.json().catch(()=>({}));
  return{http:res.status,ok:res.ok&&!json.error,data:json.response||null,errorCode:json.error?.error_code||null,errorMessage:json.error?.error_msg||null};
}
async function api(path){
  const res=await fetch(BASE+path,{headers:{'x-auto-sale-key':apiKey},signal:timeout(26000)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error('AWG_API_'+path+'_HTTP_'+res.status);
  return data;
}
const profile=await vk('users.get',{user_ids:'flyer_flyer',fields:'screen_name'});
let client=null;
const row=Array.isArray(profile.data)?profile.data[0]:null;
if(profile.ok&&/^\d+$/.test(String(row?.id||''))){
  client={vkUserId:String(row.id),screenName:String(row.screen_name||'').toLowerCase()};
}
if(!client){
  const resolved=await vk('utils.resolveScreenName',{screen_name:'flyer_flyer'});
  if(resolved.ok&&resolved.data?.type==='user'&&/^\d+$/.test(String(resolved.data.object_id))){
    client={vkUserId:String(resolved.data.object_id),screenName:'flyer_flyer',via:'resolveScreenName'};
  }
}
const health=await fetch(BASE+'/api/health',{signal:timeout(25000)}).then(r=>r.json());
const vkConfig=await fetch(BASE+'/api/auto-sale/vk/config',{signal:timeout(25000)}).then(r=>r.json());
const state=await api('/api/auto-sale/state');
const stateAgain=await api('/api/auto-sale/state');
const parity=await api('/api/auto-sale/admin/read-parity');
const directStore=await createYdbDomainStore({connectionString:ydb,credentialsProvider:creds,ensureSchema:false});
let direct;
try{direct=await directStore.loadState();}finally{await directStore.close();}
const snapshot={
  apiFirst:{revision:state.revision,initialized:state.initialized,leadCount:(state.leads||[]).length,quoteCount:(state.quotes||[]).length,orderCount:(state.orders||[]).length},
  apiSecond:{revision:stateAgain.revision,initialized:stateAgain.initialized,leadCount:(stateAgain.leads||[]).length},
  ydbNormalized:{revision:direct.revision,initialized:direct.initialized,leadCount:(direct.leads||[]).length,
    clientVKCount:(direct.leads||[]).filter(l=>l.clientProvider==='vk'&&String(l.clientProviderUserId||'')==='26443041').length},
  readParity:{configuredMode:parity.configuredMode,source:parity.source,authoritative:parity.authoritative,fallback:parity.fallback,reason:parity.reason,revision:parity.revision}
};
const access=state._access||{};
if(access.role!=='admin')throw Error('api_key_did_not_resolve_admin');
const managers=(state.team||[]).filter(m=>m?.active!==false&&m?.role==='Менеджер');
const dmitry=managers.find(m=>m.name==='Дмитрий');

const store=await createYdbStateStore({connectionString:ydb,credentialsProvider:creds,ensureSchema:false,domainDualWrite:false});
let pins;
try{pins=await store.adminAccessList();}finally{await store.close();}
const pin=pins.find(row=>String(row.username||'').replace(/^@/,'').toLowerCase()==='flyer_flyer');
const telegramId=String(dmitry?.telegramUserId||pin?.telegramUserId||'');
const managerLinked=/^\d+$/.test(telegramId);
const dmitryUsername=String(dmitry?.telegramUsername||dmitry?.telegram||'').replace(/^@/,'').toLowerCase();
let tgChat={ok:false,reason:managerLinked?'not_checked':'unlinked'};
if(managerLinked){
  try{
    const r=await fetch('https://api.telegram.org/bot'+botToken+'/getChat',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:telegramId}),signal:timeout(16000)
    });
    const data=await r.json().catch(()=>({}));
    tgChat={ok:r.ok&&data.ok===true,chatType:data.result?.type||null,usernameMatches:Boolean(String(data.result?.username||'').toLowerCase()===dmitryUsername),errorCode:data.error_code||null,error:data.ok===false?String(data.description||'').slice(0,120):null};
  }catch(e){tgChat={ok:false,error:String(e.message).slice(0,120)}}
}
let vkMessaging={checked:false};
if(client){
  const permission=await vk('messages.isMessagesFromGroupAllowed',{group_id:groupId,user_id:client.vkUserId});
  vkMessaging={checked:true,ok:permission.ok,allowed:Boolean(permission.data?.is_allowed),errorCode:permission.errorCode,error:permission.errorMessage};
}
const leads=client?(state.leads||[]).filter(l=>String(l.clientProvider||'').toLowerCase()==='vk'&&String(l.clientProviderUserId||'')===client.vkUserId):[];
const managerLeads=(state.leads||[]).filter(l=>String(l.manager||'')==='Дмитрий');
const selected=leads.find(l=>l.manager==='Дмитрий')||null;
const routedTeam=(state.team||[]).map(m=>{
  const entry=pins.find(p=>String(p.username||'').replace(/^@/,'').toLowerCase()===String(m.telegramUsername||m.telegram||'').replace(/^@/,'').toLowerCase());
  return {...m,telegramUserId:String(m.telegramUserId||entry?.telegramUserId||'')};
});
const planner=createTelegramService({token:botToken,managerChatIds:process.env.AUTO_SALE_MANAGER_CHAT_IDS||'',fetchImpl:async()=>{throw Error('forbidden_readonly_network_send')}});
const recipients=selected?planner.managerIds(selected,{...state,team:routedTeam}):[];
const deliveryRoute={
  leadFound:Boolean(selected),
  preferredManager:'Дмитрий',
  recipientCount:recipients.length,
  dmitryIncluded:Boolean(telegramId&&recipients.includes(telegramId)),
  extraneousRecipientCount:recipients.filter(id=>id!==telegramId).length,
  fallbackManagerCount:planner.fallbackManagerCount
};
const result={
  mode:'readonly',requestedClient:'https://vk.ru/flyer_flyer',
  clientIdentity:{resolved:Boolean(client),id:client?.vkUserId||null,resolvedScreenName:client?.screenName||null,lookupStatus:profile.http,lookupError:client?null:profile.errorMessage||'not_found'},
  dmitry:{teamRecordPresent:Boolean(dmitry),telegramUsername:dmitryUsername,hasTelegramUserId:managerLinked,pinExists:Boolean(pin),telegramChat:tgChat},
  api:{ok:health.ok===true,persistence:health.persistence,build:health.buildSha,vkAuth:health.vkAuth,vkMessaging:health.vkMessaging,telegramNotifications:health.telegramNotifications,telegramRoutableManagers:health.telegramRoutableManagers},
  vkConfig:{enabled:Boolean(vkConfig.enabled),messagingEnabled:Boolean(vkConfig.messagingEnabled),groupId:vkConfig.groupId||null},
  vkMessaging,
  deliveryRoute,
  snapshot,
  leads:{vkClientCount:leads.length,assignedToDmitry:leads.filter(l=>l.manager==='Дмитрий').length,latestStatuses:leads.slice(-3).map(l=>({status:l.status||null,manager:l.manager||null})),dmitryTotal:managerLeads.length},
  adminAccessVerified:access.role==='admin'
};
console.log('AWG_VK_CLIENT_DMITRY_READONLY_AUDIT',JSON.stringify(result));
if(!client)process.exitCode=2;
