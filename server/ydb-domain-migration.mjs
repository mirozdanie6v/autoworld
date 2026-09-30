import {createHash} from 'node:crypto';

const arr=value=>Array.isArray(value)?value.filter(x=>x&&typeof x==='object'):[];
const text=value=>String(value??'').trim();
const num=value=>Number(value)||0;
const clone=value=>value===undefined?undefined:structuredClone(value);
const bool=value=>value!==false&&value!==0&&value!=='0';

function internalId(prefix,ownerId,item,index){
  return text(item?.id)||`${prefix}-${ownerId}-${String(index+1).padStart(4,'0')}`;
}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  }
  return value;
}
function binding(subjectType,subjectId,payload){
  const telegramUserId=text(payload?.telegramUserId);
  if(!subjectId||!/^-?\d+$/.test(telegramUserId))return null;
  return{
    subjectType,
    subjectId,
    telegramUserId,
    username:text(payload?.telegramUsername||payload?.telegram),
    firstName:text(payload?.telegramFirstName),
    lastName:text(payload?.telegramLastName),
    linkedAt:text(payload?.telegramLinkedAt)
  };
}

export function legacyStateToDomainRows(state={}){
  const leads=arr(state.leads).map((payload,index)=>({
    id:text(payload.id),
    rowVersion:1,
    sortOrder:index,
    status:text(payload.status)||'Новый',
    manager:text(payload.manager),
    source:text(payload.source)||'Mini App',
    clientCreated:Boolean(payload.clientCreated),
    payload:clone(payload),
    updatedAt:text(payload.updatedAt||payload.createdAt)
  }));
  const quotes=arr(state.quotes).map((payload,index)=>({
    id:text(payload.id),
    rowVersion:1,
    sortOrder:index,
    leadId:text(payload.leadId),
    status:text(payload.status)||'Черновик',
    quoteVersion:Math.max(1,num(payload.version)),
    payload:clone(payload),
    updatedAt:text(payload.updatedAt||payload.sentAt||payload.agreedAt)
  }));
  const payments=[];
  const orders=arr(state.orders).map((source,index)=>{
    const payload=clone(source);
    const orderPayments=arr(payload.payments);
    delete payload.payments;
    for(let paymentIndex=0;paymentIndex<orderPayments.length;paymentIndex++){
      const payment=orderPayments[paymentIndex];
      payments.push({
        orderId:text(source.id),
        id:internalId('PAY',text(source.id),payment,paymentIndex),
        sortOrder:paymentIndex,
        amount:num(payment.amount),
        paymentDate:text(payment.date),
        method:text(payment.method)||'Банк',
        payload:clone(payment),
        createdAt:text(payment.createdAt||payment.date)
      });
    }
    return{
      id:text(source.id),
      rowVersion:1,
      sortOrder:index,
      leadId:text(source.leadId),
      stage:text(source.stage)||'Выкуп',
      manager:text(source.manager),
      riskType:text(source.riskType||source.risk)||'Нет',
      payload,
      updatedAt:text(source.updatedAt)
    };
  });
  const notes=[];
  const rawNotes=state.notes&&typeof state.notes==='object'?state.notes:{};
  for(const [leadId,value] of Object.entries(rawNotes)){
    const list=arr(value);
    for(let index=0;index<list.length;index++){
      const note=list[index];
      notes.push({
        leadId:text(leadId),
        id:internalId('NOTE',text(leadId),note,index),
        sortOrder:index,
        text:text(note.text),
        payload:clone(note),
        createdAt:text(note.at||note.createdAt)
      });
    }
  }
  const team=arr(state.team).map((payload,index)=>({
    id:text(payload.id),
    rowVersion:1,
    sortOrder:index,
    name:text(payload.name),
    role:text(payload.role)||'Менеджер',
    active:bool(payload.active),
    payload:clone(payload),
    updatedAt:text(payload.updatedAt||payload.telegramLinkedAt)
  }));
  const catalog=arr(state.catalog).map((payload,index)=>({
    id:text(payload.id),
    rowVersion:1,
    sortOrder:index,
    origin:text(payload.origin||payload.country),
    active:bool(payload.active),
    auctionDate:text(payload.auctionDate),
    payload:clone(payload),
    updatedAt:text(payload.updatedAt)
  }));
  const telegramBindings=[
    ...arr(state.leads).map(item=>binding('client',text(item.id),item)),
    ...arr(state.team).map(item=>binding('staff',text(item.id),item))
  ].filter(Boolean);

  return{
    revision:Number(state.revision)||0,
    initialized:Boolean(state.initialized),
    leads,quotes,orders,payments,notes,team,catalog,telegramBindings
  };
}

const sortRows=rows=>[...arr(rows)].sort((a,b)=>(num(a.sortOrder)-num(b.sortOrder))||text(a.id).localeCompare(text(b.id)));
const payloadOf=row=>clone(row?.payload&&typeof row.payload==='object'?row.payload:{});

export function domainRowsToLegacyState(rows={},options={}){
  const leads=sortRows(rows.leads).map(payloadOf);
  const quotes=sortRows(rows.quotes).map(payloadOf);
  const team=sortRows(rows.team).map(payloadOf);
  const catalog=sortRows(rows.catalog).map(payloadOf);
  const paymentMap=new Map();
  for(const row of sortRows(rows.payments)){
    const key=text(row.orderId);
    const list=paymentMap.get(key)||[];
    list.push(payloadOf(row));
    paymentMap.set(key,list);
  }
  const orders=sortRows(rows.orders).map(row=>({
    ...payloadOf(row),
    payments:paymentMap.get(text(row.id))||[]
  }));
  const notes={};
  const grouped=new Map();
  for(const row of sortRows(rows.notes)){
    const key=text(row.leadId);
    const list=grouped.get(key)||[];
    list.push(row);
    grouped.set(key,list);
  }
  for(const [leadId,list] of grouped){
    notes[leadId]=sortRows(list).map(payloadOf);
  }
  return{
    revision:Number(options.revision??rows.revision)||0,
    initialized:options.initialized??rows.initialized??leads.length>0,
    leads,quotes,orders,notes,team,catalog
  };
}

export function canonicalAutoSaleState(state={}){
  const sourceNotes=state.notes&&typeof state.notes==='object'?state.notes:{};
  const notes=Object.fromEntries(Object.entries(sourceNotes).filter(([,value])=>!(Array.isArray(value)&&value.length===0)));
  return stable({
    initialized:Boolean(state.initialized),
    leads:arr(state.leads),
    quotes:arr(state.quotes),
    orders:arr(state.orders),
    notes,
    team:arr(state.team),
    catalog:arr(state.catalog)
  });
}

export function autoSaleStateHash(state={}){
  return createHash('sha256').update(JSON.stringify(canonicalAutoSaleState(state))).digest('hex');
}

export function compareLegacyAndDomainState(legacy,rows){
  const reconstructed=domainRowsToLegacyState(rows,{
    revision:Number(legacy?.revision)||0,
    initialized:Boolean(legacy?.initialized)
  });
  const legacyHash=autoSaleStateHash(legacy);
  const domainHash=autoSaleStateHash(reconstructed);
  const counts={
    leads:arr(reconstructed.leads).length,
    quotes:arr(reconstructed.quotes).length,
    orders:arr(reconstructed.orders).length,
    payments:arr(rows?.payments).length,
    notes:arr(rows?.notes).length,
    team:arr(reconstructed.team).length,
    catalog:arr(reconstructed.catalog).length,
    telegramBindings:arr(rows?.telegramBindings).length
  };
  return{ok:legacyHash===domainHash,legacyHash,domainHash,counts,reconstructed};
}
