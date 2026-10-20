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
