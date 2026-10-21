// Only carry verified characteristics from the selected catalog car into the
// customs *inputs*. Customs and recycling fees remain manager-entered estimates.
// An advertised "2.5" motor is a nominal family, not necessarily 2500 cm³.
import {ageCategoryForMonth,ageCategoryForYear} from './auto-sale-quote-audit.mjs';
const clean=v=>String(v??'').trim();
const supported=['petrol','diesel','petrol_electric','diesel_electric','electric','no_engine'];
const verifiedPositive=v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):0;

export function catalogCustomsFacts(car={},asOf=new Date().toISOString().slice(0,10)){
  const description=clean(car.engine);
  const volumeText=description.match(/(?:^|\b)([1-9]\d{2,4})\s*(?:см\s*[³3]|cm\s*[³3]|cc|куб\.?\s*см)/iu);
  // The number must have an explicit cubic-centimetre unit; litres are only
  // approximate designations and require checking registration documents.
  const volume=verifiedPositive(car.engineCc)||verifiedPositive(volumeText?.[1]);
  const power=verifiedPositive(car.powerHp)||
    verifiedPositive(clean(car.power).match(/(\d+(?:[.,]\d+)?)\s*(?:л\.?\s*с\.?|ps|metric hp)/iu)?.[1]?.replace(',','.'));
  const rawFuel=clean(car.engineType).toLowerCase();
  const detectedFuel=rawFuel&&supported.includes(rawFuel)?rawFuel:(()=>{
    const v=description.toLowerCase();
    const petrol=/бензин|petrol|gasoline/i.test(v),diesel=/дизел|diesel/i.test(v);
    const hybrid=/hybrid|гибрид|электромотор/i.test(v);
    const electric=/электро|electric|\bev\b/i.test(v);
    if((petrol&&diesel)||(!petrol&&!diesel&&hybrid))return '';
    if(petrol)return hybrid?'petrol_electric':'petrol';
    if(diesel)return hybrid?'diesel_electric':'diesel';
    return electric?'electric':'';
  })();
  const date=clean(car.manufactureDate);
  const year=Number(car.year)||0;
  const manufactureDate=/^\d{4}-(0[1-9]|1[0-2])$/.test(date)&&(!year||Number(date.slice(0,4))===year)?date:'';
  const ageCategory=manufactureDate?ageCategoryForMonth(manufactureDate,asOf):ageCategoryForYear(year,asOf);
  const missing=[];
  if(!manufactureDate)missing.push('Месяц выпуска нужно уточнить по документам.');
  if(!ageCategory)missing.push('Возрастная категория на границе тарифа — проверьте точный день выпуска.');
  if(!volume&&detectedFuel!=='electric'&&detectedFuel!=='no_engine')missing.push('Точный объём в см³ не подтверждён (номинальные литры недостаточны).');
  if(!power)missing.push('Мощность в метрических л.с. отсутствует.');
  if(!detectedFuel)missing.push('Тип двигателя требует подтверждения.');
  return{year,manufactureDate,ageCategory,engineCc:volume,powerHp:power,
    engineType:detectedFuel,vin:clean(car.vin),mileage:clean(car.mileage),
    engineRaw:description,missing};
}
export function catalogCustomsForLead(lead={},cars=[],asOf){
  const linkedId=clean(lead.carId||lead.catalogVehicle?.id);
  const stored=lead.catalogVehicle;
  if(stored&&clean(stored.id))return{car:stored,facts:catalogCustomsFacts(stored,asOf),source:'заявка (снимок карточки)'};
  const found=linkedId?cars.find(c=>clean(c.id)===linkedId):null;
  if(!found)return{car:null,facts:null,source:''};
  return{car:found,facts:catalogCustomsFacts(found,asOf),source:'карточка каталога'};
}
