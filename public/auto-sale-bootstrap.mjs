const DATA_KEYS={leads:'auto-sale-leads-v2',quotes:'auto-sale-quotes-v2',orders:'auto-sale-orders-v2',notes:'auto-sale-notes-v2',team:'auto-sale-team-v1',catalog:'auto-sale-catalog-v1'};
const REVISION_KEY='auto-sale-server-revision-v1';
window.__AUTO_SALE_LEGACY_AUTOSYNC__=false;
const originalSet=Storage.prototype.setItem;
let suppress=false;
let revision=Number(sessionStorage.getItem(REVISION_KEY)||0);
let rowVersions={lead:{},quote:{},order:{},team:{},catalog:{}};

function telegramInitData(){return String(window.Telegram?.WebApp?.initData||'').trim()}
function vkLaunchParams(){
  const params=new URLSearchParams(window.location.search||'');
  if(!params.get('vk_app_id')||!params.get('vk_user_id')||!params.get('sign'))return'';
  const signed=new URLSearchParams();
  for(const [key,value] of params.entries())if(key==='sign'||key.startsWith('vk_'))signed.append(key,value);
  return signed.toString();
}
function telegramLaunchDetected(){
  return /(?:[?#&])tgWebApp(?:Data|Version|Platform|ThemeParams)=/i.test(String(window.location.href||''));
}
async function ensureTelegramSdk(){
  if(!telegramLaunchDetected()||window.Telegram?.WebApp)return;
  await new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-auto-sale-telegram-sdk]');
    if(existing){
      existing.addEventListener('load',resolve,{once:true});
      existing.addEventListener('error',()=>reject(new Error('telegram_sdk_load_failed')),{once:true});
      return;
    }
    const script=document.createElement('script');
    script.src='https://telegram.org/js/telegram-web-app.js?63';
    script.dataset.autoSaleTelegramSdk='1';
    script.onload=resolve;
    script.onerror=()=>reject(new Error('telegram_sdk_load_failed'));
    document.head.appendChild(script);
  }).catch(error=>console.warn('AUTO SALE Telegram SDK unavailable',error));
}
function bootstrapIdentityScope(){
  const vk=new URLSearchParams(window.location.search||'').get('vk_user_id');
  if(/^\d+$/.test(String(vk||''))&&vkLaunchParams())return 'vk:'+vk;
  const tg=String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id||'');
  if(/^\d+$/.test(tg))return 'telegram:'+tg;
  return 'public';
}
function isolateBootstrapCache(){
  const scopeKey='auto-sale-cache-scope-v1',next=bootstrapIdentityScope(),previous=String(localStorage.getItem(scopeKey)||'');
  const sensitive=[DATA_KEYS.leads,DATA_KEYS.quotes,DATA_KEYS.orders,DATA_KEYS.notes,DATA_KEYS.team];
  if(next==='public'||!previous||previous!==next)for(const key of sensitive)localStorage.removeItem(key);
  localStorage.setItem(scopeKey,next);
}
function appendScript(src,attrs={}){
  if(document.querySelector('script[src="'+src+'"]'))return;
  const script=document.createElement('script');
  script.src=src;
  script.async=true;
  for(const [key,value] of Object.entries(attrs))script.setAttribute(key,value);
  document.head.appendChild(script);
}
function scheduleNonCriticalScripts(){
  const run=()=>{
    appendScript('https://dashboard.viiversion.com/tracker.js',{'data-project':'AUTO SALE'});
    if(new URLSearchParams(window.location.search||'').get('debug')==='1'){
      appendScript('./auto-sale-layout-audit.js?v=20260921-live-values-1');
      appendScript('./auto-sale-api-audit.js?v=20260921-live-values-1');
    }
  };
  if('requestIdleCallback'in window)window.requestIdleCallback(run,{timeout:2500});
  else setTimeout(run,1500);
}
function authHeaders(extra={}){
  const headers={...extra},initData=telegramInitData(),vkParams=vkLaunchParams();
  if(initData)headers['x-telegram-init-data']=initData;
  else if(vkParams)headers['x-vk-launch-params']=vkParams;
  return headers;
}
window.__AUTO_SALE_AUTH_HEADERS__=authHeaders;
window.__AUTO_SALE_ACCESS__={role:'public',authenticated:false,member:null};

function writeCache(key,value){suppress=true;try{originalSet.call(localStorage,key,JSON.stringify(value))}finally{suppress=false}}
window.__AUTO_SALE_CACHE_WRITE__=writeCache;
window.__AUTO_SALE_ROW_VERSIONS__=rowVersions;
function setRowVersions(next){
  rowVersions={lead:{},quote:{},order:{},team:{},catalog:{},...(next||{})};
  for(const key of ['lead','quote','order','team','catalog'])rowVersions[key]={...(rowVersions[key]||{})};
  window.__AUTO_SALE_ROW_VERSIONS__=rowVersions;
}
function aggregateRef(operation){
  const resource=String(operation?.resource||'');
  if(resource==='note')return{resource:'lead',id:String(operation.leadId||operation.id||'')};
  if(resource==='payment')return{resource:'order',id:String(operation.orderId||operation.id||'')};
  return{resource,id:String(operation?.id||operation?.input?.id||'')};
}
function versionFor(resource,id){const value=Number(rowVersions?.[resource]?.[id]);return Number.isInteger(value)&&value>0?value:null}
function applyReturnedVersions(map={}){
  for(const [key,value] of Object.entries(map||{})){
    const split=key.indexOf(':');if(split<1)continue;
    const resource=key.slice(0,split),id=key.slice(split+1);
    if(!rowVersions[resource])rowVersions[resource]={};
    if(value===null)delete rowVersions[resource][id];
    else rowVersions[resource][id]=Number(value)||0;
  }
  window.__AUTO_SALE_ROW_VERSIONS__=rowVersions;
}
async function ensureEntityVersion(resource,id){
  const known=versionFor(resource,id);if(known!==null)return known;
  const plural=({lead:'leads',quote:'quotes',order:'orders',team:'team',catalog:'catalog'})[resource];
  if(!plural||!id)return null;
  try{
    const response=await fetch('/api/auto-sale/'+plural+'/'+encodeURIComponent(id),{headers:authHeaders({accept:'application/json'}),cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return null;
    const value=Number(data.rowVersion);
    if(Number.isInteger(value)&&value>0){
      if(!rowVersions[resource])rowVersions[resource]={};
      rowVersions[resource][id]=value;
      window.__AUTO_SALE_ROW_VERSIONS__=rowVersions;
      return value;
    }
  }catch{}
  return null;
}

function readCache(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
function applyServerState(state){if(!state||!state.initialized)return;writeCache(DATA_KEYS.leads,state.leads||[]);writeCache(DATA_KEYS.quotes,state.quotes||[]);writeCache(DATA_KEYS.orders,state.orders||[]);writeCache(DATA_KEYS.notes,state.notes||{});writeCache(DATA_KEYS.team,state.team||[]);if(Array.isArray(state.catalog))writeCache(DATA_KEYS.catalog,state.catalog)}
async function pullInitialState(){
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await fetch('/api/auto-sale/state',{
        headers:authHeaders({accept:'application/json'}),
        cache:'no-store',
        signal:AbortSignal.timeout(18000)
      });
      if(response.ok){
        const state=await response.json();
        revision=Number(state.revision||0);
        setRowVersions(state._rowVersions||{});
        sessionStorage.setItem(REVISION_KEY,String(revision));
        window.__AUTO_SALE_ACCESS__=state._access||{role:'public',authenticated:false,member:null};
        applyServerState(state);
        window.__AUTO_SALE_SERVER__={online:true,revision,initialized:Boolean(state.initialized),access:window.__AUTO_SALE_ACCESS__};
        window.dispatchEvent(new CustomEvent('auto-sale-server-synced',{detail:{revision,access:window.__AUTO_SALE_ACCESS__}}));
        return state;
      }
      if(![500,502,503,504].includes(response.status))return null;
      lastError=new Error('state_http_'+response.status);
    }catch(error){
      lastError=error;
      if(error?.name!=='TimeoutError'&&!/timeout|aborted/i.test(String(error?.message||'')))break;
    }
    if(attempt<3)await new Promise(resolve=>setTimeout(resolve,350*attempt));
  }
  console.warn('AUTO SALE using offline cache',lastError);
  window.__AUTO_SALE_SERVER__={online:false,revision,error:String(lastError?.message||'state_read_failed')};
  return null;
}

function matchesEntityInput(actual,expected){
  if(Array.isArray(expected))return Array.isArray(actual)&&expected.length===actual.length&&expected.every((value,index)=>matchesEntityInput(actual[index],value));
  if(expected&&typeof expected==='object'){
    if(!actual||typeof actual!=='object')return false;
    return Object.entries(expected).every(([key,value])=>matchesEntityInput(actual[key],value));
  }
  return actual===expected;
}
function operationAppliedToState(state,operation){
  const resource=String(operation?.resource||'');
  if(resource==='note'){
    const leadId=String(operation.leadId||operation.id||''),input=operation.input||{},id=String(input.id||'');
    return (state?.notes?.[leadId]||[]).some(item=>(!id||String(item.id||'')===id)&&matchesEntityInput(item,input));
  }
  if(resource==='payment'){
    const orderId=String(operation.orderId||operation.id||''),input=operation.input||{},id=String(input.id||'');
    const order=(state?.orders||[]).find(item=>String(item.id||'')===orderId);
    return (order?.payments||[]).some(item=>(!id||String(item.id||'')===id)&&matchesEntityInput(item,input));
  }
  const collection=({lead:'leads',quote:'quotes',order:'orders',team:'team',catalog:'catalog'})[resource];
  if(!collection)return false;
  const id=String(operation.id||operation.input?.id||'');
  const entity=(state?.[collection]||[]).find(item=>String(item.id||'')===id);
  if(operation.operation==='delete')return !entity;
  return Boolean(entity&&matchesEntityInput(entity,operation.input||{}));
}
function transientEntityStatus(status){return[500,502,503,504].includes(Number(status))}

function refreshOperationVersions(operations){
  return operations.map(operation=>{
    const next=structuredClone(operation),ref=aggregateRef(next);
    const childCreate=next.operation==='create'&&['note','payment'].includes(String(next.resource||''));
    const topLevelCreate=next.operation==='create'&&!childCreate;
    if(!ref.resource||!ref.id||topLevelCreate)return next;
    const value=versionFor(ref.resource,ref.id);
    if(value!==null)next.baseRowVersion=value;
    return next;
  });
}
async function reconcileAmbiguousBatch(expected,status){
  for(let attempt=1;attempt<=3;attempt++){
    if(attempt>1)await new Promise(resolve=>setTimeout(resolve,700*attempt));
    const state=await pullInitialState();
    if(state&&expected.every(operation=>operationAppliedToState(state,operation))){
      const recovered={ok:true,revision,rowVersions:{},notifications:null,recovered:true,recoveredStatus:status};
      window.__AUTO_SALE_SERVER__={online:true,revision,initialized:true,entityMode:true,recovered:true,recoveredStatus:status};
      window.dispatchEvent(new CustomEvent('auto-sale-entity-synced',{detail:recovered}));
      return recovered;
    }
  }
  return null;
}


async function entityBatch(operations){
  const raw=Array.isArray(operations)?operations.map(item=>structuredClone(item)):[];
  if(!raw.length)return{ok:true,revision,rowVersions:{}};
  const created=new Set(raw.filter(item=>item?.operation==='create'&&!['note','payment'].includes(String(item?.resource||''))).map(item=>{const ref=aggregateRef(item);return ref.resource+':'+ref.id}));
  for(const operation of raw){
    const ref=aggregateRef(operation);
    const childCreate=operation.operation==='create'&&['note','payment'].includes(String(operation.resource||''));
    const topLevelCreate=operation.operation==='create'&&!childCreate;
    if(!ref.resource||!ref.id||topLevelCreate||created.has(ref.resource+':'+ref.id))continue;
    if(operation.baseRowVersion===undefined||operation.baseRowVersion===null){
      const value=await ensureEntityVersion(ref.resource,ref.id);
      if(value===null){
        const error=new Error('row_version_unavailable');error.code='row_version_unavailable';error.data={resource:ref.resource,id:ref.id};throw error;
      }
      operation.baseRowVersion=value;
    }
  }
  try{
    let prepared=raw.map(item=>structuredClone(item));
    let lastError=null;
    for(let attempt=1;attempt<=3;attempt++){
      const response=await fetch('/api/auto-sale/entities/batch',{
        method:'POST',
        headers:authHeaders({'content-type':'application/json'}),
        body:JSON.stringify({operations:prepared})
      });
      const data=await response.json().catch(()=>({}));
      if(response.ok){
        revision=Number(data.revision||revision);
        sessionStorage.setItem(REVISION_KEY,String(revision));
        applyReturnedVersions(data.rowVersions||{});
        window.__AUTO_SALE_SERVER__={online:true,revision,initialized:true,entityMode:true};
        window.dispatchEvent(new CustomEvent('auto-sale-entity-synced',{detail:{revision,rowVersions:data.rowVersions||{},notifications:data.notifications||null}}));
        return{ok:true,...data};
      }

      if(response.status===409&&data.error==='entity_conflict'){
        const recovered=await reconcileAmbiguousBatch(raw,response.status);
        if(recovered)return recovered;
        window.__AUTO_SALE_SERVER__={online:true,revision,entityConflict:true,...data};
        window.dispatchEvent(new CustomEvent('auto-sale-entity-conflict',{detail:data}));
        const error=new Error('entity_conflict');error.code='entity_conflict';error.data=data;throw error;
      }

      if(transientEntityStatus(response.status)){
        const recovered=await reconcileAmbiguousBatch(raw,response.status);
        if(recovered)return recovered;
        lastError=Object.assign(new Error(data.error||('http_'+response.status)),{code:data.error||('http_'+response.status),data:{...data,status:response.status}});
        if(attempt<3){
          prepared=refreshOperationVersions(prepared);
          continue;
        }
        throw lastError;
      }

      window.dispatchEvent(new CustomEvent('auto-sale-entity-rejected',{detail:{...data,status:response.status}}));
      const error=new Error(data.error||('http_'+response.status));error.code=data.error||('http_'+response.status);error.data={...data,status:response.status};throw error;
    }
    throw lastError||new Error('entity_command_failed');
  }catch(error){
    if(error?.code==='entity_conflict')throw error;
    console.warn('AUTO SALE entity command failed',error);
    window.__AUTO_SALE_SERVER__={online:false,revision,error:error?.code||'entity_command_failed'};
    throw error;
  }
}
async function deleteLeadCascade(id){
  const leadId=String(id||'').trim();
  if(!leadId)throw new Error('lead_id_required');
  let lastError=null;
  for(let attempt=1;attempt<=2;attempt++){
    let baseRowVersion=versionFor('lead',leadId);
    if(baseRowVersion===null)baseRowVersion=await ensureEntityVersion('lead',leadId);
    if(baseRowVersion===null)throw Object.assign(new Error('lead_not_found'),{code:'lead_not_found'});
    const response=await fetch('/api/auto-sale/leads/'+encodeURIComponent(leadId)+'?cascade=1',{
      method:'DELETE',
      headers:authHeaders({'content-type':'application/json'}),
      body:JSON.stringify({baseRowVersion})
    });
    const data=await response.json().catch(()=>({}));
    if(response.ok){
      revision=Number(data.revision||revision);
      sessionStorage.setItem(REVISION_KEY,String(revision));
      delete rowVersions.lead?.[leadId];
      for(const quoteId of data.deleted?.quotes||[])delete rowVersions.quote?.[quoteId];
      for(const orderId of data.deleted?.orders||[])delete rowVersions.order?.[orderId];
      window.__AUTO_SALE_ROW_VERSIONS__=rowVersions;
      window.__AUTO_SALE_SERVER__={online:true,revision,initialized:true,entityMode:true};
      window.dispatchEvent(new CustomEvent('auto-sale-lead-deleted',{detail:{leadId,revision,deleted:data.deleted||{}}}));
      return{ok:true,...data};
    }
    lastError=Object.assign(new Error(data.error||('http_'+response.status)),{code:data.error||('http_'+response.status),data:{...data,status:response.status}});
    if(response.status===409&&data.error==='entity_conflict'&&attempt<2){
      delete rowVersions.lead?.[leadId];
      continue;
    }
    throw lastError;
  }
  throw lastError||new Error('lead_delete_failed');
}

window.__AUTO_SALE_ENTITY_BATCH__=entityBatch;
window.__AUTO_SALE_ENTITY_VERSION__=versionFor;
window.__AUTO_SALE_DELETE_LEAD__=deleteLeadCascade;
window.__AUTO_SALE_REFRESH_STATE__=pullInitialState;

function normalizeSettledPaymentField(){
  const form=document.querySelector('#orderForm');if(!form)return;
  const amount=form.elements?.paymentAmount,id=form.elements?.id?.value;if(!amount||!id)return;
  const order=readCache(DATA_KEYS.orders,[]).find(x=>x.id===id);if(!order)return;
  const stageId=form.elements?.paymentStage?.value||'',plan=Array.isArray(order.paymentPlan)?order.paymentPlan:[],stage=plan.find(x=>x.id===stageId),stagePaid=stageId?(Array.isArray(order.payments)?order.payments:[]).filter(x=>x.paymentStage===stageId).reduce((sum,x)=>sum+(Number(x.amount)||0),0):0;
  const remaining=stage?Math.max(0,(Number(stage.amount)||0)-stagePaid):Math.max(0,(Number(order.total)||0)-(Number(order.paid)||0));
  if(remaining<=0){
    amount.value='0';
    amount.removeAttribute('max');
    amount.disabled=true;
    amount.setAttribute('aria-disabled','true');
    amount.dataset.paymentSettled='1';
    amount.classList.remove('auto-field-blocked');
    amount.closest('label')?.querySelector('.auto-field-blocker')?.remove();
    return;
  }
  amount.disabled=false;
  amount.removeAttribute('aria-disabled');
  delete amount.dataset.paymentSettled;
  amount.max=String(remaining);
}

await ensureTelegramSdk();
isolateBootstrapCache();
const vkModule=await import('./auto-sale-vk.mjs?v=20261008-vk-v3');
const vkShellPromise=vkLaunchParams()?vkModule.initVkMiniAppShell():Promise.resolve({ok:true,skipped:'not-vk'});
const initialStatePromise=pullInitialState();
await import('./auto-sale-submit-bridge.mjs?v=20260921-live-values-1');
await import('./auto-sale-app-v3.mjs?v=20260929-entity-cutover-1');
await import('./auto-sale-vk-web.mjs?v=20261008-web-auth-v1');
await import('./auto-sale-ui-business-guard.mjs?v=20260929-entity-cutover-1');
await import('./auto-sale-quote-lead-serialization.mjs');
await import('./auto-sale-quote-save-fix.mjs?v=20260929-entity-cutover-1');
await import('./auto-sale-lead-status-fix.mjs');
await import('./auto-sale-required-fields.mjs');
await import('./auto-sale-director-team.mjs?v=20260929-entity-cutover-1');
await import('./auto-sale-telegram.mjs?v=20260929-entity-cutover-1');
await import('./auto-sale-telegram-id.mjs?v=20260927-safe-chat-link-v2');
await import('./auto-sale-client-quote.mjs?v=20260929-entity-cutover-1');
normalizeSettledPaymentField();
const appRoot=document.querySelector('#app');
if(appRoot)new MutationObserver(()=>queueMicrotask(normalizeSettledPaymentField)).observe(appRoot,{childList:true,subtree:true});
document.addEventListener('input',event=>{if(event.target?.closest?.('#orderForm'))queueMicrotask(normalizeSettledPaymentField)},true);
void vkShellPromise;
void initialStatePromise;
scheduleNonCriticalScripts();
