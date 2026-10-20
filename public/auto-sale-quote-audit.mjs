export const TKS_CALCULATOR_URL='https://www.tks.ru/auto/calc/';
export const QUOTE_AUDIT_SCHEMA='awg-quote-audit-2026-10';
const amount=x=>Number(x)||0;
export function defaultRepairCountry(origin,age){return origin==='США'&&age==='3to5'?'Грузия':'Россия'}
export function defaultPartsCountry(origin,age){return origin==='США'&&age==='under3'?'Грузия':'По согласованию'}
export function quoteCostRows(q={}){
 const us=q.origin==='США',repair=q.repairCountry||defaultRepairCountry(q.origin,q.ageCategory),parts=q.partsCountry||defaultPartsCountry(q.origin,q.ageCategory);
 const names=[['lot',us?'Лот на аукционе':'Автомобиль в Грузии'],['auction','Аукционный сбор'],['inland',us?'Доставка по США':'Логистика по Грузии'],['ocean',us?'Логистика до Тбилиси и брокеры':'Доставка из Грузии в Россию'],['cryptoFee','Криптоперевод 3,5%'],['georgiaDelivery','Доп. доставка по Грузии'],['repair','Ремонт / подготовка ('+repair+')'],['partsCost','Запчасти ('+parts+')'],['legalization','Легализация'],['service','Услуга компании'],['customs','Таможня / оформление'],['recyclingFee','Утильсбор']];
 return names.filter(([key])=>us||!['auction','cryptoFee','partsCost'].includes(key)||amount(q[key])!==0).map(([key,label])=>({key,label,value:amount(q[key])}));
}
export function quoteRowsTotal(q){return quoteCostRows(q).reduce((sum,x)=>sum+x.value,0)}
export function rubToUsd(rub,rate){if(!(Number(rate)>0)||!Number.isFinite(Number(rub))||Number(rub)<0)return null;return Math.round(Number(rub)/Number(rate)*100)/100}

export function ageCategoryForDate(value,asOf){const d=new Date(value+'T00:00:00Z'),now=new Date((asOf||new Date().toISOString().slice(0,10))+'T00:00:00Z');if(!Number.isFinite(d.getTime())||!Number.isFinite(now.getTime())||d>now)return '';const months=(now.getUTCFullYear()-d.getUTCFullYear())*12+now.getUTCMonth()-d.getUTCMonth()-(now.getUTCDate()<d.getUTCDate()?1:0);return months<36?'under3':months<60?'3to5':'other'}
export function ageCategoryForYear(year,asOf){const y=Number(year);if(!Number.isInteger(y)||y<1900||y>2100)return '';const a=ageCategoryForDate(y+'-01-01',asOf),b=ageCategoryForDate(y+'-12-31',asOf);return a&&a===b?a:''}

export function tksParameters(q={}){return {cost:Math.round(Math.max(0,Number(q.invoiceUsd||q.lot)||0)),volume:Math.round(Math.max(0,Number(q.engineCc)||0)),currency:840,power:Math.round(Math.max(0,Number(q.powerHp)||0)),power_edizm:'ls',engine_type:q.engineType||'petrol',age:q.ageCategory==='under3'?3:q.ageCategory==='3to5'?35:57,face:q.importerType||'nat',ts_type:'00_8703'}}

export function quoteAuditErrors(q={}){
 if(q.quoteSchema!==QUOTE_AUDIT_SCHEMA||q.status==='Черновик')return [];
 const err=[],positive=x=>Number(x)>0,field=x=>String(x??'').trim();
 if(!['under3','3to5'].includes(q.ageCategory))err.push('Уточните возраст автомобиля для выбранного тарифа.');
 if(!['electric','no_engine'].includes(q.engineType)&&!positive(q.engineCc))err.push('Укажите объём двигателя.');
 if(!positive(q.powerHp))err.push('Укажите мощность двигателя.');
 if(!['nat','jur'].includes(q.importerType))err.push('Выберите статус импортёра.');
 if(!field(q.priceSource))err.push('Укажите источник цены автомобиля.');
 if(q.origin==='США'&&q.ageCategory==='under3'&&!positive(q.invoiceUsd))err.push('Укажите стоимость по инвойсу для США до 3 лет.');
 if(!field(q.customsSource))err.push('Укажите источник оценки таможни.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(field(q.customsCheckedAt)))err.push('Укажите дату проверки таможни и утильсбора.');
 if((positive(q.customsRub)||positive(q.recyclingRub))&&!positive(q.usdRubRate))err.push('Укажите проверенный курс руб./USD.');
 return err;
}
