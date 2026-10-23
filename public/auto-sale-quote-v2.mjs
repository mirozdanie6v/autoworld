// New quotes only: AutoWorld customer meeting 22.10.2026.
// Do not reinterpret immutable historical Georgia / USA quote versions.
export const AWG_QUOTE_V2_SCHEMA='awg-quote-2026-10-23';
export const AWG_QUOTE_V2_TARIFF='2026-10-23-cross-origin';
export const v2Quote=q=>q?.quoteSchema===AWG_QUOTE_V2_SCHEMA&&q?.tariffVersion===AWG_QUOTE_V2_TARIFF;
export const modesV2=origin=>origin==='США'?['Самовывоз — Минеральные Воды','Доставка под ключ']:['Самовывоз — Владикавказ','Доставка под ключ'];
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const positive=v=>Math.max(0,n(v));
const moneyUsd=v=>'$'+new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n(v));
const rub=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n(v))+' ₽';
export function quoteV2Rate(q={}){
  const cbr=positive(q.cbrRubRate);
  return{cbrRubRate:cbr,calculationRubRate:cbr>0?Math.round(cbr*1.04*10000)/10000:0,spreadPercent:4};
}
export const quoteV2RubToUsd=(rub,cbrRubRate)=>{const rate=quoteV2Rate({cbrRubRate}).calculationRubRate;return rate>0?Math.round(positive(rub)/rate*100)/100:0;};
export const quoteV2Transfer=(lot,delivery,percent=3.5)=>Math.round((positive(lot)+positive(delivery))*positive(percent))/100;
export function quoteV2Amounts(q={}){
  const origin=q.origin==='США'?'США':'Грузия';
  const delivery=q.transportMode==='Доставка под ключ'?positive(q.turnkeyDeliveryUsd):0;
  return {
    lot:positive(q.lot),turnkeyDeliveryUsd:delivery,
    cryptoFee:quoteV2Transfer(q.lot,delivery,q.internationalTransferPercent),
    auction:origin==='США'?positive(q.auction):0,
    inland:origin==='США'?positive(q.inland):0,
    ocean:origin==='США'?positive(q.ocean):0,
    repair:origin==='США'?positive(q.repair):0,
    partsCost:origin==='США'?positive(q.partsCost):0,
    customs:0,recyclingFee:0,legalization:0,service:0,georgiaDelivery:0
  };
}
export const quoteV2Total=q=>Object.values(quoteV2Amounts(q)).reduce((a,b)=>a+b,0);
export const quoteV2TotalRub=q=>Math.round(quoteV2Total(q)*quoteV2Rate(q).calculationRubRate);
export function quoteV2Rows(q={}){
  const a=quoteV2Amounts(q);
  const rows=[{key:'lot',label:'Стоимость автомобиля',value:a.lot}];
  if(a.turnkeyDeliveryUsd>0)rows.push({key:'turnkeyDeliveryUsd',label:'Доставка под ключ',value:a.turnkeyDeliveryUsd});
  for(const [key,title] of [['auction','Аукционный сбор'],['inland','Доставка по США (отдельная)'],['ocean','Морская перевозка (отдельная)'],['repair','Ремонт (отдельный)'],['partsCost','Запчасти (отдельно)']]){
    if(a[key]>0)rows.push({key,label:title,value:a[key]});
  }
  rows.push({key:'cryptoFee',label:'Международный перевод, '+positive(q.internationalTransferPercent)+'% (авто + доставка)',value:a.cryptoFee});
  rows.push({key:'customsIncluded',label:'Таможня + утильсбор РФ (в стоимости под ключ, справочно)',value:0,displayValue:rub(q.customsAndRecyclingRub)});
  return rows;
}
export function quoteV2Errors(q={}){
  if(!v2Quote(q)||q.status==='Черновик')return[];
  const errors=[];
  if(!['США','Грузия'].includes(q.origin))errors.push('Выберите сценарий покупки.');
  if(!modesV2(q.origin).includes(q.transportMode))errors.push('Выберите способ получения.');
  if(q.transportMode==='Доставка под ключ'&&!(n(q.turnkeyDeliveryUsd)>0))errors.push('Укажите стоимость доставки под ключ.');
  if(q.transportMode!=='Доставка под ключ'&&n(q.turnkeyDeliveryUsd)!==0)errors.push('Самовывоз не должен включать стоимость доставки.');
  if(!['under3','3to5','other'].includes(q.ageCategory))errors.push('Уточните возраст автомобиля.');
  if(!(n(q.lot)>0))errors.push('Укажите стоимость автомобиля.');
  if(!['electric','no_engine'].includes(q.engineType)&&!(n(q.engineCc)>0))errors.push('Укажите подтверждённый объём двигателя, см³.');
  if(!(n(q.powerHp)>0))errors.push('Укажите мощность двигателя, л.с.');
  if(!['petrol','diesel','petrol_electric','diesel_electric','electric','no_engine'].includes(q.engineType))errors.push('Выберите тип двигателя.');
  if(!['nat','jur'].includes(q.importerType))errors.push('Укажите статус импортёра.');
  if(!(n(q.cbrRubRate)>0)||q.exchangeRateSource!=='cbr')errors.push('Укажите официальный курс ЦБ РФ.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(q.exchangeRateDate||''))||q.exchangeRateDate>new Date().toISOString().slice(0,10))errors.push('Укажите дату курса ЦБ РФ.');
  if(!(n(q.internationalTransferPercent)>=0&&n(q.internationalTransferPercent)<=100))errors.push('Неверный процент международного перевода.');
  if(n(q.customsAndRecyclingRub)<0)errors.push('Таможня + утильсбор не могут быть отрицательными.');
  const expected=quoteV2Amounts(q);
  for(const [key,value] of Object.entries(expected))if(Math.abs(n(q[key])-value)>0.011)errors.push('Некорректная сумма статьи '+key);
  if(Math.abs(n(q.usdRubRate)-quoteV2Rate(q).calculationRubRate)>0.00011)errors.push('Расчётный курс должен быть ЦБ РФ + 4%.');
  return errors;
}
export function quoteV2Form(q={},leads=[],statuses=[],esc=String,verificationPhotos=''){
  const safe=x=>esc(x??'');
  const number=(key,title,unit='',step='1')=>'<label>'+title+(unit?', '+unit:'')+'<input name="'+key+'" type="number" min="0" step="'+step+'" value="'+safe(q[key]??0)+'"></label>';
  const selected=(value,current)=>String(value)===String(current)?' selected':'';
  const option=(v,l,current)=>'<option value="'+safe(v)+'"'+selected(v,current)+'>'+safe(l)+'</option>';
  const origin=q.origin==='США'?'США':'Грузия';
  const modes=modesV2(origin);
  const defaultMode=q.transportMode||modes[0];
  const usFields=origin==='США'?[
    ['auction','Аукционный сбор'],['inland','Доставка по США (отдельная)'],
    ['ocean','Морская перевозка (отдельная)'],['repair','Ремонт (отдельно)'],['partsCost','Запчасти (отдельно)']
  ].map(([key,title])=>number(key,title,'$',"0.01")).join(''):'';
  const statusOptions=statuses.map(v=>option(v,v,q.status)).join('');
  const leadOptions=leads.filter(l=>l.status!=='Отказ').map(l=>option(l.id,l.id+' · '+l.name+' · '+l.model,q.leadId)).join('');
  const engineOptions=[['','Выберите тип'],['petrol','Бензин'],['diesel','Дизель'],['petrol_electric','Бензин + электромотор'],['diesel_electric','Дизель + электромотор'],['electric','Электромобиль'],['no_engine','Без двигателя']].map(v=>option(v[0],v[1],q.engineType)).join('');
  const rate=quoteV2Rate(q);
  const preview=quoteV2Total(q);
  const checked=q.transportMode==='Доставка под ключ';
  return '<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide">'+
    '<div class="auto-modal-head"><div><span class="auto-eyebrow">'+safe(q.id||'НОВЫЙ РАСЧЁТ')+' · '+safe(origin)+'</span><h2>'+safe(q.model||'Расчёт автомобиля')+'</h2></div><button class="auto-close" data-close>×</button></div>'+
    '<form class="auto-form" id="quoteForm" data-awg-quote-v2="true">'+
    '<input type="hidden" name="id" value="'+safe(q.id||'')+'"><input type="hidden" name="version" value="'+safe(q.version||1)+'">'+
    '<input type="hidden" name="tariffVersion" value="'+AWG_QUOTE_V2_TARIFF+'"><input type="hidden" name="quoteSchema" value="'+AWG_QUOTE_V2_SCHEMA+'">'+
    '<label>Сценарий покупки<select name="origin" id="quoteOrigin">'+option('Грузия','Авто в Грузии',origin)+option('США','Аукцион США',origin)+'</select></label>'+
    '<label>Заявка<select name="leadId" required>'+leadOptions+'</select></label>'+
    '<label>Автомобиль<input name="model" required value="'+safe(q.model||'')+'"></label>'+
    '<label>Возраст автомобиля<select name="ageCategory">'+[['','Уточните возраст'],['under3','До 3 лет'],['3to5','От 3 до 5 лет'],['other','Старше 5 лет — индивидуально']].map(v=>option(v[0],v[1],q.ageCategory)).join('')+'</select></label>'+
    '<div class="full auto-form-divider">Характеристики автомобиля</div>'+
    '<input type="hidden" name="catalogSourceId" value="'+safe(q.catalogSourceId||'')+'">'+
    '<input type="hidden" name="catalogVin" value="'+safe(q.catalogVin||'')+'">'+
    '<input type="hidden" name="sourcePriceRub" value="'+safe(q.sourcePriceRub||0)+'">'+
    '<input type="hidden" name="sourceTurnkeyDeliveryRub" value="'+safe(q.sourceTurnkeyDeliveryRub||0)+'">'+
    '<label>Месяц выпуска<input name="manufactureDate" type="month" value="'+safe(q.manufactureDate||'')+'"></label>'+
    number('engineCc','Объём двигателя','см³')+
    '<label>Мощность двигателя, л.с.<input type="number" name="powerHp" min="0" step="0.01" value="'+safe(q.powerHp||0)+'"></label>'+
    '<input type="hidden" name="powerUnit" value="ps">'+
    '<label>Тип двигателя<select name="engineType">'+engineOptions+'</select></label>'+
    '<label>Статус импортёра<select name="importerType">'+option('','Выберите',q.importerType)+option('nat','Физлицо',q.importerType)+option('jur','Юрлицо',q.importerType)+'</select></label>'+
    '<label>Способ получения<select name="transportMode">'+modes.map(x=>option(x,x,defaultMode)).join('')+'</select></label>'+
    number('lot','Стоимость автомобиля','$','0.01')+
    '<label id="quoteTurnkeyDeliveryField" class="'+(checked?'':'auto-conditional-hidden')+'">Стоимость доставки под ключ, $<input name="turnkeyDeliveryUsd" type="number" min="0" step="0.01" value="'+safe(checked?q.turnkeyDeliveryUsd||0:0)+'"></label>'+
    '<p class="full auto-rule-hint">Доставка включается в сумму отдельно. Если использована разница между ценой автомобиля и ценой в России с ремонтом, менеджер должен проверить состав затрат, чтобы не учесть их дважды.</p>'+
    (q.sourcePriceRub>0?'<p class="full auto-note">Цена автомобиля из объявления: '+rub(q.sourcePriceRub)+'. После указания официального курса ЦБ РФ она автоматически пересчитывается в доллары по расчётному курсу, если менеджер ещё не ввёл цену вручную.</p>':'')+
    (q.sourceTurnkeyDeliveryRub>0?'<p class="full auto-note">По объявлению: разница между ценой автомобиля и ценой в России с ремонтом — '+rub(q.sourceTurnkeyDeliveryRub)+'. Сверьте состав и переведите в $ по курсу перед внесением доставки.</p>':'')+
    usFields+
    number('customsAndRecyclingRub','Таможня + утильсбор РФ (включены в доставку)','₽')+
    '<p class="full auto-rule-hint">Таможню и утильсбор проверяет менеджер. Это справочная сумма, она уже включена в стоимость под ключ и повторно к итогу не прибавляется.</p>'+
    number('internationalTransferPercent','Международный перевод','%','0.01')+
    '<p class="full auto-rule-hint">База перевода — стоимость автомобиля плюс доставка под ключ. Отдельные затраты не включаются в эту базу.</p>'+
    '<div class="full auto-form-divider">Курс ЦБ РФ и конвертация</div>'+
    number('cbrRubRate','Официальный курс ЦБ РФ за 1 USD','₽','0.0001')+
    '<label>Дата курса ЦБ РФ<input name="exchangeRateDate" type="date" value="'+safe(q.exchangeRateDate||'')+'"></label>'+
    '<input type="hidden" name="exchangeRateSource" value="cbr">'+
    '<p class="full auto-rule-hint">Официальный курс ЦБ РФ отображается клиенту. Для фактического пересчёта USD → RUB применяется курс ЦБ РФ + 4%; клиентский итог в рублях включает эту разницу.</p>'+
    '<label class="full">Общедоступный комментарий<textarea name="publicComment" rows="3">'+safe(q.publicComment||'')+'</textarea></label>'+
    (origin==='США'?'<div class="full auto-form-divider">Досье проверки автомобиля США</div>'+
    '<label>LOT / номер лота<input name="verificationLot" value="'+safe(q.verification?.lotNumber||'')+'"></label>'+
    '<label>VIN<input name="verificationVin" value="'+safe(q.verification?.vin||'')+'"></label>'+
    '<label>Год автомобиля<input name="verificationYear" type="number" min="1900" max="2030" value="'+safe(q.verification?.year||q.catalogYear||'')+'"></label>'+
    '<label>Пробег, км<input name="verificationMileage" type="number" min="0" value="'+safe(q.verification?.mileage||0)+'"></label>'+
    '<label class="full">Повреждения<textarea name="verificationDamage">'+safe(q.verification?.damage||'')+'</textarea></label>'+
    '<label>Ссылка на отчёт<input name="verificationReportUrl" type="url" value="'+safe(q.verification?.reportUrl||'')+'"></label>'+
    '<label>Дата проверки<input name="verificationCheckedAt" type="date" value="'+safe(q.verification?.checkedAt||'')+'"></label>'+
    '<label class="full">История<textarea name="verificationHistory">'+safe(q.verification?.history||'')+'</textarea></label>'+
    '<label>Итог проверки<select name="verificationResult">'+[['Не проверено','Не проверено'],['Одобрен к покупке','Одобрен к покупке'],['Не рекомендован','Не рекомендован']].map(v=>option(v[0],v[1],q.verification?.result||'Не проверено')).join('')+'</select></label>'+verificationPhotos:'')+
    '<label>Статус<select name="status">'+statusOptions+'</select></label>'+
    '<div class="auto-quote-total full"><span>Итого, USD</span><b id="quoteTotal">'+moneyUsd(preview)+'</b><small id="quoteCostPreview">ЦБ РФ: '+safe(rate.cbrRubRate)+' ₽/$; для конвертации +4%; в рублях ≈ '+rub(quoteV2TotalRub(q))+'</small></div>'+
    '<div class="auto-form-actions"><button type="button" class="auto-btn ghost" data-close>Отмена</button><button type="submit" class="auto-btn primary">Сохранить расчёт</button></div>'+
    '</form></div></div>';
}
