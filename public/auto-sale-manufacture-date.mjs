// A locale-independent manufacture-date editor for manager quotes.
// The server still receives precisely one ISO YYYY-MM-DD manufactureDate.
export const MANUFACTURE_MONTH_NAMES=[
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];
const pad=value=>String(value).padStart(2,'0');

export function manufactureDaysInMonth(year,month){
  const y=Number(year),m=Number(month);
  if(!Number.isInteger(y)||y<1900||y>2100||!Number.isInteger(m)||m<1||m>12)return 0;
  return new Date(Date.UTC(y,m,0)).getUTCDate();
}
export function manufactureDateFromParts(year,month,day){
  const y=Number(year),m=Number(month),d=Number(day);
  const max=manufactureDaysInMonth(y,m);
  if(!String(year)||!String(month)||!String(day)||!Number.isInteger(d)||d<1||d>max)return '';
  return String(y).padStart(4,'0')+'-'+pad(m)+'-'+pad(d);
}
export function manufactureDateParts(value=''){
  const match=/^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(value||''));
  if(!match)return{year:'',month:'',day:''};
  const year=match[1],month=match[2],day=match[3]||'';
  if(!manufactureDaysInMonth(year,month))return{year:'',month:'',day:''};
  if(day&&!manufactureDateFromParts(year,month,day))return{year,month,day:''};
  return{year,month,day};
}
const option=(value,label,selected,escape)=>'<option value="'+escape(value)+'"'+(value===selected?' selected':'')+'>'+escape(label)+'</option>';

export function manufactureDatePickerHtml(value='',escape=String,yearMax=new Date().getUTCFullYear()+1){
  const parts=manufactureDateParts(value);
  const years=[];
  const top=Math.min(2100,Math.max(1900,Number(yearMax)||new Date().getUTCFullYear(),Number(parts.year)||0));
  for(let year=top;year>=1900;year--)years.push(option(String(year),String(year),parts.year,escape));
  const months=MANUFACTURE_MONTH_NAMES.map((label,i)=>option(pad(i+1),label,parts.month,escape));
  const days=Array.from({length:manufactureDaysInMonth(parts.year,parts.month)},(_,i)=>option(pad(i+1),String(i+1),parts.day,escape));
  return '<label class="auto-manufacture-date-label">Дата выпуска'+
    '<span class="auto-manufacture-date-parts" role="group" aria-label="Дата выпуска автомобиля">'+
    '<select name="manufactureYear" data-manufacture-part="year" aria-label="Год выпуска">'+option('','Год',parts.year,escape)+years.join('')+'</select>'+
    '<select name="manufactureMonth" data-manufacture-part="month" aria-label="Месяц выпуска">'+option('','Месяц',parts.month,escape)+months.join('')+'</select>'+
    '<select name="manufactureDay" data-manufacture-part="day" aria-label="День выпуска"'+(!parts.year||!parts.month?' disabled':'')+'>'+option('','День',parts.day,escape)+days.join('')+'</select>'+
    '</span><input type="hidden" name="manufactureDate" value="'+escape(manufactureDateFromParts(parts.year,parts.month,parts.day))+'">'+
    '</label>';
}
export function syncManufactureDatePicker(form){
  const year=form?.elements?.manufactureYear,month=form?.elements?.manufactureMonth,day=form?.elements?.manufactureDay;
  const canonical=form?.elements?.manufactureDate;
  if(!year||!month||!day||!canonical)return '';
  const max=manufactureDaysInMonth(year.value,month.value);
  const chosen=day.value;
  day.innerHTML='<option value="">День</option>'+Array.from({length:max},(_,i)=>'<option value="'+pad(i+1)+'">'+(i+1)+'</option>').join('');
  day.disabled=max===0;
  if(chosen&&Number(chosen)<=max)day.value=pad(Number(chosen));
  canonical.value=manufactureDateFromParts(year.value,month.value,day.value);
  return canonical.value;
}
