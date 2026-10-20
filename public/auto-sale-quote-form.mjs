const option=(v,chosen,label)=>'<option value="'+v+'"'+(v===chosen?' selected':'')+'>'+label+'</option>';
export function quoteVehicleFields(q={},esc=x=>String(x)){
 const engines=[['','Выберите тип'],['petrol','Бензин'],['diesel','Дизель'],['petrol_electric','Бензин + электромотор'],['diesel_electric','Дизель + электромотор'],['electric','Электромобиль'],['no_engine','Без двигателя']];
 return '<div class="full auto-form-divider">Параметры для таможенного расчёта</div>'+
 '<label>Дата выпуска (год и месяц)<input type="month" name="manufactureDate" value="'+esc(q.manufactureDate||'')+'"><small>Определяет возраст точнее одного года</small></label>'+
 '<label>Тип двигателя<select name="engineType">'+engines.map(x=>option(x[0],q.engineType||'',x[1])).join('')+'</select></label>'+
 '<label>Статус импортёра<select name="importerType">'+option('','', 'Выберите')+option('nat',q.importerType,'Физлицо — личное пользование')+option('jur',q.importerType,'Юрлицо / коммерческий ввоз')+'</select></label>'+
 '<p class="full auto-rule-hint" id="quoteAgeHint">Если известен только год, категория возле 3 и 5 лет требует ручной проверки даты.</p>';
}

export function quoteCostAuditFields(q={},esc=x=>String(x)){
 const sources=[['','Выберите источник'],['MyAuto','MyAuto (Грузия)'],['Copart','Copart'],['IAAI','IAAI'],['BidCars','BidCars'],['other','Другой / собственный инвойс']];
 const source='<label>Источник цены<select name="priceSource">'+sources.map(x=>option(x[0],q.priceSource||'',x[1])).join('')+'</select></label>'+
 '<label>Ссылка на лот / объявление<input name="vehicleSourceUrl" type="url" placeholder="https://..." value="'+esc(q.vehicleSourceUrl||'')+'"></label>';
 const invoice='<label id="quoteInvoiceField" class="'+(q.origin==='США'&&q.ageCategory==='under3'?'':'auto-conditional-hidden')+'">Стоимость по инвойсу, $<input name="invoiceUsd" type="number" min="0" step="0.01" value="'+(Number(q.invoiceUsd)||0)+'"><small>Для оценки таможни США до 3 лет</small></label>';
 const countries=[['Россия','Россия'],['Грузия','Грузия'],['По согласованию','По согласованию']];
 const repair='<label>Где выполняется ремонт<select name="repairCountry">'+countries.map(x=>option(x[0],q.repairCountry||'Россия',x[1])).join('')+'</select></label>';
 const parts='<label>Где покупаются запчасти<select name="partsCountry">'+countries.map(x=>option(x[0],q.partsCountry||'По согласованию',x[1])).join('')+'</select></label>';
 return '<div class="full auto-form-divider">Подтверждение стоимости и работ</div>'+source+invoice+repair+parts;
}
