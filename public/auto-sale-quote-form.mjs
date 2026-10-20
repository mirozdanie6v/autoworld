const option=(v,chosen,label)=>'<option value="'+v+'"'+(v===chosen?' selected':'')+'>'+label+'</option>';
export function quoteVehicleFields(q={},esc=x=>String(x)){
 const engines=[['','Выберите тип'],['petrol','Бензин'],['diesel','Дизель'],['petrol_electric','Бензин + электромотор'],['diesel_electric','Дизель + электромотор'],['electric','Электромобиль'],['no_engine','Без двигателя']];
 return '<div class="full auto-form-divider">Параметры для таможенного расчёта</div>'+
 '<label>Дата выпуска (год и месяц)<input type="month" name="manufactureDate" value="'+esc(q.manufactureDate||'')+'"><small>Определяет возраст точнее одного года</small></label>'+
 '<label>Тип двигателя<select name="engineType">'+engines.map(x=>option(x[0],q.engineType||'',x[1])).join('')+'</select></label>'+
 '<label>Статус импортёра<select name="importerType">'+option('','', 'Выберите')+option('nat',q.importerType,'Физлицо — личное пользование')+option('jur',q.importerType,'Юрлицо / коммерческий ввоз')+'</select></label>'+
 '<p class="full auto-rule-hint" id="quoteAgeHint">Если известен только год, категория возле 3 и 5 лет требует ручной проверки даты.</p>';
}
