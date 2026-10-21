// Georgia-only quote form and arithmetic. Historical quotes and US route use their legacy editor.
export const AWG_GEORGIA_TARIFF_VERSION = '2026-10-21-georgia';
export const AWG_GEORGIA_QUOTE_SCHEMA = 'awg-quote-georgia-2026-10-21';
export const GEORGIA_MODES = ['Самовывоз — Владикавказ','Доставка под ключ'];
const num = v => Number(v) || 0;
const pos = v => Math.max(0,num(v));
export const georgiaTransferFee = (lot,percent=3.5) => Math.round(pos(lot)*pos(percent))/100;
export function georgiaQuoteAmounts(data={}){
  const rate=pos(data.usdRubRate);
  const customsRub=pos(data.customsRub);
  const recyclingRub=pos(data.recyclingRub);
  return {
    lot:pos(data.lot),
    auction:0,inland:0,ocean:0,repair:0,partsCost:0,georgiaDelivery:0,
    legalization:pos(data.legalization),service:pos(data.service),
    cryptoFee:georgiaTransferFee(data.lot,data.internationalTransferPercent),
    customs:rate>0?Math.round(customsRub/rate*100)/100:0,
    recyclingFee:rate>0?Math.round(recyclingRub/rate*100)/100:0
  };
}
export function georgiaQuoteErrors(q={}){
  if(q.origin!=='Грузия'||q.tariffVersion!==AWG_GEORGIA_TARIFF_VERSION||q.status==='Черновик')return [];
  const errors=[];
  if(!['under3','3to5','other'].includes(q.ageCategory))errors.push('Выберите возраст автомобиля.');
  if(!GEORGIA_MODES.includes(q.transportMode))errors.push('Выберите способ получения автомобиля.');
  if(!(Number(q.usdRubRate)>0))errors.push('Укажите фактический курс USD/RUB.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(q.exchangeRateDate||'')))errors.push('Укажите дату используемого курса.');
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
    <label>Способ получения<select name="transportMode">${modeSelect}</select></label>
    ${numberField('lot','Стоимость автомобиля','$','0.01')}
    ${numberField('legalization','Легализация','$','0.01')}
    ${numberField('service','Услуга компании','$','0.01')}
    ${numberField('customsRub','Таможня РФ','₽')}
    ${numberField('recyclingRub','Утильсбор РФ','₽')}
    ${numberField('internationalTransferPercent','Международный перевод','%','0.01')}
    <p class="full auto-rule-hint">Предварительно 3,5% от стоимости автомобиля. База международного перевода подлежит согласованию с заказчиком.</p>
    <div class="full auto-form-divider">Курс для расчёта</div>
    ${numberField('usdRubRate','Курс RUB за 1 USD','₽','0.0001')}
    <label>Дата курса<input type="date" name="exchangeRateDate" value="${safe(q.exchangeRateDate||'')}"></label>
    <p class="full auto-rule-hint">В итоговом расчёте клиент увидит курс и дату. Значение указывает менеджер, автоматический курс не подставляется.</p>
    <label class="full">Комментарий<textarea name="comment" rows="3" placeholder="Дополнительные сведения об автомобиле и расчёте">${safe(q.comment||'')}</textarea></label>
    <label>Статус<select name="status">${statusSelect}</select></label>
    <div class="auto-quote-total full"><span>Предварительная сумма статей в USD</span><b id="quoteTotal">${money(total)}</b>
    <small id="quoteCostPreview">${rate>0?'Курс: '+rate+' ₽/$ · дата '+safe(q.exchangeRateDate||'не указана'):'Для полного итога укажите курс и дату'}</small></div>
    <div class="auto-form-actions"><button type="button" class="auto-btn ghost" data-close>Отмена</button><button type="submit" class="auto-btn primary">Сохранить расчёт</button></div>
  </form></div></div>`;
}
