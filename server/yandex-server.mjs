import http from 'node:http';
import path from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFile,stat} from 'node:fs/promises';
import {createYdbStateStore} from './ydb-state.mjs';
import {createYdbDomainStore} from './ydb-domain-store.mjs';
import {readAutoSaleState} from './ydb-read-mode.mjs';
import {syncYdbState} from './ydb-sync.mjs';
import {createObjectStorage} from './object-storage.mjs';
import {createTelegramService} from './telegram-bot.mjs';
import {addAutoSaleNote,addAutoSalePayment,deleteAutoSaleLeadCascade,mutateAutoSaleEntity,mutateAutoSaleEntityBatch,readAutoSaleEntity} from './ydb-entity-commands.mjs';
import {MAX_ADMIN_ACCOUNTS,stateForAccess,rowVersionsForAccess,sanitizeClientOperations,sanitizeAdminOperations} from './auto-sale-access.mjs';
import {managerTelegramUsername} from '../shared/auto-sale-manager-directory.mjs';
import {verifyGitHubCatalogOidcToken} from './github-oidc-auth.mjs';

const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const distDir=path.join(rootDir,'dist');
const port=Number(process.env.PORT||8080);
const connectionString=String(process.env.YDB_CONNECTION_STRING||'').trim();
const apiKey=String(process.env.AUTO_SALE_API_KEY||'').trim();
const catalogImportKey=String(process.env.AUTO_SALE_CATALOG_IMPORT_KEY||'').trim();
const publicDemoWrite=/^(1|true|yes)$/i.test(String(process.env.AUTO_SALE_PUBLIC_DEMO_WRITE||''));
const legacyStateWriteEnabled=/^(1|true|yes)$/i.test(String(process.env.AUTO_SALE_LEGACY_STATE_WRITE||''));
const mediaBucket=String(process.env.AUTO_SALE_MEDIA_BUCKET||'').trim();
const ydbReadMode=['legacy','shadow','normalized'].includes(String(process.env.AUTO_SALE_YDB_READ_MODE||''))?String(process.env.AUTO_SALE_YDB_READ_MODE):'legacy';
const adminTelegramUsernames=[...new Set(String(process.env.AUTO_SALE_ADMIN_TELEGRAM_USERNAMES||'Flyer_Flyer,smit44744,Ivan_AWG').split(',').map(x=>x.trim().replace(/^@/,'').toLowerCase()).filter(Boolean))].slice(0,MAX_ADMIN_ACCOUNTS);

const normalizeTelegramUsername=value=>String(value||'').trim().replace(/^@/,'').toLowerCase();
const memberTelegramUsername=member=>normalizeTelegramUsername(member?.telegramUsername||member?.telegram||managerTelegramUsername(member?.name));
function enrichStateWithAdminPins(state,pins=[]){
  const pinByUsername=new Map((Array.isArray(pins)?pins:[])
    .filter(item=>/^\d+$/.test(String(item?.telegramUserId||'')))
    .map(item=>[normalizeTelegramUsername(item.username),item]));
  const team=(Array.isArray(state?.team)?state.team:[]).map(member=>{
    if(/^\d+$/.test(String(member?.telegramUserId||'')))return member;
    const username=memberTelegramUsername(member);
    const pin=username?pinByUsername.get(username):null;
    if(!pin)return member;
    return{
      ...member,
      telegramUserId:String(pin.telegramUserId),
      telegramUsername:username,
      telegramLinkedAt:String(pin.linkedAt||member?.telegramLinkedAt||'')
    };
  });
  return{...(state||{}),team};
}
async function invitedAdminPins(){
  const list=await (await getStore()).adminAccessList();
  return list.filter(item=>adminTelegramUsernames.includes(normalizeTelegramUsername(item.username)));
}
async function collectTelegramStateChanges(previous,next){
  const pins=await invitedAdminPins();
  return telegram.collectStateChanges(enrichStateWithAdminPins(previous,pins),enrichStateWithAdminPins(next,pins));
}
async function claimAdminFromWebhook(update){
  const user=update?.message?.from;
  const username=normalizeTelegramUsername(user?.username);
  const userId=String(user?.id||'').trim();
  if(!username||!/^\d+$/.test(userId)||!adminTelegramUsernames.includes(username))return null;
  return(await getStore()).claimAdminAccess(username,userId);
}
if(!connectionString)throw new Error('YDB_CONNECTION_STRING is required');
if(!publicDemoWrite&&!apiKey)throw new Error('AUTO_SALE_API_KEY is required when public demo write is disabled');
let store=null;
let storePromise=null;
let domainStore=null;
let domainStorePromise=null;
async function getDomainStore(){
  if(domainStore)return domainStore;
  if(!domainStorePromise){
    domainStorePromise=createYdbDomainStore({connectionString,ensureSchema:false})
      .then(created=>{domainStore=created;return created})
      .catch(error=>{domainStorePromise=null;throw error});
  }
  return domainStorePromise;
}
async function getApiState(){
  if(ydbReadMode==='normalized'&&!legacyStateWriteEnabled){
    return readAutoSaleState({legacyStore:null,domainStore:await getDomainStore(),mode:'normalized',authoritativeNormalized:true});
  }
  const legacyStore=await getStore();
  if(ydbReadMode==='legacy')return readAutoSaleState({legacyStore,domainStore:null,mode:'legacy'});
  return readAutoSaleState({legacyStore,domainStore:await getDomainStore(),mode:ydbReadMode,authoritativeNormalized:false});
}
const media=createObjectStorage({bucket:mediaBucket});
const telegram=createTelegramService();
async function getStore(){
  if(store)return store;
  if(!storePromise){
    storePromise=createYdbStateStore({connectionString,ensureSchema:false})
      .then(created=>{store=created;return created})
      .catch(error=>{storePromise=null;throw error});
  }
  return storePromise;
}
async function getEntityStores(){
  const [legacyStore,domainStore]=await Promise.all([getStore(),getDomainStore()]);
  return{legacyStore,domainStore};
}
const notificationPumpIntervalMs=Math.max(15_000,Number(process.env.AUTO_SALE_NOTIFICATION_PUMP_MS||60_000));
let notificationPriorityWaiters=0;
async function safeNotificationStats(){
  try{return await (await getStore()).notificationStats()}
  catch(error){console.error('AUTO SALE notification stats unavailable',error);return{unavailable:true}}
}
async function deliverNotificationBatch(pending){
  const results=[];
  for(const item of pending){
    try{
      const sent=await telegram.send(item.chatId,item.message,{replyMarkup:item.replyMarkup});
      if(!sent?.message_id)throw new Error('telegram_message_id_missing');
      await (await getStore()).markNotification(item.id,{ok:true,messageId:sent?.message_id||'',attempts:item.attempts});
      results.push({id:item.id,ok:true,messageId:sent?.message_id||null});
    }catch(error){
      const message=String(error?.telegramDescription||error?.message||'telegram_send_failed');
      await (await getStore()).markNotification(item.id,{ok:false,error:message,attempts:item.attempts});
      results.push({id:item.id,ok:false,error:message});
    }
  }
  return results;
}
async function processNotificationClaim(claim){
  const pending=await claim();
  const results=await deliverNotificationBatch(pending);
  return{ok:true,processed:results.length,results,stats:await safeNotificationStats()};
}
async function processNotificationOutbox(limit=50){
  if(notificationPriorityWaiters>0)return{ok:true,skipped:'priority-waiter',processed:0,stats:await safeNotificationStats()};
  return processNotificationClaim(async()=>await (await getStore()).pendingNotifications(Math.min(limit,6)));
}
async function processNotificationIds(ids=[]){
  const wanted=[...new Set(ids.map(id=>String(id||'').trim()).filter(Boolean))].slice(0,12);
  if(!wanted.length)return{ok:true,processed:0,results:[],stats:await safeNotificationStats()};
  notificationPriorityWaiters++;
  try{
    return processNotificationClaim(async()=>await (await getStore()).pendingNotificationsByIds(wanted));
  }finally{
    notificationPriorityWaiters=Math.max(0,notificationPriorityWaiters-1);
  }
}
function takeCommittedNotificationItems(data){
  const items=Array.isArray(data?._notificationItems)?data._notificationItems:[];
  if(data&&Object.prototype.hasOwnProperty.call(data,'_notificationItems'))delete data._notificationItems;
  return items;
}
function deferCommittedNotifications(items,label='AUTO SALE committed Telegram delivery deferred'){
  if(!items.length)return;
  queueMicrotask(()=>deliverNotificationBatch(items).catch(error=>console.error(label,error)));
}

const apiHeaders={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'content-type,authorization,x-auto-sale-key,x-auto-sale-catalog-import-key,x-telegram-init-data,x-auto-sale-skip-telegram',
  'access-control-allow-methods':'GET,PUT,POST,DELETE,OPTIONS'
};
const json=(res,data,status=200)=>{
  const body=JSON.stringify(data);
  res.writeHead(status,{...apiHeaders,'content-length':Buffer.byteLength(body)});
  res.end(body);
};
const safeSecretMatch=(expectedValue,suppliedValue)=>{
  const expected=Buffer.from(String(expectedValue||''));
  const actual=Buffer.from(String(suppliedValue||''));
  return expected.length===actual.length&&expected.length>0&&timingSafeEqual(expected,actual);
};
const hasApiKey=req=>safeSecretMatch(apiKey,req.headers['x-auto-sale-key']);
const hasCatalogImportKey=req=>safeSecretMatch(catalogImportKey,req.headers['x-auto-sale-catalog-import-key']);
const hasCatalogImportAuth=async req=>{
  if(hasCatalogImportKey(req))return true;
  const raw=String(req.headers.authorization||'').trim();
  const match=raw.match(/^Bearer\s+(.+)$/i);
  if(!match)return false;
  const result=await verifyGitHubCatalogOidcToken(match[1]);
  if(!result.ok)console.warn('AUTO SALE catalog GitHub OIDC rejected',result.error);
  return result.ok;
};
const stableJson=value=>JSON.stringify(value,(_,entry)=>{
  if(!entry||Array.isArray(entry)||typeof entry!=='object')return entry;
  return Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]]));
});
const telegramAuth=req=>{
  const raw=String(req.headers['x-telegram-init-data']||'').trim();
  return raw?telegram.validateInitData(raw):{ok:false,error:'telegram_init_data_required'};
};
async function requestAccess(req,state=null){
  const current=state||await (await getDomainStore()).loadState();
  if(hasApiKey(req))return{state:current,access:{role:'admin',authenticated:true,authType:'api-key',apiKey:true,user:null,admin:null}};
  const auth=telegramAuth(req);
  if(!auth.ok)return{state:current,access:{role:'public',authenticated:false,authType:'public',apiKey:false,user:null,admin:null,error:auth.error}};
  const user=auth.user;
  const stateStore=await getStore();
  const pinned=await stateStore.adminAccessByUserId(String(user.id));
  if(pinned&&adminTelegramUsernames.includes(String(pinned.username||'').toLowerCase())){
    return{state:current,access:{role:'admin',authenticated:true,authType:'telegram',apiKey:false,user,admin:pinned}};
  }
  const username=String(user.username||'').replace(/^@/,'').toLowerCase();
  if(username&&adminTelegramUsernames.includes(username)){
    const claim=await stateStore.claimAdminAccess(username,String(user.id));
    if(claim?.ok)return{state:current,access:{role:'admin',authenticated:true,authType:'telegram',apiKey:false,user,admin:claim}};
    return{state:current,access:{role:'client',authenticated:true,authType:'telegram',apiKey:false,user,admin:null,adminClaimError:claim?.error||'admin_claim_failed'}};
  }
  return{state:current,access:{role:'client',authenticated:true,authType:'telegram',apiKey:false,user,admin:null}};
}
const accessSummary=access=>({
  role:access.role,
  authenticated:Boolean(access.authenticated),
  authType:access.authType,
  member:access.role==='admin'?{name:String(access.user?.first_name||access.admin?.username||'Администратор')} : null,
  user:access.user?{id:String(access.user.id),username:String(access.user.username||'')} : null,
  adminInvites:access.role==='admin'?adminTelegramUsernames.map(x=>'@'+x):undefined
});
function visibleEntity(state,access,resource,id){
  if(access.role==='admin')return true;
  if(resource==='catalog')return (stateForAccess(state,access).catalog||[]).some(item=>String(item?.id||'')===String(id));
  if(access.role!=='client')return false;
  const visible=stateForAccess(state,access);
  const collection=({lead:'leads',quote:'quotes',order:'orders'})[resource];
  return Boolean(collection&&(visible[collection]||[]).some(item=>String(item?.id||'')===String(id)));
}
async function parseJson(req,maxBytes=2_000_000){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBytes){
      const error=new Error('payload_too_large');error.statusCode=413;throw error;
    }
    chunks.push(chunk);
  }
  if(!chunks.length)return null;
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{
    const error=new Error('invalid_json');error.statusCode=400;throw error;
  }
}

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
async function staticFile(res,url){
  let rel;
  try{rel=decodeURIComponent(url.pathname)}catch{rel='/'}
  rel=rel==='/'?'index.html':rel.replace(/^\/+/, '');
  let file=path.resolve(distDir,rel);
  if(!file.startsWith(`${distDir}${path.sep}`)&&file!==path.join(distDir,'index.html')){res.writeHead(403);res.end('Forbidden');return}
  try{
    const info=await stat(file);
    if(info.isDirectory())file=path.join(file,'index.html');
    const body=await readFile(file);
    const ext=path.extname(file).toLowerCase();
    const cacheControl=file.endsWith('index.html')||['.css','.js','.mjs'].includes(ext)?'no-cache':'public, max-age=300';
    res.writeHead(200,{'content-type':mime[ext]||'application/octet-stream','cache-control':cacheControl});
    res.end(body);
  }catch{
    const body=await readFile(path.join(distDir,'index.html'));
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});
    res.end(body);
  }
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    if(req.method==='OPTIONS'&&url.pathname.startsWith('/api/')){
      res.writeHead(204,apiHeaders);res.end();return;
    }
    if(url.pathname==='/api/health'){
      const liveStore=await getStore();
      await liveStore.ping();
      const pins=(await liveStore.adminAccessList()).filter(item=>adminTelegramUsernames.includes(normalizeTelegramUsername(item.username)));
      const healthState=enrichStateWithAdminPins(await (await getDomainStore()).loadState(),pins);
      const activeManagers=(Array.isArray(healthState?.team)?healthState.team:[]).filter(item=>item?.active!==false&&String(item?.role||'').trim()==='Менеджер');
      const routableManagerIds=new Set(activeManagers.flatMap(member=>telegram.managerIds({manager:String(member?.name||'').trim()},healthState)));
      const routableManagers=routableManagerIds.size;
      json(res,{ok:true,service:'auto-sale-yandex',persistence:'ydb-serverless',schemaVersion:6,writeMode:'telegram-rbac',stateReadMode:'viewer-filtered',publicDemoWrite:Boolean(publicDemoWrite),maxAdminAccounts:MAX_ADMIN_ACCOUNTS,adminInvites:adminTelegramUsernames.length,linkedAdminAccounts:pins.length,legacyStateWrite:legacyStateWriteEnabled?'rollback-only':'retired',normalizedAuthoritative:ydbReadMode==='normalized'&&!legacyStateWriteEnabled,ydbDomainDualWrite:liveStore.domainDualWriteEnabled?'enabled':'disabled',ydbStateReadMode:ydbReadMode,mediaStorage:mediaBucket?'object-storage':'disabled',mediaBucket:mediaBucket||null,telegramNotifications:telegram.enabled?'enabled':'disabled',telegramFallbackManagers:telegram.fallbackManagerCount,telegramRoutableManagers:routableManagers,telegramRoutingReady:Boolean(telegram.enabled&&routableManagers>0),catalogImport:(catalogImportKey?'secret+github-oidc':'github-oidc'),buildSha:String(process.env.AUTO_SALE_BUILD_SHA||'')});
      return;
    }
    if(url.pathname==='/api/auto-sale/admin/read-parity'&&req.method==='GET'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      const read=await getApiState();
      json(res,{ok:true,configuredMode:ydbReadMode,source:read.source,fallback:Boolean(read.fallback),reason:read.reason||null,shadowVerified:Boolean(read.shadowVerified),authoritative:Boolean(read.authoritative),revision:Number(read.state?.revision)||0});
      return;
    }
    if(url.pathname==='/api/auto-sale/admin/legacy-snapshot'&&req.method==='GET'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      const legacy=await (await getStore()).loadState();
      json(res,{ok:true,retired:!legacyStateWriteEnabled,revision:Number(legacy.revision)||0,state:legacy});
      return;
    }
    if(url.pathname==='/api/auto-sale/admin/catalog-import'&&req.method==='POST'){
      if(!await hasCatalogImportAuth(req)){json(res,{error:'catalog_import_unauthorized'},401);return}
      const input=await parseJson(req,8_000_000);
      const sourceName=String(input?.source||'AutoWorld_Georgia').trim();
      if(sourceName!=='AutoWorld_Georgia'){json(res,{error:'unsupported_catalog_source'},400);return}
      const rawItems=Array.isArray(input?.items)?input.items:[];
      if(!rawItems.length){json(res,{error:'catalog_items_required'},400);return}
      const byIdentity=new Map();
      for(const rawItem of rawItems){
        if(!rawItem||typeof rawItem!=='object')continue;
        const id=String(rawItem.id||'').trim();
        if(!id)continue;
        const item={...structuredClone(rawItem),id,source:sourceName,active:rawItem.active!==false};
        const vin=String(item.vin||'').trim().toUpperCase();
        const key=vin?('vin:'+vin):('id:'+id);
        const previous=byIdentity.get(key);
        if(!previous||Number(item.sourcePostId||0)>=Number(previous.sourcePostId||0))byIdentity.set(key,item);
      }
      const items=[...byIdentity.values()];
      if(!items.length){json(res,{error:'catalog_items_invalid'},400);return}
      const entityStores=await getEntityStores();
      const state=await entityStores.domainStore.loadState();
      const existingCatalog=Array.isArray(state.catalog)?state.catalog:[];
      const sourceExisting=existingCatalog.filter(item=>String(item?.source||'')===sourceName);
      const existingById=new Map(sourceExisting.map(item=>[String(item.id||''),item]));
      const existingByVin=new Map(sourceExisting.filter(item=>String(item.vin||'').trim()).map(item=>[String(item.vin).trim().toUpperCase(),item]));
      const operations=[];
      const retainedIds=new Set();
      let created=0,patched=0,replaced=0,skipped=0,deleted=0;
      for(const item of items){
        const vin=String(item.vin||'').trim().toUpperCase();
        const exact=existingById.get(item.id);
        const sameVin=!exact&&vin?existingByVin.get(vin):null;
        if(exact){
          retainedIds.add(exact.id);
          const next={...exact,...item,id:exact.id,source:sourceName};
          if(stableJson(exact)===stableJson(next)){skipped++;continue}
          const rowVersion=await entityStores.domainStore.entityRowVersion('catalog',exact.id);
          if(rowVersion===null){json(res,{error:'catalog_shadow_missing',id:exact.id},409);return}
          operations.push({resource:'catalog',operation:'patch',id:exact.id,baseRowVersion:rowVersion,input:next});
          patched++;
          continue;
        }
        if(sameVin){
          const incomingPost=Number(item.sourcePostId||0);
          const existingPost=Number(sameVin.sourcePostId||0);
          if(existingPost>incomingPost){retainedIds.add(sameVin.id);skipped++;continue}
          const rowVersion=await entityStores.domainStore.entityRowVersion('catalog',sameVin.id);
          if(rowVersion===null){json(res,{error:'catalog_shadow_missing',id:sameVin.id},409);return}
          operations.push({resource:'catalog',operation:'delete',id:sameVin.id,baseRowVersion:rowVersion});
          operations.push({resource:'catalog',operation:'create',id:item.id,input:item});
          retainedIds.add(item.id);
          replaced++;
          continue;
        }
        operations.push({resource:'catalog',operation:'create',id:item.id,input:item});
        retainedIds.add(item.id);
        created++;
      }
      if(Boolean(input?.replaceSourceAll)){
        const incomingVins=new Set(items.map(item=>String(item.vin||'').trim().toUpperCase()).filter(Boolean));
        for(const existing of sourceExisting){
          const id=String(existing.id||'');
          const vin=String(existing.vin||'').trim().toUpperCase();
          if(retainedIds.has(id)||items.some(item=>item.id===id)||(vin&&incomingVins.has(vin)))continue;
          const rowVersion=await entityStores.domainStore.entityRowVersion('catalog',id);
          if(rowVersion===null)continue;
          operations.push({resource:'catalog',operation:'delete',id,baseRowVersion:rowVersion});
          deleted++;
        }
      }
      if(!operations.length){
        json(res,{ok:true,source:sourceName,received:items.length,created,patched,replaced,deleted,skipped,revision:Number(state.revision)||0,changed:false});
        return;
      }
      const result=await mutateAutoSaleEntityBatch({...entityStores,operations,prepareNotifications:null});
      if(result.status<200||result.status>=300){json(res,result.data,result.status);return}
      json(res,{ok:true,source:sourceName,received:items.length,created,patched,replaced,deleted,skipped,revision:Number(result.data?.revision)||0,changed:true,rowVersions:result.data?.rowVersions||{}});
      return;
    }

    if(url.pathname==='/api/auto-sale/smoke/two-client'&&req.method==='POST'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      if(!telegram.enabled){json(res,{error:'telegram_not_configured'},503);return}
      const entityStores=await getEntityStores();
      const before=await entityStores.domainStore.loadState();
      const suffix=randomUUID().replace(/-/g,'').slice(0,12);
      const leadIds=[`L-SMOKE-${suffix}-A`,`L-SMOKE-${suffix}-B`];
      const users=[
        {id:'999999999999991',username:'autoworld_smoke_a',first_name:'Smoke A'},
        {id:'999999999999992',username:'autoworld_smoke_b',first_name:'Smoke B'}
      ];
      const makeOps=(leadId,user,index)=>[
        {resource:'lead',operation:'create',id:leadId,input:{
          id:leadId,name:`Production Smoke ${index+1}`,contact:`@autoworld_smoke_${index+1}`,
          model:index===0?'Smoke BMW':'Smoke Audi',budget:40000+index*1000
        }},
        {resource:'note',operation:'create',leadId,input:{id:`N-${leadId}`,text:'Automatic production smoke test'}}
      ];
      const sanitized=users.map((user,index)=>sanitizeClientOperations(before,makeOps(leadIds[index],user,index),user));
      const invalid=sanitized.find(item=>!item.ok);
      if(invalid){json(res,{error:'smoke_client_sanitize_failed',detail:invalid},500);return}
      let created=false;
      let smoke={ok:false,checks:{},planned:{manager:0,client:0}};
      const cleanupErrors=[];
      try{
        const createdResult=await mutateAutoSaleEntityBatch({
          ...entityStores,
          operations:sanitized.flatMap(item=>item.operations),
          prepareNotifications:null
        });
        if(createdResult.status<200||createdResult.status>=300){
          json(res,{error:'smoke_create_failed',detail:createdResult.data},createdResult.status||500);
          return;
        }
        created=true;
        const after=await entityStores.domainStore.loadState();
        const visibleA=stateForAccess(after,{role:'client',user:users[0]}).leads||[];
        const visibleB=stateForAccess(after,{role:'client',user:users[1]}).leads||[];
        const planned=await collectTelegramStateChanges({...before,initialized:true},after);
        const managerPlanned=leadIds.filter(leadId=>planned.some(item=>item.event==='lead_created'&&item.leadId===leadId&&item.target==='manager'));
        const clientPlanned=leadIds.filter(leadId=>planned.some(item=>item.event==='lead_created_confirmation'&&item.leadId===leadId&&item.target==='client'));
        smoke={
          ok:true,
          checks:{
            distinctLeadIds:leadIds[0]!==leadIds[1],
            firstClientOwnsOnlyFirst:visibleA.some(item=>item.id===leadIds[0])&&!visibleA.some(item=>item.id===leadIds[1]),
            secondClientOwnsOnlySecond:visibleB.some(item=>item.id===leadIds[1])&&!visibleB.some(item=>item.id===leadIds[0]),
            managerNotificationPlannedForBoth:managerPlanned.length===2,
            clientConfirmationPlannedForBoth:clientPlanned.length===2
          },
          planned:{manager:managerPlanned.length,client:clientPlanned.length}
        };
        smoke.ok=Object.values(smoke.checks).every(Boolean);
      }catch(error){
        smoke={ok:false,error:String(error?.message||error),checks:smoke.checks||{},planned:smoke.planned||{}};
      }finally{
        if(created){
          for(const leadId of leadIds){
            try{
              const rowVersion=await entityStores.domainStore.entityRowVersion('lead',leadId);
              if(rowVersion===null)continue;
              const deleted=await deleteAutoSaleLeadCascade({...entityStores,id:leadId,expectedRowVersion:rowVersion});
              if(deleted.status<200||deleted.status>=300)cleanupErrors.push({leadId,status:deleted.status,error:deleted.data?.error||'cleanup_failed'});
            }catch(error){
              cleanupErrors.push({leadId,error:String(error?.message||error)});
            }
          }
        }
      }
      const ok=Boolean(smoke.ok)&&cleanupErrors.length===0;
      json(res,{ok,leadIds,checks:smoke.checks,planned:smoke.planned,cleanup:{ok:cleanupErrors.length===0,errors:cleanupErrors},error:smoke.error||null},ok?200:500);
      return;
    }

    if(url.pathname==='/api/auto-sale/entities/batch'&&req.method==='POST'){
      const input=await parseJson(req);
      const {state:accessState,access}=await requestAccess(req);
      if(access.role==='public'){json(res,{error:'telegram_auth_required'},401);return}
      let operations=Array.isArray(input?.operations)?input.operations:[];
      if(access.role==='client'){
        const sanitized=sanitizeClientOperations(accessState,operations,access.user);
        if(!sanitized.ok){json(res,{error:sanitized.error},sanitized.status);return}
        operations=sanitized.operations;
      }else{
        operations=sanitizeAdminOperations(operations,{apiKey:access.apiKey});
      }
      const skipTelegram=req.headers['x-auto-sale-skip-telegram']==='1'&&hasApiKey(req);
      const notifyTelegram=telegram.enabled&&!skipTelegram;
      const entityStores=await getEntityStores();
      const result=await mutateAutoSaleEntityBatch({
        ...entityStores,
        operations,
        prepareNotifications:notifyTelegram?collectTelegramStateChanges:null
      });
      if(result.status>=200&&result.status<300&&notifyTelegram){
        const notificationItems=takeCommittedNotificationItems(result.data);
        result.data.notifications={...(result.data.notifications||{}),deliveries:[]};
        json(res,result.data,result.status);
        deferCommittedNotifications(notificationItems,'AUTO SALE entity batch Telegram delivery deferred');
        return;
      }
      json(res,result.data,result.status);return;
    }

    const entityMatch=url.pathname.match(/^\/api\/auto-sale\/(leads|quotes|orders|catalog|team)(?:\/([^/]+))?(?:\/(notes|payments))?$/);
    if(entityMatch){
      const [,plural,rawId,child]=entityMatch;
      const resource=({leads:'lead',quotes:'quote',orders:'order',catalog:'catalog',team:'team'})[plural];
      const id=rawId?decodeURIComponent(rawId):'';
      const {state:accessState,access}=await requestAccess(req);
      if(req.method==='GET'&&id&&!child){
        if(!visibleEntity(accessState,access,resource,id)){json(res,{error:access.role==='public'?'not_found':'forbidden'},access.role==='public'?404:403);return}
        const entityStores=await getEntityStores();
        const result=await readAutoSaleEntity({...entityStores,resource,id});
        json(res,result.data,result.status);return;
      }
      if(access.role!=='admin'){json(res,{error:access.role==='public'?'telegram_auth_required':'admin_required'},access.role==='public'?401:403);return}
      if(resource==='team'&&!hasApiKey(req)){json(res,{error:'team_mutation_requires_batch'},405);return}
      if(req.method==='POST'&&child==='notes'&&resource==='lead'&&id){
        const input=await parseJson(req);
        const skipTelegram=req.headers['x-auto-sale-skip-telegram']==='1';
        const notifyTelegram=telegram.enabled&&!skipTelegram;
        const entityStores=await getEntityStores();
        const result=await addAutoSaleNote({
          ...entityStores,leadId:id,input,
          expectedRowVersion:input?.baseRowVersion,
          prepareNotifications:notifyTelegram?collectTelegramStateChanges:null
        });
        if(result.status>=200&&result.status<300&&notifyTelegram){
          const notificationItems=takeCommittedNotificationItems(result.data);
          result.data.notifications={...(result.data.notifications||{}),deliveries:[]};
          json(res,result.data,result.status);
          deferCommittedNotifications(notificationItems,'AUTO SALE entity Telegram delivery deferred');
          return;
        }
        json(res,result.data,result.status);return;
      }
      if(req.method==='POST'&&child==='payments'&&resource==='order'&&id){
        const input=await parseJson(req);
        const skipTelegram=req.headers['x-auto-sale-skip-telegram']==='1';
        const notifyTelegram=telegram.enabled&&!skipTelegram;
        const entityStores=await getEntityStores();
        const result=await addAutoSalePayment({
          ...entityStores,orderId:id,input,
          expectedRowVersion:input?.baseRowVersion,
          prepareNotifications:notifyTelegram?collectTelegramStateChanges:null
        });
        if(result.status>=200&&result.status<300&&notifyTelegram){
          const notificationItems=takeCommittedNotificationItems(result.data);
          result.data.notifications={...(result.data.notifications||{}),deliveries:[]};
          json(res,result.data,result.status);
          deferCommittedNotifications(notificationItems,'AUTO SALE entity Telegram delivery deferred');
          return;
        }
        json(res,result.data,result.status);return;
      }
      if(child){json(res,{error:'entity_child_route_not_found'},404);return}
      if(req.method==='POST'&&!id){
        const input=await parseJson(req);
        const entityId=String(input?.id||'').trim();
        const skipTelegram=req.headers['x-auto-sale-skip-telegram']==='1';
        const notifyTelegram=telegram.enabled&&!skipTelegram;
        const entityStores=await getEntityStores();
        const result=await mutateAutoSaleEntity({
          ...entityStores,resource,operation:'create',
          id:entityId,input,prepareNotifications:notifyTelegram?collectTelegramStateChanges:null
        });
        if(result.status>=200&&result.status<300&&notifyTelegram){
          const notificationItems=takeCommittedNotificationItems(result.data);
          result.data.notifications={...(result.data.notifications||{}),deliveries:[]};
          json(res,result.data,201);
          deferCommittedNotifications(notificationItems,'AUTO SALE entity Telegram delivery deferred');
          return;
        }
        json(res,result.data,result.status===200?201:result.status);return;
      }
      if(req.method==='PATCH'&&id){
        const input=await parseJson(req);
        const skipTelegram=req.headers['x-auto-sale-skip-telegram']==='1';
        const notifyTelegram=telegram.enabled&&!skipTelegram;
        const entityStores=await getEntityStores();
        const result=await mutateAutoSaleEntity({
          ...entityStores,resource,operation:'patch',
          id,input,expectedRowVersion:input?.baseRowVersion,
          prepareNotifications:notifyTelegram?collectTelegramStateChanges:null
        });
        if(result.status>=200&&result.status<300&&notifyTelegram){
          const notificationItems=takeCommittedNotificationItems(result.data);
          result.data.notifications={...(result.data.notifications||{}),deliveries:[]};
          json(res,result.data,result.status);
          deferCommittedNotifications(notificationItems,'AUTO SALE entity Telegram delivery deferred');
          return;
        }
        json(res,result.data,result.status);return;
      }
      if(req.method==='DELETE'&&id){
        const input=await parseJson(req);
        const entityStores=await getEntityStores();
        const cascade=resource==='lead'&&url.searchParams.get('cascade')==='1';
        const result=cascade
          ?await deleteAutoSaleLeadCascade({
              ...entityStores,id,expectedRowVersion:input?.baseRowVersion
            })
          :await mutateAutoSaleEntity({
              ...entityStores,resource,operation:'delete',
              id,expectedRowVersion:input?.baseRowVersion,prepareNotifications:null
            });
        json(res,result.data,result.status);return;
      }
      json(res,{error:'entity_method_not_allowed'},405);return;
    }

    if(url.pathname==='/api/auto-sale/state'&&req.method==='GET'){
      const read=await getApiState();
      const {access}=await requestAccess(req,read.state);
      const visible=stateForAccess(read.state,access);
      json(res,{...visible,_rowVersions:rowVersionsForAccess(read.rowVersions||{},read.state,access),_access:accessSummary(access)});
      return;
    }
    if(url.pathname==='/api/auto-sale/state'&&req.method==='PUT'){
      if(!legacyStateWriteEnabled){json(res,{error:'legacy_state_write_retired'},410);return}
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      const input=await parseJson(req);
      if(!input||typeof input!=='object'){json(res,{error:'invalid_json'},400);return}
      const skipTelegram=req.headers['x-auto-sale-skip-telegram']==='1'&&hasApiKey(req);
      const notifyTelegram=telegram.enabled&&!skipTelegram;
      const result=await syncYdbState(await getStore(),input,{prepareNotifications:notifyTelegram?collectTelegramStateChanges:null});
      if(result.status>=200&&result.status<300&&notifyTelegram){
        // State persistence is the request's critical path. Telegram delivery is durable
        // through the outbox and must not hold the state response open for tens of seconds.
        const notificationItems=takeCommittedNotificationItems(result.data);
        result.data.notifications.deliveries=[];
        json(res,result.data,result.status);
        deferCommittedNotifications(notificationItems,'AUTO SALE Telegram delivery deferred');
        return;
      }
      json(res,result.data,result.status);
      return;
    }
    if(req.method==='POST'&&url.pathname==='/api/auto-sale/admin/cleanup-test-scenario'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      const input=await parseJson(req);
      const leadId=String(input?.leadId||''),quoteId=String(input?.quoteId||''),orderId=String(input?.orderId||'');
      if(!/^L-QA-[A-Z0-9]+$/.test(leadId)||!/^Q-QA-[A-Z0-9]+$/.test(quoteId)||!/^O-QA-[A-Z0-9]+$/.test(orderId)){
        json(res,{error:'invalid_test_scenario_ids'},400);return;
      }
      const state=await (await getDomainStore()).loadState();
      const next={
        ...state,
        leads:(state.leads||[]).filter(item=>String(item.id)!==leadId),
        quotes:(state.quotes||[]).filter(item=>String(item.id)!==quoteId&&String(item.leadId)!==leadId),
        orders:(state.orders||[]).filter(item=>String(item.id)!==orderId&&String(item.leadId)!==leadId),
        notes:{...(state.notes||{})}
      };
      delete next.notes[leadId];
      const result=await (await getStore()).commitDomainState(state,next,{expectedRevision:state.revision});
      if(result.status!==200){json(res,result.data,result.status);return}
      json(res,{ok:true,revision:result.data.revision,removed:{leadId,quoteId,orderId}});
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/auto-sale/admin/clear-applications'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      const state=await (await getDomainStore()).loadState();
      const cleared={...state,leads:[],quotes:[],orders:[],notes:{}};
      const result=await (await getStore()).commitDomainState(state,cleared,{expectedRevision:state.revision});
      if(result.status!==200){json(res,result.data,result.status);return}
      json(res,{ok:true,cleared:{leads:Array.isArray(state.leads)?state.leads.length:0,quotes:Array.isArray(state.quotes)?state.quotes.length:0,orders:Array.isArray(state.orders)?state.orders.length:0},revision:result.data.revision});
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/auto-sale/notifications/process'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      const ids=url.searchParams.getAll('id').slice(0,12);
      json(res,ids.length?await processNotificationIds(ids):await processNotificationOutbox(50));
      return;
    }
    if(req.method==='GET'&&url.pathname==='/api/auto-sale/notifications/revision'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      const revision=Number(url.searchParams.get('revision')||0);
      if(!Number.isInteger(revision)||revision<1){json(res,{error:'revision_required'},400);return}
      json(res,{ok:true,revision,deliveries:await (await getStore()).notificationStatusByRevision(revision)});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/auto-sale/notifications/status'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      const ids=url.searchParams.getAll('id').slice(0,100);
      json(res,{ok:true,stats:await safeNotificationStats(),deliveries:await (await getStore()).notificationStatus(ids)});return;
    }

    if(req.method==='GET'&&url.pathname==='/api/auto-sale/telegram/diagnose'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      const probe=async target=>{
        const started=Date.now();
        try{
          const response=await fetch(target,{method:'GET',signal:AbortSignal.timeout(8000)});
          return{ok:true,status:response.status,ms:Date.now()-started};
        }catch(error){
          return{ok:false,error:String(error?.message||error),detail:String(error?.cause?.message||error?.cause||''),ms:Date.now()-started};
        }
      };
      const [telegramProbe,publicProbe]=await Promise.all([probe('https://api.telegram.org'),probe('https://example.com')]);
      json(res,{ok:true,telegram:telegramProbe,publicInternet:publicProbe});
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/auto-sale/telegram/test-bot-scenarios'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      if(!telegram.enabled){json(res,{error:'telegram_not_configured'},503);return}
      const chat={id:987654321};
      const from={id:987654321,first_name:'Тест'};
      const scenarios=[
        {name:'start',update:{message:{chat,from,text:'/start'}},expected:'/start',button:true},
        {name:'catalog',update:{message:{chat,from,text:'/catalog'}},expected:'/catalog',button:true},
        {name:'app',update:{message:{chat,from,text:'/app'}},expected:'/app',button:true},
        {name:'help',update:{message:{chat,from,text:'/help'}},expected:'/help',button:true},
        {name:'fallback',update:{message:{chat,from,text:'Здравствуйте'}},expected:'fallback',button:false}
      ];
      const appUrl=process.env.AUTO_SALE_TELEGRAM_APP_URL||'https://autoworld.viiversion.com/';
      const results=[];
      for(const scenario of scenarios){
        const result=await telegram.handleWebhookUpdate(scenario.update,{appUrl,webhookReply:true});
        const payload=result?.webhookPayload||{};
        const webAppUrl=payload?.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app?.url||'';
        results.push({name:scenario.name,ok:result?.handled===scenario.expected&&result?.webhookMethod==='sendMessage'&&(!scenario.button||webAppUrl===appUrl),handled:result?.handled,webhookMethod:result?.webhookMethod,webAppUrl});
      }
      const ignored=await telegram.handleWebhookUpdate({update_id:1},{appUrl,webhookReply:true});
      results.push({name:'non_message_ignored',ok:ignored?.ignored===true});
      json(res,{ok:results.every(item=>item.ok),appUrl,results},results.every(item=>item.ok)?200:500);
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/auto-sale/telegram/test-conversation-delivery'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      if(!telegram.enabled){json(res,{error:'telegram_not_configured'},503);return}
      const pins=await invitedAdminPins();
      const state=enrichStateWithAdminPins(await (await getDomainStore()).loadState(),pins);
      const team=Array.isArray(state.team)?state.team:[];
      const leads=Array.isArray(state.leads)?state.leads:[];
      let lead=leads.find(item=>/^\d+$/.test(String(item?.telegramUserId||''))&&team.some(member=>member?.active!==false&&String(member?.name||'').trim()===String(item?.manager||'').trim()&&/^\d+$/.test(String(member?.telegramUserId||''))));
      if(!lead)lead=leads.find(item=>/^\d+$/.test(String(item?.telegramUserId||'')));
      if(!lead){json(res,{error:'linked_conversation_not_available'},409);return}
      let manager=team.find(item=>item?.active!==false&&String(item?.name||'').trim()===String(lead.manager||'').trim()&&/^\d+$/.test(String(item?.telegramUserId||'')));
      if(!manager)manager=team.find(item=>item?.active!==false&&/^\d+$/.test(String(item?.telegramUserId||'')));
      if(!manager){json(res,{error:'manager_telegram_not_linked'},409);return}
      const conversationState={...state,leads:leads.map(item=>String(item?.id||'')===String(lead.id||'')?{...item,manager:manager.name,managerTelegramUserId:String(manager.telegramUserId)}:item)};
      try{
        const toClient=await telegram.sendManual(conversationState,{leadId:lead.id,target:'client',text:'Проверка канала: менеджер → клиент.',senderId:String(manager.telegramUserId)});
        const toManager=await telegram.sendManual(conversationState,{leadId:lead.id,target:'manager',text:'Проверка канала: клиент → менеджер.',senderId:String(lead.telegramUserId)});
        json(res,{ok:true,leadId:lead.id,manager:{id:manager.id,name:manager.name},managerToClientMessageId:toClient.messageId,clientToManagerMessageId:toManager.messageId},201);
      }catch(error){
        json(res,{error:String(error?.message||'telegram_send_failed'),telegramDescription:String(error?.telegramDescription||'')},Number(error?.statusCode)||500);
      }
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/auto-sale/telegram/test-client-delivery'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      if(!telegram.enabled){json(res,{error:'telegram_not_configured'},503);return}
      const state=await (await getStore()).loadState();
      const lead=(Array.isArray(state.leads)?state.leads:[]).find(item=>/^\d+$/.test(String(item?.telegramUserId||'')));
      if(!lead){json(res,{error:'client_telegram_not_linked'},409);return}
      try{
        const result=await telegram.send(String(lead.telegramUserId),`AUTO МИР · проверка уведомлений клиента\n\nСвязь с вашим заказом настроена. Здесь будут приходить важные изменения по заявке, оплате и этапам доставки автомобиля.`);
        json(res,{ok:true,lead:{id:lead.id,name:lead.name||lead.clientName||''},messageId:result?.message_id||null},201);
      }catch(error){
        json(res,{error:String(error?.message||'telegram_send_failed'),telegramDescription:String(error?.telegramDescription||'')},Number(error?.statusCode)||500);
      }
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/auto-sale/telegram/test-manager-delivery'){
      if(!hasApiKey(req)){json(res,{error:'unauthorized'},401);return}
      if(!telegram.enabled){json(res,{error:'telegram_not_configured'},503);return}
      const pins=await invitedAdminPins();
      const state=enrichStateWithAdminPins(await (await getDomainStore()).loadState(),pins);
      const member=(Array.isArray(state.team)?state.team:[]).find(item=>item?.active!==false&&String(item?.role||'').trim()==='Менеджер'&&/^\d+$/.test(String(item?.telegramUserId||'')));
      if(!member){json(res,{error:'manager_telegram_not_linked'},409);return}
      try{
        const result=await telegram.send(String(member.telegramUserId),`AUTO МИР · проверка уведомлений\n\nСвязь с системой настроена. Уведомления менеджеру доставляются через защищённый канал AutoWorld.`);
        json(res,{ok:true,member:{id:member.id,name:member.name,role:member.role},messageId:result?.message_id||null},201);
      }catch(error){
        json(res,{error:String(error?.message||'telegram_send_failed'),telegramDescription:String(error?.telegramDescription||'')},Number(error?.statusCode)||500);
      }
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/auto-sale/telegram/link-client'){
      if(!telegram.enabled){json(res,{error:'telegram_not_configured'},503);return}
      const auth=telegram.validateInitData(req.headers['x-telegram-init-data']);
      if(!auth.ok){json(res,{error:auth.error},401);return}
      const input=await parseJson(req,20_000);
      const leadId=String(input?.leadId||'').trim();
      if(!leadId){json(res,{error:'lead_id_required'},400);return}
      const current=await readAutoSaleEntity({legacyStore:await getStore(),domainStore:await getDomainStore(),resource:'lead',id:leadId});
      if(current.status!==200){json(res,current.data,current.status);return}
      const lead=current.data.entity;
      const existing=String(lead.telegramUserId||'').trim();
      if(existing&&existing!==String(auth.user.id)){json(res,{error:'client_telegram_already_linked'},409);return}
      const username=String(auth.user.username||'').replace(/^@/,'');
      if(!existing){
        const contact=String(lead.contact||'').trim().replace(/^https?:\/\/t\.me\//i,'@').replace(/\/$/,'');
        if(!username||contact.toLowerCase()!==('@'+username).toLowerCase()){json(res,{error:'client_telegram_link_forbidden'},403);return}
      }
      const patched=await mutateAutoSaleEntity({
        legacyStore:await getStore(),domainStore:await getDomainStore(),resource:'lead',operation:'patch',id:leadId,
        expectedRowVersion:current.data.rowVersion,
        input:{clientCreated:true,telegramUserId:String(auth.user.id),telegramUsername:username,telegramFirstName:String(auth.user.first_name||''),telegramLastName:String(auth.user.last_name||''),telegramDisplayName:[auth.user.first_name,auth.user.last_name].filter(Boolean).join(' ')||username||String(auth.user.id),telegramLinkedAt:new Date().toISOString()},
        prepareNotifications:null
      });
      if(patched.status!==200){json(res,patched.data,patched.status);return}
      json(res,{ok:true,leadId,telegramUserId:String(auth.user.id),revision:patched.data.revision,rowVersion:patched.data.rowVersion});
      return;
    }

    if(req.method==='POST'&&url.pathname==='/api/auto-sale/telegram/register-manager'){
      if(!telegram.enabled){json(res,{error:'telegram_not_configured'},503);return}
      const {access}=await requestAccess(req);
      if(access.role!=='admin'){json(res,{error:'admin_invite_required'},403);return}
      const pins=await invitedAdminPins();
      const routedState=enrichStateWithAdminPins(await (await getDomainStore()).loadState(),pins);
      const username=normalizeTelegramUsername(access.user?.username||access.admin?.username);
      const member=(Array.isArray(routedState.team)?routedState.team:[]).find(item=>memberTelegramUsername(item)===username)||null;
      json(res,{ok:true,unchanged:true,telegramUserId:String(access.user?.id||''),username,access:'admin',member:member?{id:member.id,name:member.name,role:member.role}:null,routingReady:Boolean(member&&/^\d+$/.test(String(member.telegramUserId||'')))});
      return;
    }

    if(req.method==='POST'&&telegram.isWebhookPath(url.pathname)){
      if(!telegram.isWebhookSecretToken(req.headers['x-telegram-bot-api-secret-token'])){
        json(res,{error:'invalid_telegram_webhook_secret'},401);return;
      }
      const input=await parseJson(req,100_000);
      if(!input||typeof input!=='object'){json(res,{error:'invalid_json'},400);return}
      try{
        const claim=await claimAdminFromWebhook(input);
        if(claim&&!claim.ok)console.error('AUTO SALE Telegram admin webhook claim failed',claim.error);
        const result=await telegram.handleWebhookUpdate(input,{appUrl:process.env.AUTO_SALE_TELEGRAM_APP_URL||'https://awgcars.ru/',webhookReply:false});
        json(res,{ok:true,handled:result?.handled||null,ignored:Boolean(result?.ignored),messageId:result?.messageId||null},200);
      }catch(error){
        const status=Number(error?.statusCode)||500;
        json(res,{error:String(error?.message||'telegram_webhook_failed'),telegramDescription:String(error?.telegramDescription||''),detail:String(error?.cause?.message||error?.cause||'')},status);
      }
      return;
    }
    if(url.pathname==='/api/auto-sale/telegram/message'&&req.method==='POST'){
      if(!telegram.enabled){json(res,{error:'telegram_not_configured'},503);return}
      const {state,access}=await requestAccess(req);
      if(access.role==='public'){json(res,{error:'telegram_auth_required'},401);return}
      const input=await parseJson(req,50_000);
      if(!input||typeof input!=='object'){json(res,{error:'invalid_json'},400);return}
      try{
        const result=await telegram.sendManual(state,{
          leadId:input.leadId,
          target:input.target,
          text:input.text,
          senderId:access.user?.id,
          isAdmin:access.role==='admin'
        });
        json(res,result,201);
      }catch(error){
        const status=Number(error?.statusCode)||500;
        json(res,{error:String(error?.message||'telegram_send_failed'),telegramDescription:String(error?.telegramDescription||''),detail:String(error?.cause?.message||error?.cause||'')},status);
      }
      return;
    }
    if(url.pathname==='/api/auto-sale/media'&&req.method==='POST'){
      const {access}=await requestAccess(req);
      if(access.role!=='admin'&&!await hasCatalogImportAuth(req)){json(res,{error:'admin_required'},403);return}
      if(!mediaBucket){json(res,{error:'media_storage_not_configured'},503);return}
      const input=await parseJson(req,3_000_000);
      if(!input||typeof input!=='object'){json(res,{error:'invalid_json'},400);return}
      const result=await media.upload({
        carId:input.carId,
        category:input.category,
        dataUrl:input.dataUrl,
        fileName:input.fileName
      });
      json(res,{ok:true,...result},201);
      return;
    }
    if(url.pathname==='/api/auto-sale/media'&&req.method==='DELETE'){
      const {access}=await requestAccess(req);
      if(access.role!=='admin'){json(res,{error:'admin_required'},403);return}
      if(!mediaBucket){json(res,{error:'media_storage_not_configured'},503);return}
      const input=await parseJson(req,50_000);
      if(!input||typeof input!=='object'){json(res,{error:'invalid_json'},400);return}
      const result=await media.remove(input.url);
      json(res,result);
      return;
    }
    if(url.pathname.startsWith('/api/')){
      json(res,{error:'not_found'},404);
      return;
    }
    await staticFile(res,url);
  }catch(error){
    console.error('AUTO SALE Yandex request failed',error);
    const status=Number(error?.statusCode)||500;
    const code=String(error?.message||'internal_error');
    json(res,{error:status===413?(code==='image_too_large'?'image_too_large':'payload_too_large'):status===400?code:status===503?code:'internal_error'},status);
  }
});
server.listen(port,'0.0.0.0',()=>{
  console.log(`AUTO SALE Yandex listening on ${port}`);
  setTimeout(()=>processNotificationOutbox().catch(error=>console.error('AUTO SALE notification pump failed',error)),5_000).unref();
});
const notificationPump=setInterval(()=>processNotificationOutbox().catch(error=>console.error('AUTO SALE notification pump failed',error)),notificationPumpIntervalMs);
notificationPump.unref();

const shutdown=signal=>{
  console.log(`Received ${signal}`);
  clearInterval(notificationPump);
  server.close(async()=>{
    if(store)await store.close();
    process.exit(0);
  });
  setTimeout(()=>process.exit(1),10000).unref();
};
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
