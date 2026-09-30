import type { AnyRecord,D1DatabaseLike } from './types.js';
import { bumpRevision,loadState,putLead,putNote,putOrder,putPayment,putQuote,putTeamMember } from './storage.js';
import { leadTransitionAllowed,quoteTransitionAllowed,validateLead,validateOrder,validateQuote } from './rules.js';

const arr=(v:unknown):AnyRecord[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object') as AnyRecord[]:[];
const text=(v:unknown)=>String(v??'').trim();
const num=(v:unknown)=>Number(v)||0;
const same=(a:unknown,b:unknown)=>String(a??'')===String(b??'');
const latestQuote=(quotes:AnyRecord[],leadId:string)=>quotes.filter(q=>text(q.leadId)===leadId).sort((a,b)=>num(b.version)-num(a.version))[0];
const bad=(error:string,data:AnyRecord={}):{status:number,data:AnyRecord}=>({status:400,data:{error,...data}});

export async function syncState(db:D1DatabaseLike,input:AnyRecord):Promise<{status:number,data:AnyRecord}>{
  const previous=await loadState(db),current=Number(previous.revision)||0,supplied=input.baseRevision;
  if(supplied!==undefined&&supplied!==null&&Number(supplied)!==current)return{status:409,data:{error:'revision_conflict',currentRevision:current,state:previous}};

  const leads=arr(input.leads);
  const quotes=arr(input.quotes);
  const orders=arr(input.orders);
  const team=arr(input.team);
  const rawNotes=(input.notes&&typeof input.notes==='object'?input.notes:{}) as Record<string,unknown>;
  const notes=rawNotes;
  const previousLeads=new Map(arr(previous.leads).map(x=>[text(x.id),x]));
  const previousQuotes=new Map(arr(previous.quotes).map(x=>[text(x.id),x]));
  const previousOrders=new Map(arr(previous.orders).map(x=>[text(x.id),x]));
  const initialized=Boolean(previous.initialized);

  for(const member of team){
    if(!text(member.id)||!text(member.name))return bad('invalid_team_member',{id:member.id||'',details:['Укажите имя сотрудника.']});
    if(!['Директор','Менеджер','Логист','Администратор'].includes(text(member.role)))return bad('invalid_team_role',{id:member.id,role:member.role});
  }

  for(const lead of leads){
    const errors=validateLead(lead);if(errors.length)return bad('invalid_lead',{id:lead.id,details:errors});
    const before=previousLeads.get(text(lead.id));
    if(initialized&&before){
      const agreed=quotes.some(q=>text(q.leadId)===text(lead.id)&&text(q.status)==='Согласован');
      if(!leadTransitionAllowed(text(before.status),text(lead.status),{hasAgreedQuote:agreed,deposit:num(lead.deposit)}))return bad('invalid_lead_transition',{id:lead.id,from:before.status,to:lead.status});
    }
  }

  for(const quote of quotes){
    const errors=validateQuote(quote);if(errors.length)return bad('invalid_quote',{id:quote.id,details:errors});
    const before=previousQuotes.get(text(quote.id));
    if(initialized&&before){
      if(!same(before.leadId,quote.leadId))return bad('quote_lead_locked',{id:quote.id});
      if(!quoteTransitionAllowed(text(before.status),text(quote.status)))return bad('invalid_quote_transition',{id:quote.id,from:before.status,to:quote.status});
      if(['Согласован','Отказ'].includes(text(before.status)))for(const key of ['leadId','model','lot','auction','inland','ocean','customs','repair','service','total','version','validUntil'])if(!same(before[key],quote[key]))return bad('locked_quote_changed',{id:quote.id,field:key});
    }else if(initialized&&!quoteTransitionAllowed('',text(quote.status)))return bad('invalid_initial_quote_status',{id:quote.id,status:quote.status});
  }

  const seenLeadOrders=new Set<string>();
  for(const order of orders){
    const leadId=text(order.leadId);
    if(seenLeadOrders.has(leadId))return bad('duplicate_order_for_lead',{leadId});
    seenLeadOrders.add(leadId);
    const before=previousOrders.get(text(order.id)),errors=validateOrder(order,initialized&&before?text(before.stage):'');
    if(errors.length)return bad('invalid_order',{id:order.id,details:errors});
    if(initialized&&before){
      for(const key of ['leadId','model','total','cost'])if(!same(before[key],order[key]))return bad('locked_order_field_changed',{id:order.id,field:key});
    }else if(initialized){
      if(text(order.stage)!=='Выкуп')return bad('new_order_must_start_at_purchase',{id:order.id,stage:order.stage});
      const lead=leads.find(x=>text(x.id)===leadId),quote=latestQuote(quotes,leadId);
      if(!lead||text(lead.status)!=='Сделка'||!quote||text(quote.status)!=='Согласован'||num(lead.deposit)<=0)return bad('order_prerequisites_missing',{id:order.id});
      if([...previousOrders.values()].some(x=>text(x.leadId)===leadId))return bad('duplicate_order_for_lead',{leadId});
    }
  }

  for(const member of team)await putTeamMember(db,member);
  for(const lead of leads)await putLead(db,lead);
  for(const quote of quotes)await putQuote(db,quote);
  for(const order of orders){await putOrder(db,order);for(const payment of arr(order.payments))await putPayment(db,text(order.id),payment)}
  for(const [leadId,value] of Object.entries(notes)){const list=arr(value);for(let i=0;i<list.length;i++)await putNote(db,leadId,list[i]!,i)}
  return{status:200,data:{ok:true,revision:await bumpRevision(db)}};
}
