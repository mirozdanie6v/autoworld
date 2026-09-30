import type { AnyRecord } from './types.js';

export const LEAD_STATUSES=['Новый','В работе','Расчёт','Ожидает клиента','Сделка','Отказ'];
export const QUOTE_STATUSES=['Черновик','Отправлен','На согласовании','Согласован','Отказ'];
export const ORDER_STAGES=['Запрос','Подбор','Расчёт','Согласование','Выкуп','Порт США','В море','Таможня','Доставка','Выдача'];
const ACTIVE_LEAD_STATUSES=['Новый','В работе','Расчёт','Ожидает клиента'];
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const num=(v:unknown)=>Number(v)||0;
const records=(v:unknown):AnyRecord[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object') as AnyRecord[]:[];
const quoteSum=(q:AnyRecord)=>['lot','auction','inland','ocean','customs','repair','service'].reduce((sum,key)=>sum+num(q[key]),0);

export function leadTransitionAllowed(from:string,to:string,{hasAgreedQuote=false,deposit=0}:{hasAgreedQuote?:boolean,deposit?:number}={}):boolean{
  if(from===to)return true;
  if(to==='Отказ')return from!=='Сделка'&&from!=='Отказ';
  const allowed:Record<string,string[]>={'Новый':['В работе'],'В работе':['Новый','Расчёт','Ожидает клиента'],'Расчёт':['В работе','Ожидает клиента'],'Ожидает клиента':['Расчёт','Сделка'],'Сделка':[],'Отказ':[]};
  if(!(allowed[from]||[]).includes(to))return false;
  if(to==='Сделка')return hasAgreedQuote&&num(deposit)>0;
  return true;
}
export function quoteTransitionAllowed(from:string,to:string):boolean{
  if(!from)return['Черновик','Отправлен'].includes(to);
  if(from===to)return true;
  const allowed:Record<string,string[]>={'Черновик':['Отправлен'],'Отправлен':['На согласовании','Согласован','Отказ'],'На согласовании':['Согласован','Отказ'],'Согласован':[],'Отказ':[]};
  return(allowed[from]||[]).includes(to);
}
export function nextStageAllowed(from:string,to:string):boolean{
  const a=ORDER_STAGES.indexOf(from),b=ORDER_STAGES.indexOf(to);
  return a>=0&&b>=0&&(b===a||b===a+1);
}
export function validateLead(lead:AnyRecord):string[]{
  const errors:string[]=[];
  const status=text(lead.status)||'Новый';
  if(!text(lead.name))errors.push('name_required');
  if(!text(lead.contact))errors.push('contact_required');
  if(!text(lead.model))errors.push('model_required');
  if(!LEAD_STATUSES.includes(status))errors.push('invalid_lead_status');
  if(ACTIVE_LEAD_STATUSES.includes(status)&&!text(lead.nextAction))errors.push('next_action_required');
  if(status==='Отказ'&&!text(lead.lostReason))errors.push('lost_reason_required');
  return errors;
}
export function validateQuote(quote:AnyRecord):string[]{
  const errors:string[]=[];
  const status=text(quote.status)||'Черновик';
  if(!text(quote.leadId))errors.push('lead_required');
  if(!text(quote.model))errors.push('model_required');
  if(!QUOTE_STATUSES.includes(status))errors.push('invalid_quote_status');
  if(status!=='Черновик'){
    for(const key of ['lot','auction','inland','ocean','customs','service'])if(num(quote[key])<=0)errors.push(`${key}_positive_required`);
    if(num(quote.repair)<0)errors.push('repair_nonnegative_required');
    if(num(quote.total)<=0)errors.push('positive_total_required');
    if(num(quote.total)!==quoteSum(quote))errors.push('quote_total_mismatch');
    if(!text(quote.validUntil))errors.push('valid_until_required');
  }
  return errors;
}
export function validateOrder(order:AnyRecord,previousStage=''):string[]{
  const errors:string[]=[];
  const stage=text(order.stage);
  if(!text(order.leadId))errors.push('lead_required');
  if(!ORDER_STAGES.includes(stage))errors.push('invalid_order_stage');
  if(previousStage&&!nextStageAllowed(previousStage,stage))errors.push('invalid_stage_transition');
  if(ORDER_STAGES.indexOf(stage)>=ORDER_STAGES.indexOf('Порт США')){
    if(!text(order.lot))errors.push('lot_required');
    if(!text(order.vin))errors.push('vin_required');
    if(!text(order.eta))errors.push('eta_required');
    if(!text(order.location))errors.push('location_required');
  }
  if(text(order.riskType)&&text(order.riskType)!=='Нет'&&!text(order.riskNote))errors.push('risk_note_required');
  const payments=records(order.payments);let paid=0;
  for(const payment of payments){const amount=num(payment.amount);if(amount<=0)errors.push('payment_amount_positive_required');if(!text(payment.date))errors.push('payment_date_required');if(!text(payment.method))errors.push('payment_method_required');paid+=Math.max(0,amount)}
  if(num(order.total)>0&&paid>num(order.total))errors.push('payment_total_exceeds_order');
  if(stage==='Выдача'&&num(order.total)>0&&paid<num(order.total))errors.push('full_payment_required_for_handoff');
  return[...new Set(errors)];
}
