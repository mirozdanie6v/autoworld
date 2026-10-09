const STAFF_ROLES=new Set(['Менеджер','Директор','Администратор']);
export const MAX_ADMIN_ACCOUNTS=3;

const clean=value=>String(value??'').trim();
const telegramId=value=>/^\d+$/.test(clean(value))?clean(value):'';
const providerId=value=>/^\d+$/.test(clean(value))?clean(value):'';
const providerName=value=>['telegram','vk'].includes(clean(value).toLowerCase())?clean(value).toLowerCase():'';
const username=value=>clean(value).replace(/^@/,'').toLowerCase();
const identityFrom=(value,fallbackProvider='telegram')=>{
  if(value&&typeof value==='object'){
    const provider=providerName(value.provider||value.authType||fallbackProvider);
    const id=providerId(value.id||value.userId||value.providerUserId);
    return provider&&id?{provider,id,key:`${provider}:${id}`}:null;
  }
  const id=providerId(value);
  return id?{provider:'telegram',id,key:`telegram:${id}`}:null;
};
const leadIdentity=lead=>{
  const provider=providerName(lead?.clientProvider);
  const id=providerId(lead?.clientProviderUserId);
  if(provider&&id)return{provider,id,key:`${provider}:${id}`};
  const legacy=telegramId(lead?.telegramUserId);
  return legacy?{provider:'telegram',id:legacy,key:`telegram:${legacy}`}:null;
};

export function staffMembers(state){
  return (Array.isArray(state?.team)?state.team:[]).filter(item=>item&&item.active!==false&&STAFF_ROLES.has(clean(item.role)));
}

export function accessForState(state,{apiKey=false,telegramAuth=null}={}){
  if(apiKey)return{role:'admin',authenticated:true,authType:'api-key',member:null,user:null};
  const user=telegramAuth?.ok?telegramAuth.user:null;
  if(!user?.id)return{role:'public',authenticated:false,authType:'public',member:null,user:null};
  return{role:'client',authenticated:true,authType:'telegram',member:null,user};
}

export function publicState(state){
  return{
    ...state,
    leads:[],quotes:[],orders:[],notes:{},team:[],
    catalog:(Array.isArray(state?.catalog)?state.catalog:[]).filter(item=>item?.active!==false)
  };
}

export function clientState(state,userIdentity){
  const identity=identityFrom(userIdentity);
  const key=identity?.key||'';
  const leads=(Array.isArray(state?.leads)?state.leads:[]).filter(item=>leadIdentity(item)?.key===key);
  const leadIds=new Set(leads.map(item=>clean(item.id)));
  return{
    ...state,
    leads,
    quotes:(Array.isArray(state?.quotes)?state.quotes:[]).filter(item=>leadIds.has(clean(item?.leadId))),
    orders:(Array.isArray(state?.orders)?state.orders:[]).filter(item=>leadIds.has(clean(item?.leadId))),
    notes:{},
    team:[],
    catalog:(Array.isArray(state?.catalog)?state.catalog:[]).filter(item=>item?.active!==false)
  };
}

export function stateForAccess(state,access){
  if(access?.role==='admin')return state;
  if(access?.role==='client')return clientState(state,access?.identity||{provider:access?.authType||'telegram',id:access?.user?.id});
  return publicState(state);
}

export function rowVersionsForAccess(rowVersions,state,access){
  const src=rowVersions||{};
  if(access?.role==='admin')return src;
  const visible=stateForAccess(state,access);
  const ids={
    lead:new Set((visible.leads||[]).map(x=>clean(x.id))),
    quote:new Set((visible.quotes||[]).map(x=>clean(x.id))),
    order:new Set((visible.orders||[]).map(x=>clean(x.id))),
    team:new Set(),
    catalog:new Set((visible.catalog||[]).map(x=>clean(x.id)))
  };
  return Object.fromEntries(['lead','quote','order','team','catalog'].map(resource=>[
    resource,
    Object.fromEntries(Object.entries(src?.[resource]||{}).filter(([key])=>ids[resource].has(clean(key))))
  ]));
}

function allowedLeadPatch(input={}){
  const keys=['name','contact','model','origin','budget','yearFrom','yearTo','mileageMax','engine','drive','damage','deliveryCity','note'];
  return Object.fromEntries(keys.filter(key=>Object.prototype.hasOwnProperty.call(input,key)).map(key=>[key,input[key]]));
}

function clientIdentityPatch(user,identityInput=null){
  const identity=identityFrom(identityInput||{provider:user?.provider||'telegram',id:user?.id});
  const uname=clean(user?.username).replace(/^@/,'');
  const now=new Date().toISOString();
  const base={
    clientCreated:true,
    clientProvider:identity?.provider||'',
    clientProviderUserId:identity?.id||'',
    clientIdentityKey:identity?.key||'',
    clientDisplayName:[clean(user?.first_name),clean(user?.last_name)].filter(Boolean).join(' ')||uname||identity?.id||'',
    clientLinkedAt:now
  };
  if(identity?.provider!=='telegram')return base;
  return{
    ...base,
    telegramUserId:identity.id,
    telegramUsername:uname,
    telegramFirstName:clean(user?.first_name),
    telegramLastName:clean(user?.last_name),
    telegramDisplayName:base.clientDisplayName,
    telegramLinkedAt:now
  };
}

export function sanitizeClientOperations(state,operations,user,identityInput=null){
  const identity=identityFrom(identityInput||{provider:user?.provider||'telegram',id:user?.id});
  if(!identity)return{ok:false,status:401,error:'telegram_auth_required'};
  const source=Array.isArray(operations)?operations:[];
  const ownedLeadIds=new Set((state?.leads||[]).filter(item=>leadIdentity(item)?.key===identity.key).map(item=>clean(item.id)));
  const createdLeadIds=new Set();
  const leadById=new Map((state?.leads||[]).map(item=>[clean(item.id),item]));
  const quoteById=new Map((state?.quotes||[]).map(item=>[clean(item.id),item]));
  const out=[];

  for(const raw of source){
    const operation={...raw,input:raw?.input&&typeof raw.input==='object'?{...raw.input}:raw?.input};
    const resource=clean(operation.resource),action=clean(operation.operation),id=clean(operation.id||operation.input?.id);
    if(resource==='lead'&&action==='create'){
      if(!id)return{ok:false,status:400,error:'lead_id_required'};
      if(leadById.has(id))return{ok:false,status:409,error:'entity_conflict'};
      const input=operation.input||{};
      operation.input={
        ...allowedLeadPatch(input),
        id,
        source:'Mini App',manager:'',status:'Новый',priority:'Средний',
        createdAt:input.createdAt||new Date().toISOString(),nextAction:input.nextAction||new Date().toISOString().slice(0,10),
        deposit:0,depositDate:'',paymentMethod:'',
        ...clientIdentityPatch(user,identity)
      };
      createdLeadIds.add(id);ownedLeadIds.add(id);out.push(operation);continue;
    }
    if(resource==='lead'&&action==='patch'){
      const lead=leadById.get(id);
      if(!lead||!ownedLeadIds.has(id))return{ok:false,status:403,error:'client_entity_forbidden'};
      if(clean(lead.status)!=='Новый')return{ok:false,status:409,error:'client_lead_locked'};
      operation.input=allowedLeadPatch(operation.input||{});
      out.push(operation);continue;
    }
    if(resource==='quote'&&action==='patch'){
      const quote=quoteById.get(id),leadId=clean(quote?.leadId);
      if(!quote||!ownedLeadIds.has(leadId))return{ok:false,status:403,error:'client_entity_forbidden'};
      if(!['Отправлен','На согласовании'].includes(clean(quote.status)))return{ok:false,status:409,error:'client_quote_locked'};
      const requested=clean(operation.input?.clientDecision);
      if(!['agreed','changes_requested'].includes(requested))return{ok:false,status:400,error:'client_decision_required'};
      const now=operation.input?.clientDecisionAt||new Date().toISOString();
      operation.input=requested==='agreed'
        ?{status:'Согласован',clientDecision:'agreed',clientDecisionAt:now,agreedAt:operation.input?.agreedAt||now,updatedAt:operation.input?.updatedAt||now}
        :{status:clean(quote.status)==='Отправлен'?'На согласовании':clean(quote.status),clientDecision:'changes_requested',clientDecisionAt:now,clientComment:clean(operation.input?.clientComment),updatedAt:operation.input?.updatedAt||now};
      out.push(operation);continue;
    }
    if(resource==='note'&&action==='create'){
      const leadId=clean(operation.leadId||operation.id);
      if(!ownedLeadIds.has(leadId)&&!createdLeadIds.has(leadId))return{ok:false,status:403,error:'client_entity_forbidden'};
      const input=operation.input||{};
      operation.input={id:input.id,at:input.at||new Date().toISOString(),text:clean(input.text)};
      out.push(operation);continue;
    }
    return{ok:false,status:403,error:'client_entity_forbidden'};
  }
  return{ok:true,operations:out};
}

function managerActor(state,access){
  if(access?.role!=='admin'||access?.apiKey)return null;
  const userId=telegramId(access?.user?.id);
  const userName=username(access?.user?.username||access?.admin?.username);
  return staffMembers(state).find(item=>{
    if(clean(item?.role)!=='Менеджер')return false;
    const memberId=telegramId(item?.telegramUserId);
    const memberUsername=username(item?.telegramUsername||item?.telegram);
    return Boolean((userId&&memberId===userId)||(userName&&memberUsername===userName));
  })||null;
}

export function applyManagerLeadClaims(state,operations,access,{now=()=>new Date().toISOString()}={}){
  const source=Array.isArray(operations)?operations:[];
  if(access?.apiKey)return{ok:true,operations:source};
  const actor=managerActor(state,access);
  const actorName=clean(actor?.name);
  const actorTelegramId=telegramId(access?.user?.id);
  const actorTelegramUsername=username(access?.user?.username||access?.admin?.username||actor?.telegramUsername||actor?.telegram);
  const leads=new Map((Array.isArray(state?.leads)?state.leads:[]).map(item=>[clean(item.id),{...item}]));
  const out=[];

  for(const raw of source){
    const operation={...raw,input:raw?.input&&typeof raw.input==='object'?{...raw.input}:raw?.input};
    if(clean(operation.resource)!=='lead'||clean(operation.operation)!=='patch'){
      out.push(operation);continue;
    }
    const id=clean(operation.id||operation.input?.id);
    const current=leads.get(id);
    if(!current){out.push(operation);continue}
    const input=operation.input&&typeof operation.input==='object'?{...operation.input}:{};
    const hasStatus=Object.prototype.hasOwnProperty.call(input,'status');
    const statusChanged=hasStatus&&clean(input.status)!==clean(current.status);
    const managerFields=['manager','managerClaimedAt','managerClaimedByTelegramUserId',
      'managerClaimedByTelegramUsername','managerTelegramUserId','managerTelegramUsername'];
    // All manager attribution is server-owned; incoming values cannot impersonate staff.
    for(const key of managerFields)delete input[key];
    if(statusChanged){
      if(!actorName){
        return{ok:false,status:403,error:'manager_identity_required',id};
      }
      // Most recent verified status editor owns this lead, including takeover
      // from an earlier manager. Status concurrency is enforced by row version.
      input.manager=actorName;
      input.managerClaimedAt=now();
      input.managerClaimedByTelegramUserId=actorTelegramId;
      input.managerClaimedByTelegramUsername=actorTelegramUsername;
      // Clearing an old Telegram route avoids notifying the former owner.
      input.managerTelegramUserId=actorTelegramId;
      input.managerTelegramUsername=actorTelegramUsername;
    }

    operation.input=input;
    leads.set(id,{...current,...input,id});
    out.push(operation);
  }
  return{ok:true,operations:out};
}

export function sanitizeAdminOperations(operations,{apiKey=false}={}){
  if(apiKey)return Array.isArray(operations)?operations:[];
  return (Array.isArray(operations)?operations:[]).map(raw=>{
    if(clean(raw?.resource)!=='team'||!raw?.input||typeof raw.input!=='object')return raw;
    const input={...raw.input};
    for(const key of ['telegramUserId','telegramUsername','telegramFirstName','telegramLastName','telegramLinkedAt'])delete input[key];
    return{...raw,input};
  });
}
