// Georgia-only quote form and arithmetic. Historical quotes and US route use their legacy editor.
export const AWG_GEORGIA_TARIFF_VERSION = '2026-10-21-georgia';
export const AWG_GEORGIA_QUOTE_SCHEMA = 'awg-quote-georgia-2026-10-21';
export const GEORGIA_MODES = ['Самовывоз — Владикавказ','Доставка под ключ'];
const num = v => Number(v) || 0;
const pos = v => Math.max(0,num(v));
export function formatGeorgiaUsd(value){
  const amount=Number(value)||0;
  const fraction=Math.abs(Math.round(amount*100))%100;
  return '$'+new Intl.NumberFormat('en-US',{minimumFractionDigits:fraction?2:0,maximumFractionDigits:2}).format(amount);
}
export const isNewGeorgiaQuote = q => q?.origin==='Грузия'&&q?.tariffVersion===AWG_GEORGIA_TARIFF_VERSION;
export function georgiaDraftForEditing(q={}){
  if(!q||q.status!=='Черновик'||q.origin!=='Грузия'||isNewGeorgiaQuote(q))return q;
  const rate=pos(q.usdRubRate);
  const migrated={...q,tariffVersion:AWG_GEORGIA_TARIFF_VERSION,quoteSchema:AWG_GEORGIA_QUOTE_SCHEMA,
    transportMode:'',turnkeyDeliveryUsd:0,service:1000,legalization:4000,
    customsRub:pos(q.customsRub)||(rate>0?Math.round(pos(q.customs)*rate):0),
    recyclingRub:pos(q.recyclingRub)||(rate>0?Math.round(pos(q.recyclingFee)*rate):0),
    exchangeRateDate:'',exchangeRateSource:'',internationalTransferPercent:3.5,
    comment:String(q.comment||''),publicComment:String(q.publicComment||''),validUntil:'',migrationPending:true};
  return {...migrated,...georgiaQuoteAmounts(migrated),total:0};
}

export const georgiaTransferFee = (lot,percent=3.5,deliveryUsd=0) => Math.round((pos(lot)+pos(deliveryUsd))*pos(percent))/100;
export function georgiaQuoteAmounts(data={}){
  const rate=pos(data.usdRubRate);
  const customsRub=pos(data.customsRub);
  const recyclingRub=pos(data.recyclingRub);
  const deliveryUsd=data.transportMode==='Доставка под ключ'?pos(data.turnkeyDeliveryUsd):0;
  return {
    lot:pos(data.lot),
    auction:0,inland:0,ocean:0,repair:0,partsCost:0,georgiaDelivery:0,
    turnkeyDeliveryUsd:deliveryUsd,
    legalization:pos(data.legalization),service:pos(data.service),
    cryptoFee:georgiaTransferFee(data.lot,data.internationalTransferPercent,deliveryUsd),
    customs:rate>0?Math.round(customsRub/rate*100)/100:0,
    recyclingFee:rate>0?Math.round(recyclingRub/rate*100)/100:0
  };
}
export function georgiaQuoteErrors(q={}){
  if(q.origin!=='Грузия'||q.tariffVersion!==AWG_GEORGIA_TARIFF_VERSION||q.status==='Черновик')return [];
  const errors=[];
  if(!['under3','3to5'].includes(q.ageCategory))errors.push('Для автомобилей старше 5 лет требуется отдельный индивидуальный расчёт, стандартный пакет неприменим.');
  if(!GEORGIA_MODES.includes(q.transportMode))errors.push('Выберите способ получения автомобиля.');
  if(q.transportMode==='Доставка под ключ'&&!(Number.isFinite(Number(q.turnkeyDeliveryUsd))&&Number(q.turnkeyDeliveryUsd)>0))errors.push('Укажите стоимость доставки под ключ в долларах (больше 0).');
  if(q.transportMode!=='Доставка под ключ'&&num(q.turnkeyDeliveryUsd)!==0)errors.push('Для самовывоза доставка под ключ должна быть 0 $.');
  if(!['electric','no_engine'].includes(q.engineType)&&!(Number(q.engineCc)>0))errors.push('Укажите объём двигателя для таможни РФ.');
  if(!(Number(q.powerHp)>0))errors.push('Укажите мощность двигателя для таможни РФ.');
  if(!['petrol','diesel','petrol_electric','diesel_electric','electric','no_engine'].includes(q.engineType))errors.push('Выберите тип двигателя.');
  if(!['nat','jur'].includes(q.importerType))errors.push('Выберите статус импортёра.');
  if(q.manufactureDate&&!/^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(String(q.manufactureDate)))errors.push('Проверьте дату выпуска автомобиля.');
  if(!(Number(q.usdRubRate)>0))errors.push('Укажите фактический курс USD/RUB.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(q.exchangeRateDate||''))||!Number.isFinite(Date.parse(String(q.exchangeRateDate||'')+'T00:00:00Z'))||String(q.exchangeRateDate)>new Date().toISOString().slice(0,10))errors.push('Укажите реальную дату курса (не позднее сегодняшнего дня).');
  if(!['cbr','bank','agreed'].includes(q.exchangeRateSource))errors.push('Укажите источник курса (ЦБ РФ, банк или согласованный курс).');
  if(!(Number(q.customsRub)>0))errors.push('Укажите таможню РФ в рублях.');
  if(!(Number(q.recyclingRub)>0))errors.push('Укажите утильсбор РФ в рублях.');
  if(!Number.isFinite(Number(q.internationalTransferPercent))||Number(q.internationalTransferPercent)<0||Number(q.internationalTransferPercent)>100)errors.push('Проверьте процент международного перевода.');
  const expected=georgiaQuoteAmounts(q);
  for(const [key,value] of Object.entries(expected))if(Math.abs(num(q[key])-value)>0.011)errors.push('Некорректная сумма статьи '+key+'.');
  return errors;
}
export function georgiaQuoteForm(q,leads,statuses,esc,money){
  const id=esc(q.id||'');
  const safe = v=>esc(v??'');
  const numberField=(name,title,unit,step='1')=>'<label>'+title+(unit?', '+unit:'')+'<input name="'+name+'" type="number" min="0" step="'+step+'" value="'+safe(q[name]??0)+'"></label>';
  const statusSelect=statuses.map(x=>'<option '+(q.status===x?'selected':'')+'>'+safe(x)+'</option>').join('');
  const modeSelect=GEORGIA_MODES.map(x=>'<option value="'+safe(x)+'" '+(q.transportMode===x?'selected':'')+'>'+safe(x)+'</option>').join('');
  const ageSelect=[['','Уточните возраст'],['under3','До 3 лет'],['3to5','От 3 до 5 лет'],['other','Старше 5 лет — индивидуальный расчёт']].map(([v,l])=>'<option value="'+v+'" '+(q.ageCategory===v?'selected':'')+'>'+l+'</option>').join('');
  const engines=[['','Выберите тип'],['petrol','Бензин'],['diesel','Дизель'],['petrol_electric','Бензин + электромотор'],['diesel_electric','Дизель + электромотор'],['electric','Электромобиль'],['no_engine','Без двигателя']];
  const engOptions=engines.map(([value,label])=>'<option value="'+value+'" '+(q.engineType===value?'selected':'')+'>'+label+'</option>').join('');
  const importerOptions=[['','Выберите'],['nat','Физлицо — личное пользование'],['jur','Юрлицо / коммерческий ввоз']].map(([value,label])=>'<option value="'+value+'" '+(q.importerType===value?'selected':'')+'>'+label+'</option>').join('');
  const rateSourceOptions=[['','Выберите источник'],['cbr','ЦБ РФ'],['bank','Банк / платёжный провайдер'],['agreed','Согласованный с клиентом курс']].map(([value,label])=>'<option value="'+value+'" '+(q.exchangeRateSource===value?'selected':'')+'>'+label+'</option>').join('');
  const leadSelect=leads.filter(x=>x.status!=='Отказ').map(x=>'<option value="'+safe(x.id)+'" '+(q.leadId===x.id?'selected':'')+'>'+safe(x.id+' · '+x.name+' · '+x.model)+'</option>').join('');
  const rate=pos(q.usdRubRate);
  const preview=georgiaQuoteAmounts(q);
  const total=Object.values(preview).reduce((s,v)=>s+v,0);
  return `<div class="auto-modal-bg" data-modal-bg><div class="auto-modal auto-modal-wide">
  <div class="auto-modal-head"><div><span class="auto-eyebrow">${id||'НОВЫЙ РАСЧЁТ'} · v${Number(q.version)||1} · Грузия</span><h2>${safe(q.model||'Расчёт автомобиля')}</h2></div><button class="auto-close" data-close>×</button></div>
  <form class="auto-form" id="quoteForm" data-georgia-quote="true">
    <input type="hidden" name="id" value="${id}"><input type="hidden" name="version" value="${Number(q.version)||1}">
    <label>Сценарий покупки<select name="origin" id="quoteOrigin"><option value="Грузия" selected>Авто в Грузии</option><option value="США">Аукцион США</option></select></label><input type="hidden" name="tariffVersion" value="${AWG_GEORGIA_TARIFF_VERSION}">
    <input type="hidden" name="quoteSchema" value="${AWG_GEORGIA_QUOTE_SCHEMA}">
    <label>Лид<select name="leadId" required>${leadSelect}</select></label>
    <label>Автомобиль<input name="model" required value="${safe(q.model||'')}"></label>
    <label>Возраст автомобиля<select name="ageCategory">${ageSelect}</select></label>
    <div class="full auto-form-divider">Параметры автомобиля для таможни РФ</div>
    ${q.catalogSourceId?'<div class="full auto-note" data-customs-catalog-source><b>Данные автомобиля из каталога</b><p>ID: '+safe(q.catalogSourceId)+' · Год: '+safe(q.catalogYear||'уточняется')+' · VIN: '+safe(q.catalogVin||'не указан')+'</p><p>Двигатель: '+safe(q.catalogEngine||'не указан')+' · Пробег: '+safe(q.catalogMileage||'не указан')+'</p><small>Из заявки перенесены только подтверждённые значения. Месяц выпуска, точный объём и мощность при отсутствии данных заполняются по документам. Таможня и утильсбор рассчитываются отдельно и вводятся менеджером после проверки.</small></div>':''}
    <input type="hidden" name="catalogSourceId" value="${safe(q.catalogSourceId||'')}">
    <input type="hidden" name="catalogVin" value="${safe(q.catalogVin||'')}">
    <input type="hidden" name="catalogYear" value="${safe(q.catalogYear||'')}">
    <input type="hidden" name="catalogEngine" value="${safe(q.catalogEngine||'')}">
    <input type="hidden" name="catalogMileage" value="${safe(q.catalogMileage||'')}">
    <label>Дата выпуска<input type="date" name="manufactureDate" value="${safe(/^\d{4}-\d{2}-\d{2}$/.test(q.manufactureDate||'')?q.manufactureDate:'')}"></label>
    ${numberField('engineCc','Объём двигателя','см³')}
    <p class="full auto-rule-hint">Проверьте точный объём по документам: обозначение двигателя «2.5» не всегда означает 2500 см³. <a href="https://www.tks.ru/auto/calc/" target="_blank" rel="noopener noreferrer">Калькулятор таможни ТКС</a></p>
    <label><span class="auto-quote-power-heading">Мощность двигателя <select name="powerUnit" data-previous-unit="${safe(q.powerUnit||'ps')}" aria-label="Единица мощности"><option value="ps" ${q.powerUnit==='hp'?'':'selected'}>л.с.</option><option value="hp" ${q.powerUnit==='hp'?'selected':''}>hp</option></select></span><input name="powerHp" type="number" min="0" step="any" value="${safe(q.powerInput??q.powerHp??0)}"></label>
    <label>Тип двигателя<select name="engineType">${engOptions}</select></label>
    <label>Статус импортёра<select name="importerType">${importerOptions}</select></label>
    <label>Способ получения<select name="transportMode">${modeSelect}</select></label>
    <label id="quoteDeliveryCityField" class="${q.transportMode==='Доставка под ключ'?'':'auto-conditional-hidden'}">Город<input name="deliveryCity" value="${safe(q.deliveryCity||'')}"></label>
    <label id="quoteTurnkeyDeliveryField" class="${q.transportMode==='Доставка под ключ'?'':'auto-conditional-hidden'}">Стоимость доставки под ключ, $<input name="turnkeyDeliveryUsd" type="number" min="0" step="0.01" value="${safe(q.transportMode==='Доставка под ключ'?(q.turnkeyDeliveryUsd??0):0)}"></label>
    <p class="full auto-rule-hint">Доставка под ключ оплачивается отдельно и прибавляется к итоговой стоимости. Для самовывоза доплата за эту услугу отсутствует.</p>
    ${numberField('lot','Стоимость автомобиля','$','0.01')}
    ${numberField('legalization','Легализация','$','0.01')}
    ${numberField('service','Услуга компании','$','0.01')}
    <p class="full auto-rule-hint">Для возраста старше 5 лет требуется индивидуальная оценка: стандартный тариф не допускается к отправке.</p>
    ${numberField('customsRub','Таможня РФ','₽')}
    ${numberField('recyclingRub','Утильсбор РФ','₽')}
    ${numberField('internationalTransferPercent','Международный перевод','%','0.01')}
    <p class="full auto-rule-hint">Международный перевод: 3,5% по умолчанию от стоимости автомобиля плюс стоимость доставки под ключ (если выбрана). Для самовывоза доставка в базе равна 0 $. Процент можно изменить.</p>
    <div class="full auto-form-divider">Курс для расчёта</div>
    ${numberField('usdRubRate','Курс RUB за 1 USD','₽','0.0001')}
    <label>Дата курса<input type="date" name="exchangeRateDate" value="${safe(q.exchangeRateDate||'')}"></label>
    <label>Источник курса<select name="exchangeRateSource">${rateSourceOptions}</select></label>
    <p class="full auto-rule-hint">В итоговом расчёте клиент увидит курс и дату. Значение указывает менеджер, автоматический курс не подставляется.</p>
    <label class="full">Общедоступный комментарий (виден клиенту)<textarea name="publicComment" rows="3" maxlength="3000" placeholder="Пояснения для клиента к расчёту, срокам доставки или оплате">${safe(q.publicComment||'')}</textarea></label>
    ${q.comment?'<div class="full auto-note"><b>Старый внутренний комментарий (клиенту не показывается)</b><p>'+safe(q.comment)+'</p><small>Если эта информация предназначена клиенту, внесите её в общедоступный комментарий выше.</small></div>':''}
    ${q.migrationPending?'<p class="full auto-rule-hint">Это ранее сохранённый черновик. Прежние логистические статьи удалены из предварительной суммы; заново проверьте тариф, способ получения, таможню, утильсбор и курс перед отправкой.</p>':''}
    <label>Статус<select name="status">${statusSelect}</select></label>
    <div class="auto-quote-total full"><span>Предварительная сумма статей в USD</span><b id="quoteTotal">${money(total)}</b>
    <small id="quoteCostPreview">${rate>0?'Курс: '+rate+' ₽/$ · дата '+safe(q.exchangeRateDate||'не указана'):'Для полного итога укажите курс и дату'}</small></div>
    <div class="auto-form-actions"><button type="button" class="auto-btn ghost" data-close>Отмена</button><button type="submit" class="auto-btn primary">Сохранить расчёт</button></div>
  </form></div></div>`;
}
