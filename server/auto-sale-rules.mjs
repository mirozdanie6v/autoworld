export const LEAD_STATUSES=['Новый','В работе','Расчёт','Ожидает клиента','Сделка','Отказ'];
export const QUOTE_STATUSES=['Черновик','Отправлен','На согласовании','Согласован','Отказ'];
export const ORDER_STAGES=['Запрос','Подбор','Расчёт','Согласование','Выкуп','Подготовка к отправке','В пути','Таможня','Доставка','Выдача'];
const LEGACY_ORDER_STAGES={'Порт США':'Подготовка к отправке','В море':'В пути'};
const normalizeStage=stage=>LEGACY_ORDER_STAGES[stage]||stage;
const stageIndex=stage=>ORDER_STAGES.indexOf(normalizeStage(stage));

const ACTIVE_LEAD_STATUSES=['Новый','В работе','Расчёт','Ожидает клиента'];
const text=v=>typeof v==='string'?v.trim():'';
const num=v=>Number(v)||0;
const records=v=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'):[];
const quoteSum=q=>['lot','auction','inland','ocean','customs','repair','service'].reduce((sum,key)=>sum+num(q[key]),0);
const PAYMENT_STAGE_IDS=['auction_deposit','auction_balance','logistics_legalization','customs_fts'];

const verification=value=>value&&typeof value==='object'?value:{};
const verificationPhotos=value=>Array.isArray(verification(value).photos)?verification(value).photos.filter(Boolean):[];
export function validateVehicleVerification(quote){
  const v=verification(quote.verification),errors=[];
  if(!text(v.lotNumber))errors.push('verification_lot_required');
  if(!text(v.vin))errors.push('verification_vin_required');
  if(num(v.year)<1900)errors.push('verification_year_required');
  if(Number(v.mileage)<0||!Number.isFinite(Number(v.mileage)))errors.push('verification_mileage_invalid');
  if(!text(v.damage))errors.push('verification_damage_required');
  const photos=verificationPhotos(v);
  if(!photos.length)errors.push('verification_photo_required');
  if(photos.some(x=>!/^https?:\/\//i.test(text(x))))errors.push('verification_photo_invalid');
  if(!text(v.reportUrl)&&!text(v.history))errors.push('verification_report_required');
  if(text(v.reportUrl)&&!/^https?:\/\//i.test(text(v.reportUrl)))errors.push('verification_report_invalid');
  if(!text(v.checkedAt))errors.push('verification_date_required');
  if(text(v.result)!=='Одобрен к покупке')errors.push('verification_approval_required');
  return errors;
}

export function leadTransitionAllowed(from,to,{hasAgreedQuote=false,deposit=0}={}){
  if(from===to)return true;
  if(to==='Отказ')return from!=='Сделка'&&from!=='Отказ';
  const allowed={'Новый':['В работе'],'В работе':['Новый','Расчёт','Ожидает клиента'],'Расчёт':['В работе','Ожидает клиента'],'Ожидает клиента':['Расчёт','Сделка'],'Сделка':[],'Отказ':[]};
  if(!(allowed[from]||[]).includes(to))return false;
  if(to==='Сделка')return hasAgreedQuote&&num(deposit)>0;
  return true;
}

export function quoteTransitionAllowed(from,to){
  if(!from)return['Черновик','Отправлен'].includes(to);
  if(from===to)return true;
  const allowed={'Черновик':['Отправлен'],'Отправлен':['На согласовании','Согласован','Отказ'],'На согласовании':['Согласован','Отказ'],'Согласован':[],'Отказ':[]};
  return(allowed[from]||[]).includes(to);
}

export function nextStageAllowed(from,to){
  const a=stageIndex(from),b=stageIndex(to);
  return a>=0&&b>=0&&(b===a||b===a+1);
}

export function validateLead(lead){
  const errors=[];
  const status=text(lead.status)||'Новый';
  if(!text(lead.name))errors.push('name_required');
  if(!text(lead.contact))errors.push('contact_required');
  if(!text(lead.model))errors.push('model_required');
  if(!LEAD_STATUSES.includes(status))errors.push('invalid_lead_status');
  if(ACTIVE_LEAD_STATUSES.includes(status)&&!text(lead.nextAction))errors.push('next_action_required');
  if(status==='Отказ'&&!text(lead.lostReason))errors.push('lost_reason_required');
  return errors;
}

export function validateQuote(quote){
  const errors=[];
  const status=text(quote.status)||'Черновик';
  if(!text(quote.leadId))errors.push('lead_required');
  if(!text(quote.model))errors.push('model_required');
  if(!QUOTE_STATUSES.includes(status))errors.push('invalid_quote_status');
  if(status!=='Черновик'){
    for(const key of ['lot','service'])if(num(quote[key])<=0)errors.push(`${key}_positive_required`);
    for(const key of ['auction','inland','ocean','customs','repair'])if(num(quote[key])<0)errors.push(`${key}_nonnegative_required`);
    if(num(quote.total)<=0)errors.push('positive_total_required');
    if(num(quote.total)!==quoteSum(quote))errors.push('quote_total_mismatch');
    if(!text(quote.validUntil))errors.push('valid_until_required');
  }
  return [...new Set(errors)];
}

export function validateOrder(order,previousStage=''){
  const errors=[];
  const rawStage=text(order.stage),stage=normalizeStage(rawStage);
  if(!text(order.leadId))errors.push('lead_required');
  if(!ORDER_STAGES.includes(stage))errors.push('invalid_order_stage');
  if(previousStage&&!nextStageAllowed(previousStage,stage))errors.push('invalid_stage_transition');
  if(stageIndex(stage)>=stageIndex('Подготовка к отправке')){
    if(text(order.origin)==='США'&&!text(order.lot))errors.push('lot_required');
    if(!text(order.vin))errors.push('vin_required');
    if(!text(order.eta))errors.push('eta_required');
    if(!text(order.location))errors.push('location_required');
  }
  if(text(order.riskType)&&text(order.riskType)!=='Нет'&&!text(order.riskNote))errors.push('risk_note_required');
  const payments=records(order.payments),plan=records(order.paymentPlan);let paid=0;
  const stageTotals=new Map(PAYMENT_STAGE_IDS.map(id=>[id,0]));
  if(plan.length){
    if(text(order.origin)!=='США'||plan.length!==4||plan.some((x,i)=>text(x.id)!==PAYMENT_STAGE_IDS[i]||num(x.amount)<0))errors.push('invalid_payment_plan');
    if(Math.round(plan.reduce((sum,x)=>sum+num(x.amount),0))!==Math.round(num(order.total)))errors.push('payment_plan_total_mismatch');
  }
  for(const payment of payments){
    const amount=num(payment.amount);
    if(amount<=0)errors.push('payment_amount_positive_required');
    if(!text(payment.date))errors.push('payment_date_required');
    if(!text(payment.method))errors.push('payment_method_required');
    if(plan.length&&!PAYMENT_STAGE_IDS.includes(text(payment.paymentStage)))errors.push('payment_stage_required');
    if(plan.length&&PAYMENT_STAGE_IDS.includes(text(payment.paymentStage)))stageTotals.set(text(payment.paymentStage),(stageTotals.get(text(payment.paymentStage))||0)+Math.max(0,amount));
    paid+=Math.max(0,amount);
  }
  if(plan.length){
    for(let i=0;i<plan.length;i++){
      const stage=plan[i],stagePaid=stageTotals.get(stage.id)||0;if(stagePaid>num(stage.amount)+0.001)errors.push('payment_stage_exceeded');
      if(i>0&&stagePaid>0){const previous=plan[i-1],previousPaid=stageTotals.get(previous.id)||0;if(previousPaid+0.001<num(previous.amount))errors.push('payment_stage_out_of_order');}
    }
  }
  if(num(order.total)>0&&paid>num(order.total))errors.push('payment_total_exceeds_order');
  if(stage==='Выдача'&&num(order.total)>0&&paid<num(order.total))errors.push('full_payment_required_for_handoff');
  return[...new Set(errors)];
}
