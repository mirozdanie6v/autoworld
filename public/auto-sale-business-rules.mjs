export const ACTIVE_LEAD_STATUSES=['Новый','В работе','Расчёт','Ожидает клиента'];
export const QUOTE_STATUSES=['Черновик','Отправлен','На согласовании','Согласован','Отказ'];
export const RISK_TYPES=['Нет','Ожидает судно','Документы','Повреждение','Задержка','Оплата','Другое'];
export const PAYMENT_METHODS=['Наличные','Банк','Карта','Другое'];
export const VERIFICATION_RESULTS=['Не проверено','Одобрен к покупке','Требует дополнительной проверки','Не рекомендован'];
export const PAYMENT_STAGE_DEFS=[
  {id:'auction_deposit',title:'1. Аукционный аванс',due:'До начала торгов'},
  {id:'auction_balance',title:'2. Автомобиль + аукционные сборы',due:'После победы на торгах'},
  {id:'logistics_legalization',title:'3. Логистика и легализация',due:'За несколько дней до прибытия в порт назначения'},
  {id:'customs_fts',title:'4. Таможенные платежи ФТС',due:'За 1–2 дня до пересечения границы РФ'}
];
export const PAYMENT_STAGE_IDS=PAYMENT_STAGE_DEFS.map(x=>x.id);
const n=v=>Number(v)||0;
const text=v=>String(v??'').trim();
const QUOTE_FIELD_LABELS={lot:'Стоимость автомобиля / лота',auction:'Сбор аукциона',inland:'Доставка',ocean:'Международная перевозка',customs:'Таможня / оформление',service:'Услуга компании'};
const ORDER_FIELD_LABELS={lot:'LOT / номер лота',vin:'VIN',eta:'Ожидаемая дата прибытия',location:'Текущее местоположение'};

const photoList=v=>{if(Array.isArray(v))return v.filter(Boolean);try{const x=JSON.parse(String(v||'[]'));return Array.isArray(x)?x.filter(Boolean):[]}catch{return[]}};
export function normalizeVehicleVerification(data={}){
  const source=data.verification&&typeof data.verification==='object'?data.verification:{
    lotNumber:data.verificationLot,vin:data.verificationVin,year:data.verificationYear,mileage:data.verificationMileage,
    damage:data.verificationDamage,photos:data.verificationPhotos,reportUrl:data.verificationReportUrl,
    history:data.verificationHistory,result:data.verificationResult,checkedAt:data.verificationCheckedAt
  };
  return{
    lotNumber:text(source.lotNumber),vin:text(source.vin),year:n(source.year),mileage:n(source.mileage),
    damage:text(source.damage),photos:photoList(source.photos),reportUrl:text(source.reportUrl),
    history:text(source.history),result:text(source.result)||'Не проверено',checkedAt:text(source.checkedAt)
  };
}
export function validateVehicleVerification(data={},{requireApproved=false}={}){
  const v=normalizeVehicleVerification(data),e=[];
  if(!v.lotNumber)e.push('Укажите LOT / номер лота в досье проверки.');
  if(!v.vin)e.push('Укажите VIN в досье проверки.');
  if(v.year<1900)e.push('Укажите год автомобиля в досье проверки.');
  if(v.mileage<0||!Number.isFinite(v.mileage))e.push('Укажите корректный пробег.');
  if(!v.damage)e.push('Опишите повреждения или укажите, что видимых повреждений нет.');
  if(!v.photos.length)e.push('Добавьте минимум одно фото автомобиля до покупки.');
  if(!v.reportUrl&&!v.history)e.push('Добавьте ссылку на отчёт проверки или краткую историю автомобиля.');
  if(!v.checkedAt)e.push('Укажите дату проверки.');
  if(requireApproved&&v.result!=='Одобрен к покупке')e.push('Лот можно согласовать только после итоговой отметки «Одобрен к покупке».');
  return e;
}
export function leadTransitionAllowed(from,to,{hasAgreedQuote=false,deposit=0}={}){if(from===to)return true;if(to==='Отказ')return from!=='Сделка'&&from!=='Отказ';const allowed={'Новый':['В работе'],'В работе':['Новый','Расчёт','Ожидает клиента'],'Расчёт':['В работе','Ожидает клиента'],'Ожидает клиента':['Расчёт','Сделка'],'Сделка':[],'Отказ':[]};if(!(allowed[from]||[]).includes(to))return false;if(to==='Сделка')return hasAgreedQuote&&n(deposit)>0;return true;}
export function quoteTransitionAllowed(from,to){if(!from)return['Черновик','Отправлен'].includes(to);if(from===to)return true;const allowed={'Черновик':['Отправлен'],'Отправлен':['На согласовании','Согласован','Отказ'],'На согласовании':['Согласован','Отказ'],'Согласован':[],'Отказ':[]};return (allowed[from]||[]).includes(to);}
export function validateClientRequest(data={}){const e=[];if(!text(data.name))e.push('Укажите имя.');if(!text(data.contact))e.push('Укажите Telegram или WhatsApp.');if(!text(data.model))e.push('Укажите марку или модель.');if(!['США','Грузия'].includes(text(data.origin)))e.push('Выберите способ покупки: аукцион США или авто в Грузии.');if(n(data.budget)<10000)e.push('Бюджет должен быть не меньше $10 000.');const a=n(data.yearFrom),b=n(data.yearTo);if(a&&b&&a>b)e.push('Начальный год не может быть больше конечного.');return e;}
export function validateManagerLead(data={}){const e=[];if(!text(data.name))e.push('Укажите имя клиента.');if(!text(data.contact))e.push('Укажите контакт клиента.');if(!text(data.model))e.push('Укажите интересующий автомобиль.');if(n(data.budget)<0)e.push('Бюджет не может быть отрицательным.');if(!text(data.manager))e.push('Назначьте менеджера.');if(!text(data.source))e.push('Укажите источник.');if(!text(data.nextAction))e.push('Укажите следующее действие.');return e;}
export function validateLeadUpdate(data={},current={},context={}){let e=validateManagerLead(data);if(!ACTIVE_LEAD_STATUSES.includes(data.status))e=e.filter(x=>x!=='Укажите следующее действие.');if(data.status==='Отказ'&&!text(data.lostReason))e.push('Для отказа обязательна причина.');if(ACTIVE_LEAD_STATUSES.includes(data.status)&&!text(data.nextAction))e.push('Для активного лида обязательна дата следующего действия.');if(!leadTransitionAllowed(current.status,data.status,context))e.push(`Переход «${current.status}» → «${data.status}» сейчас недоступен.`);return[...new Set(e)];}
export function validateQuote(data={}){const e=[];if(!text(data.leadId))e.push('Выберите лида.');if(!text(data.model))e.push('Укажите автомобиль.');if(data.status!=='Черновик'){if(!['США','Грузия'].includes(text(data.origin)))e.push('Выберите сценарий покупки: аукцион США или авто в Грузии.');for(const key of ['lot','service'])if(n(data[key])<=0)e.push(`Для отправки расчёта заполните «${QUOTE_FIELD_LABELS[key]}».`);for(const key of ['auction','inland','ocean','customs','repair'])if(n(data[key])<0)e.push(`Поле «${QUOTE_FIELD_LABELS[key]||key}» не может быть отрицательным.`);if(!text(data.validUntil))e.push('Укажите срок действия расчёта.');}if(data.status==='Согласован'&&text(data.origin)==='США')e.push(...validateVehicleVerification(data,{requireApproved:true}));if(n(data.repair)<0)e.push('Ремонт не может быть отрицательным.');return[...new Set(e)];}
export function canCreateOrder({quote,deposit}={}){if(!quote)return{ok:false,reason:'Сначала создайте расчёт.'};if(quote.status!=='Согласован')return{ok:false,reason:'Заказ можно создать только после согласования расчёта.'};if(text(quote.origin)==='США'){if(validateVehicleVerification(quote,{requireApproved:true}).length)return{ok:false,reason:'Перед созданием заказа завершите досье проверки автомобиля.'};const range=auctionDepositRange(quote.total);if(n(deposit)<range.min||n(deposit)>range.max)return{ok:false,reason:`Для аукциона США аванс должен быть 25–30% от согласованной стоимости: ${range.min}–${range.max} $.`};}else if(n(deposit)<=0)return{ok:false,reason:'Перед созданием заказа зафиксируйте полученный депозит.'};return{ok:true,reason:''};}
export function orderRequiredFields(stage){const normalized=stage==='Порт США'?'Подготовка к отправке':stage==='В море'?'В пути':stage;const map={'Подготовка к отправке':['vin','eta','location'],'В пути':['vin','eta','location'],'Таможня':['vin','eta','location'],'Доставка':['vin','eta','location'],'Выдача':['vin','eta','location']};return map[normalized]||[];}
export function validateOrderUpdate(data={},currentStage='Выкуп',allowedStages=[]){const e=[];if(allowedStages.length&&!allowedStages.includes(data.stage))e.push('Нельзя перескакивать через этапы логистики.');for(const key of orderRequiredFields(data.stage))if(!text(data[key]))e.push(`Для этапа «${data.stage}» заполните «${ORDER_FIELD_LABELS[key]||key}».`);if(data.riskType&&data.riskType!=='Нет'&&!text(data.riskNote))e.push('Опишите риск или блокер.');if(n(data.paymentAmount)<0)e.push('Платёж не может быть отрицательным.');if(n(data.paymentAmount)>0&&!text(data.paymentDate))e.push('Укажите дату платежа.');if(currentStage==='Выдача'&&data.stage!=='Выдача')e.push('Выданный автомобиль нельзя вернуть на предыдущий этап обычным редактированием.');return e;}
export function normalizePayments(order={}){if(Array.isArray(order.payments))return order.payments;const paid=n(order.paid);return paid>0?[{id:'PAY-LEGACY',amount:paid,date:'2026-09-12',method:'Банк',note:'Перенесено из прежнего поля оплаты'}]:[];}
export function paymentsTotal(payments=[]){return payments.reduce((s,p)=>s+n(p.amount),0);}
export function nextPaymentId(payments=[]){const max=payments.reduce((m,p)=>{const hit=String(p.id||'').match(/(\d+)$/);return hit?Math.max(m,Number(hit[1])):m;},0);return `PAY-${max+1}`;}

export function auctionDepositRange(total=0){const t=Math.max(0,n(total));return{min:Math.ceil(t*.25),max:Math.floor(t*.30)};}
export function buildUsPaymentPlan(quote={},deposit=0,{needsReview=false}={}){
  if(text(quote.origin)!=='США')return[];
  const total=Math.max(0,n(quote.total));if(!total)return[];
  const stage1=Math.max(0,Math.min(total,Math.round(n(deposit))));
  const customs=Math.max(0,Math.min(total-stage1,Math.round(n(quote.customs))));
  const logisticsBase=n(quote.inland)+n(quote.ocean)+n(quote.repair)+n(quote.service);
  const logistics=Math.max(0,Math.min(total-stage1-customs,Math.round(logisticsBase)));
  const auctionBalance=Math.max(0,total-stage1-logistics-customs);
  const amounts=[stage1,auctionBalance,logistics,customs];
  return PAYMENT_STAGE_DEFS.map((def,i)=>({...def,amount:amounts[i],needsReview:Boolean(needsReview)}));
}
export function paymentPlanTotal(plan=[]){return plan.reduce((sum,x)=>sum+n(x.amount),0);}
export function paymentStagePaid(payments=[],stageId=''){return payments.filter(x=>text(x.paymentStage)===stageId).reduce((sum,x)=>sum+n(x.amount),0);}
export function paymentStageState(stage={},payments=[]){const amount=Math.max(0,n(stage.amount)),paid=Math.min(amount,paymentStagePaid(payments,stage.id)),remaining=Math.max(0,amount-paid);return{...stage,amount,paid,remaining,status:remaining<=0?'Оплачено':paid>0?'Частично':'Ожидает'};}
export function nextPaymentStage(plan=[],payments=[]){return plan.map(x=>paymentStageState(x,payments)).find(x=>x.remaining>0)||null;}
export function migratePaymentsToPlan(payments=[],plan=[]){
  const valid=new Set(plan.map(x=>x.id));if(!plan.length)return payments.map(x=>({...x}));
  const staged=payments.filter(x=>valid.has(text(x.paymentStage))).map(x=>({...x}));
  const unassigned=payments.filter(x=>!valid.has(text(x.paymentStage)));
  const remaining=new Map(plan.map(stage=>[stage.id,Math.max(0,n(stage.amount)-paymentStagePaid(staged,stage.id))]));
  const out=[...staged];
  for(const payment of unassigned){
    let left=Math.max(0,n(payment.amount)),part=0;
    for(const stage of plan){
      const cap=Math.max(0,remaining.get(stage.id)||0);if(left<=0)break;if(cap<=0)continue;
      const amount=Math.min(left,cap);part+=1;
      out.push({...payment,id:part===1&&amount===n(payment.amount)?payment.id:(String(payment.id||'PAY-LEGACY')+'-M'+part),amount,paymentStage:stage.id,migratedStage:true});
      remaining.set(stage.id,cap-amount);left-=amount;
    }
    if(left>0)out.push({...payment,id:String(payment.id||'PAY-LEGACY')+'-REST',amount:left,paymentStage:'legacy',migratedStage:true});
  }
  return out;
}
export function validatePaymentStageEntry({plan=[],payments=[],stageId='',amount=0}={}){
  const value=n(amount);if(value<=0||!plan.length)return[];
  const stage=plan.find(x=>x.id===stageId);if(!stage)return['Выберите этап оплаты.'];
  const next=nextPaymentStage(plan,payments);if(next&&next.id!==stageId)return['Сначала завершите «'+next.title+'».'];
  const state=paymentStageState(stage,payments);if(value>state.remaining)return['Платёж больше остатка этапа оплаты ('+state.remaining+' $).'];
  return[];
}
