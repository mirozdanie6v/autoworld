import {randomUUID} from 'node:crypto';
import {syncYdbState} from './ydb-sync.mjs';

const text=value=>String(value??'').trim();
const num=value=>Number(value)||0;
const arr=value=>Array.isArray(value)?value.filter(x=>x&&typeof x==='object'):[];
const clone=value=>structuredClone(value);

const RESOURCE_CONFIG={
  lead:{collection:'leads'},
  quote:{collection:'quotes'},
  order:{collection:'orders'},
  team:{collection:'team'},
  catalog:{collection:'catalog'}
};

function bad(status,error,data={}){return{status,data:{error,...data}}}

function config(resource){
  const value=RESOURCE_CONFIG[resource];
  if(!value)throw new Error('unsupported_entity_resource');
  return value;
}

function findEntity(state,resource,id){
  const {collection}=config(resource);
  return arr(state?.[collection]).find(item=>text(item.id)===text(id))||null;
}

function entityIndex(state,resource,id){
  const {collection}=config(resource);
  return arr(state?.[collection]).findIndex(item=>text(item.id)===text(id));
}

function requireExpectedVersion(value){
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>0?parsed:null;
}

function sanitizePatch(input,id){
  const patch=input&&typeof input==='object'?clone(input):{};
  delete patch.baseRowVersion;
  delete patch.rowVersion;
  if(patch.id!==undefined&&text(patch.id)!==text(id))return null;
  patch.id=id;
  return patch;
}

function nextChildId(prefix){
  return `${prefix}-${randomUUID()}`;
}

function authoritativeSyncStore(legacyStore,domainStore,initialState){
  let loaded=clone(initialState);
  return{
    async loadState(){
      if(!loaded)loaded=await domainStore.loadState();
      return clone(loaded);
    },
    async replaceState(next,options={}){
      if(!loaded)loaded=await domainStore.loadState();
      return legacyStore.commitDomainState(loaded,next,options);
    }
  };
}

function recalcPaid(order){
  const payments=arr(order?.payments);
  return payments.reduce((sum,payment)=>sum+Math.max(0,num(payment.amount)),0);
}

export async function readAutoSaleEntity({legacyStore,domainStore,resource,id}){
  const state=await domainStore.loadState();
  const entity=findEntity(state,resource,id);
  if(!entity)return bad(404,`${resource}_not_found`,{id});
  const rowVersion=await domainStore.entityRowVersion(resource,id);
  if(rowVersion===null)return bad(409,'entity_shadow_missing',{resource,id});
  return{status:200,data:{ok:true,resource,id,rowVersion,revision:Number(state.revision)||0,entity}};
}

export async function mutateAutoSaleEntity({
  legacyStore,
  domainStore,
  resource,
  operation,
  id='',
  input={},
  expectedRowVersion=null,
  prepareNotifications=null,
  maxAttempts=6
}){
  if(typeof legacyStore?.commitDomainState!=='function'||typeof domainStore?.loadState!=='function')return bad(503,'entity_api_requires_normalized_writer');
  if(!RESOURCE_CONFIG[resource])return bad(404,'unsupported_entity_resource',{resource});
  const entityId=text(id||input?.id);
  if(!entityId)return bad(400,'entity_id_required',{resource});

  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const state=await domainStore.loadState();
    const {collection}=config(resource);
    const list=arr(state[collection]).map(item=>clone(item));
    const index=entityIndex(state,resource,entityId);
    const current=index>=0?clone(list[index]):null;
    const currentRowVersion=await domainStore.entityRowVersion(resource,entityId);

    if(operation==='create'){
      if(index>=0||currentRowVersion!==null)return bad(409,'entity_exists',{resource,id:entityId,currentRowVersion});
    }else{
      if(index<0||currentRowVersion===null)return bad(404,`${resource}_not_found`,{id:entityId});
      const expected=requireExpectedVersion(expectedRowVersion);
      if(expected===null)return bad(428,'row_version_required',{resource,id:entityId,currentRowVersion});
      if(expected!==currentRowVersion)return bad(409,'entity_conflict',{resource,id:entityId,expectedRowVersion:expected,currentRowVersion});
    }

    let entity=null;
    if(operation==='create'){
      const patch=sanitizePatch(input,entityId);
      if(!patch)return bad(400,'entity_id_locked',{resource,id:entityId});
      entity=patch;
      list.push(entity);
    }else if(operation==='patch'){
      const patch=sanitizePatch(input,entityId);
      if(!patch)return bad(400,'entity_id_locked',{resource,id:entityId});
      entity={...current,...patch,id:entityId};
      list[index]=entity;
    }else if(operation==='delete'){
      if(resource==='lead'){
        const hasQuote=arr(state.quotes).some(item=>text(item.leadId)===entityId);
        const hasOrder=arr(state.orders).some(item=>text(item.leadId)===entityId);
        if(hasQuote||hasOrder)return bad(409,'lead_has_dependencies',{id:entityId,hasQuote,hasOrder});
      }
      if(!['lead','catalog'].includes(resource))return bad(405,'entity_delete_not_allowed',{resource});
      list.splice(index,1);
    }else{
      return bad(405,'entity_operation_not_allowed',{resource,operation});
    }

    const next={...clone(state),[collection]:list};
    if(resource==='lead'&&operation==='delete'&&next.notes&&typeof next.notes==='object')delete next.notes[entityId];
    const result=await syncYdbState(
      authoritativeSyncStore(legacyStore,domainStore,state),
      {...next,baseRevision:Number(state.revision)||0},
      {prepareNotifications}
    );
    if(result.status===409&&result.data?.error==='revision_conflict')continue;
    if(result.status!==200)return result;

    const rowVersion=operation==='delete'?null:Number(result.data.revision)||0;
    return{
      status:200,
      data:{
        ...result.data,
        resource,
        id:entityId,
        operation,
        rowVersion,
        entity:operation==='delete'?null:entity,
        retries:attempt-1
      }
    };
  }
  return bad(503,'entity_retry_exhausted',{resource,id:entityId});
}

export async function deleteAutoSaleLeadCascade({
  legacyStore,
  domainStore,
  id='',
  expectedRowVersion=null,
  maxAttempts=6
}){
  if(typeof legacyStore?.commitDomainState!=='function'||typeof domainStore?.loadState!=='function')return bad(503,'entity_api_requires_normalized_writer');
  const leadId=text(id);
  if(!leadId)return bad(400,'lead_id_required');

  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const state=await domainStore.loadState();
    const leadIndex=entityIndex(state,'lead',leadId);
    const currentRowVersion=await domainStore.entityRowVersion('lead',leadId);
    if(leadIndex<0||currentRowVersion===null)return bad(404,'lead_not_found',{id:leadId});

    const expected=requireExpectedVersion(expectedRowVersion);
    if(expected===null)return bad(428,'row_version_required',{resource:'lead',id:leadId,currentRowVersion});
    if(expected!==currentRowVersion)return bad(409,'entity_conflict',{resource:'lead',id:leadId,expectedRowVersion:expected,currentRowVersion});

    const relatedQuotes=arr(state.quotes).filter(item=>text(item.leadId)===leadId);
    const relatedOrders=arr(state.orders).filter(item=>text(item.leadId)===leadId);
    const relatedNotes=arr(state.notes?.[leadId]);
    const paymentCount=relatedOrders.reduce((sum,order)=>sum+arr(order?.payments).length,0);

    const next=clone(state);
    next.leads=arr(next.leads).filter(item=>text(item.id)!==leadId);
    next.quotes=arr(next.quotes).filter(item=>text(item.leadId)!==leadId);
    next.orders=arr(next.orders).filter(item=>text(item.leadId)!==leadId);
    next.notes=next.notes&&typeof next.notes==='object'?next.notes:{};
    delete next.notes[leadId];

    const result=await syncYdbState(
      authoritativeSyncStore(legacyStore,domainStore,state),
      {...next,baseRevision:Number(state.revision)||0},
      {prepareNotifications:null}
    );
    if(result.status===409&&result.data?.error==='revision_conflict')continue;
    if(result.status!==200)return result;

    return{
      status:200,
      data:{
        ...result.data,
        resource:'lead',
        id:leadId,
        operation:'delete-cascade',
        rowVersion:null,
        deleted:{
          lead:leadId,
          quotes:relatedQuotes.map(item=>text(item.id)),
          orders:relatedOrders.map(item=>text(item.id)),
          notes:relatedNotes.length,
          payments:paymentCount
        },
        retries:attempt-1
      }
    };
  }
  return bad(503,'entity_retry_exhausted',{resource:'lead',id:leadId});
}

export async function addAutoSaleNote({
  legacyStore,domainStore,leadId,input={},expectedRowVersion,prepareNotifications=null,maxAttempts=6
}){
  const id=text(leadId);
  if(!id)return bad(400,'lead_id_required');
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const state=await domainStore.loadState();
    const lead=findEntity(state,'lead',id);
    if(!lead)return bad(404,'lead_not_found',{id});
    const currentRowVersion=await domainStore.entityRowVersion('lead',id);
    const expected=requireExpectedVersion(expectedRowVersion);
    if(expected===null)return bad(428,'row_version_required',{resource:'lead',id,currentRowVersion});
    if(currentRowVersion===null)return bad(409,'entity_shadow_missing',{resource:'lead',id});
    if(expected!==currentRowVersion)return bad(409,'entity_conflict',{resource:'lead',id,expectedRowVersion:expected,currentRowVersion});
    const body=text(input?.text);
    if(!body)return bad(400,'note_text_required',{leadId:id});
    const note={
      ...(input&&typeof input==='object'?clone(input):{}),
      id:text(input?.id)||nextChildId('NOTE'),
      text:body,
      at:text(input?.at)||new Date().toISOString()
    };
    const notes=state.notes&&typeof state.notes==='object'?clone(state.notes):{};
    notes[id]=arr(notes[id]).map(item=>clone(item));
    if(notes[id].some(item=>text(item.id)===note.id))return bad(409,'note_exists',{leadId:id,id:note.id});
    notes[id].push(note);
    const result=await syncYdbState(authoritativeSyncStore(legacyStore,domainStore,state),{...clone(state),notes,baseRevision:Number(state.revision)||0},{prepareNotifications});
    if(result.status===409&&result.data?.error==='revision_conflict')continue;
    if(result.status!==200)return result;
    return{status:201,data:{...result.data,resource:'lead',id,rowVersion:Number(result.data.revision)||0,note,retries:attempt-1}};
  }
  return bad(503,'entity_retry_exhausted',{resource:'lead',id});
}

export async function addAutoSalePayment({
  legacyStore,domainStore,orderId,input={},expectedRowVersion,prepareNotifications=null,maxAttempts=6
}){
  const id=text(orderId);
  if(!id)return bad(400,'order_id_required');
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const state=await domainStore.loadState();
    const orders=arr(state.orders).map(item=>clone(item));
    const index=orders.findIndex(item=>text(item.id)===id);
    if(index<0)return bad(404,'order_not_found',{id});
    const currentRowVersion=await domainStore.entityRowVersion('order',id);
    const expected=requireExpectedVersion(expectedRowVersion);
    if(expected===null)return bad(428,'row_version_required',{resource:'order',id,currentRowVersion});
    if(currentRowVersion===null)return bad(409,'entity_shadow_missing',{resource:'order',id});
    if(expected!==currentRowVersion)return bad(409,'entity_conflict',{resource:'order',id,expectedRowVersion:expected,currentRowVersion});

    const payment={
      ...(input&&typeof input==='object'?clone(input):{}),
      id:text(input?.id)||nextChildId('PAY'),
      amount:num(input?.amount),
      date:text(input?.date),
      method:text(input?.method)||'Банк',
      createdAt:text(input?.createdAt)||new Date().toISOString()
    };
    const payments=arr(orders[index].payments).map(item=>clone(item));
    if(payments.some(item=>text(item.id)===payment.id))return bad(409,'payment_exists',{orderId:id,id:payment.id});
    payments.push(payment);
    orders[index]={...orders[index],payments};
    orders[index].paid=recalcPaid(orders[index]);

    const result=await syncYdbState(authoritativeSyncStore(legacyStore,domainStore,state),{...clone(state),orders,baseRevision:Number(state.revision)||0},{prepareNotifications});
    if(result.status===409&&result.data?.error==='revision_conflict')continue;
    if(result.status!==200)return result;
    return{
      status:201,
      data:{
        ...result.data,
        resource:'order',
        id,
        rowVersion:Number(result.data.revision)||0,
        payment,
        paid:orders[index].paid,
        retries:attempt-1
      }
    };
  }
  return bad(503,'entity_retry_exhausted',{resource:'order',id});
}


function aggregateKey(resource,id){return resource+':'+text(id)}

async function validateBatchVersions(domainStore,checks){
  for(const check of checks){
    if(check.operation==='create')continue;
    const currentRowVersion=await domainStore.entityRowVersion(check.resource,check.id);
    if(currentRowVersion===null)return bad(404,`${check.resource}_not_found`,{id:check.id});
    const expected=requireExpectedVersion(check.baseRowVersion);
    if(expected===null)return bad(428,'row_version_required',{resource:check.resource,id:check.id,currentRowVersion});
    if(expected!==currentRowVersion)return bad(409,'entity_conflict',{resource:check.resource,id:check.id,expectedRowVersion:expected,currentRowVersion});
  }
  return null;
}

export async function mutateAutoSaleEntityBatch({
  legacyStore,
  domainStore,
  operations=[],
  prepareNotifications=null,
  maxAttempts=6
}){
  if(typeof legacyStore?.commitDomainState!=='function'||typeof domainStore?.loadState!=='function')return bad(503,'entity_api_requires_normalized_writer');
  const ops=arr(operations);
  if(!ops.length)return bad(400,'operations_required');

  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const state=await domainStore.loadState();
    const next=clone(state);
    const checksByKey=new Map();
    const touched=new Map();

    for(const raw of ops){
      const operation=text(raw.operation);
      const resource=text(raw.resource);
      if(!RESOURCE_CONFIG[resource]&&!['note','payment'].includes(resource))return bad(400,'unsupported_entity_resource',{resource});

      if(resource==='note'){
        const leadId=text(raw.leadId||raw.id);
        if(!leadId)return bad(400,'lead_id_required');
        const lead=findEntity(next,'lead',leadId);
        if(!lead)return bad(404,'lead_not_found',{id:leadId});
        const key=aggregateKey('lead',leadId);
        if(!checksByKey.has(key))checksByKey.set(key,{resource:'lead',id:leadId,operation:'patch',baseRowVersion:raw.baseRowVersion});
        const body=text(raw.input?.text);
        if(!body)return bad(400,'note_text_required',{leadId});
        const note={...(raw.input&&typeof raw.input==='object'?clone(raw.input):{}),id:text(raw.input?.id)||nextChildId('NOTE'),text:body,at:text(raw.input?.at)||new Date().toISOString()};
        next.notes=next.notes&&typeof next.notes==='object'?next.notes:{};
        next.notes[leadId]=arr(next.notes[leadId]).map(item=>clone(item));
        if(next.notes[leadId].some(item=>text(item.id)===note.id))return bad(409,'note_exists',{leadId,id:note.id});
        next.notes[leadId].push(note);
        touched.set(key,{resource:'lead',id:leadId});
        continue;
      }

      if(resource==='payment'){
        const orderId=text(raw.orderId||raw.id);
        if(!orderId)return bad(400,'order_id_required');
        const index=arr(next.orders).findIndex(item=>text(item.id)===orderId);
        if(index<0)return bad(404,'order_not_found',{id:orderId});
        const key=aggregateKey('order',orderId);
        if(!checksByKey.has(key))checksByKey.set(key,{resource:'order',id:orderId,operation:'patch',baseRowVersion:raw.baseRowVersion});
        const order=clone(next.orders[index]);
        const payment={...(raw.input&&typeof raw.input==='object'?clone(raw.input):{}),id:text(raw.input?.id)||nextChildId('PAY'),amount:num(raw.input?.amount),date:text(raw.input?.date),method:text(raw.input?.method)||'Банк',createdAt:text(raw.input?.createdAt)||new Date().toISOString()};
        const payments=arr(order.payments).map(item=>clone(item));
        if(payments.some(item=>text(item.id)===payment.id))return bad(409,'payment_exists',{orderId,id:payment.id});
        payments.push(payment);
        order.payments=payments;
        order.paid=recalcPaid(order);
        next.orders[index]=order;
        touched.set(key,{resource:'order',id:orderId});
        continue;
      }

      const id=text(raw.id||raw.input?.id);
      if(!id)return bad(400,'entity_id_required',{resource});
      const {collection}=config(resource);
      const list=arr(next[collection]).map(item=>clone(item));
      const index=list.findIndex(item=>text(item.id)===id);
      const key=aggregateKey(resource,id);

      if(operation==='create'){
        if(index>=0)return bad(409,'entity_exists',{resource,id});
        const patch=sanitizePatch(raw.input||{},id);
        if(!patch)return bad(400,'entity_id_locked',{resource,id});
        list.push(patch);
        next[collection]=list;
        if(!checksByKey.has(key))checksByKey.set(key,{resource,id,operation:'create'});
      }else if(operation==='patch'){
        if(index<0)return bad(404,`${resource}_not_found`,{id});
        if(!checksByKey.has(key))checksByKey.set(key,{resource,id,operation:'patch',baseRowVersion:raw.baseRowVersion});
        const patch=sanitizePatch(raw.input||{},id);
        if(!patch)return bad(400,'entity_id_locked',{resource,id});
        list[index]={...list[index],...patch,id};
        next[collection]=list;
      }else if(operation==='delete'){
        if(index<0)return bad(404,`${resource}_not_found`,{id});
        if(!checksByKey.has(key))checksByKey.set(key,{resource,id,operation:'delete',baseRowVersion:raw.baseRowVersion});
        if(resource==='lead'){
          const hasQuote=arr(next.quotes).some(item=>text(item.leadId)===id);
          const hasOrder=arr(next.orders).some(item=>text(item.leadId)===id);
          if(hasQuote||hasOrder)return bad(409,'lead_has_dependencies',{id,hasQuote,hasOrder});
        }
        if(!['lead','catalog'].includes(resource))return bad(405,'entity_delete_not_allowed',{resource});
        list.splice(index,1);
        next[collection]=list;
        if(resource==='lead'&&next.notes&&typeof next.notes==='object')delete next.notes[id];
      }else return bad(405,'entity_operation_not_allowed',{resource,operation});

      touched.set(key,{resource,id,deleted:operation==='delete'});
    }

    const versionError=await validateBatchVersions(domainStore,[...checksByKey.values()]);
    if(versionError)return versionError;

    const result=await syncYdbState(
      authoritativeSyncStore(legacyStore,domainStore,state),
      {...next,baseRevision:Number(state.revision)||0},
      {prepareNotifications}
    );
    if(result.status===409&&result.data?.error==='revision_conflict')continue;
    if(result.status!==200)return result;

    const revision=Number(result.data.revision)||0;
    return{
      status:200,
      data:{
        ...result.data,
        operation:'batch',
        retries:attempt-1,
        rowVersions:Object.fromEntries([...touched.entries()].map(([key,item])=>[key,item.deleted?null:revision]))
      }
    };
  }
  return bad(503,'entity_retry_exhausted',{operation:'batch'});
}
