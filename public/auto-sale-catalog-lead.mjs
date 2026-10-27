// Immutable snapshot of the public catalog card as it existed when a customer submitted a request.
// Keep this separate from editable CRM fields, and never infer original catalog facts from future edits.
const str=value=>String(value??'').trim();
const num=value=>Number(value)||0;
const photoList=value=>Array.isArray(value)?value.filter(x=>typeof x==='string'&&/^https?:\/\//i.test(x)).slice(0,10):[];
export function catalogVehicleSnapshot(car){
  if(!car||!str(car.id))return null;
  return {
    id:str(car.id),brand:str(car.brand),model:str(car.model),origin:str(car.origin),
    year:str(car.year),mileage:str(car.mileage),engine:str(car.engine),drive:str(car.drive),
    auction:str(car.auction),auctionDate:str(car.auctionDate),delivery:str(car.delivery),
    tag:str(car.tag),vin:str(car.vin),image:str(car.image),source:str(car.source),
    body:str(car.body),trim:str(car.trim),transmission:str(car.transmission),
    interior:str(car.interior),damage:str(car.damage),safety:str(car.safety),
    sourceUrl:str(car.sourceUrl),sourcePostId:str(car.sourcePostId),
    lot:str(car.lot),power:str(car.power),engineCc:num(car.engineCc),powerHp:num(car.powerHp),
    engineType:str(car.engineType),manufactureDate:str(car.manufactureDate),seats:str(car.seats),
    efficiency:str(car.efficiency),publishedAt:str(car.publishedAt),
    calculationDate:str(car.calculationDate),customsRub:num(car.customsRub),customsAndRecyclingRub:num(car.customsAndRecyclingRub),
    highlights:Array.isArray(car.highlights)?car.highlights.filter(x=>typeof x==='string').slice(0,20):[],
    bestFor:str(car.bestFor),
    price:num(car.price),estimatedBidUsd:num(car.estimatedBidUsd),priceRub:num(car.priceRub),
    priceBeforeDiscountRub:num(car.priceBeforeDiscountRub),
    priceAfterDiscountRub:num(car.priceAfterDiscountRub),
    discountExplicit:car.discountExplicit===true,
    russiaTurnkeyRub:num(car.russiaTurnkeyRub),
    russiaTurnkeyMaxRub:num(car.russiaTurnkeyMaxRub),
    russiaTurnkeyKind:str(car.russiaTurnkeyKind),
    usaTurnkeyRub:num(car.usaTurnkeyRub),georgiaTurnkeyRub:num(car.georgiaTurnkeyRub),
    turnkeyDeliveryRub:num(car.turnkeyDeliveryRub),
    turnkeyDeliverySource:str(car.turnkeyDeliverySource),
    interiorPhotos:photoList(car.interiorPhotos),otherPhotos:photoList(car.otherPhotos)
  };
}
export const isCatalogVehicleLead=lead=>Boolean(str(lead?.carId)||str(lead?.catalogVehicle?.id)||str(lead?.year)||str(lead?.mileage));
export function catalogLeadSpecsText(lead={}){
  if(isCatalogVehicleLead(lead)){
    const s=lead.catalogVehicle||{};
    return 'Год выпуска: '+(str(lead.year||s.year)||'—')+' · Пробег: '+(str(lead.mileage||s.mileage)||'—')+
      ' · Двигатель: '+(str(lead.engine||s.engine)||'—')+' · Привод: '+(str(lead.drive||s.drive)||'—');
  }
  return 'Год: '+(str(lead.yearFrom)||'—')+'–'+(str(lead.yearTo)||'—')+' · Пробег до '+(str(lead.mileageMax)||'—')+' км'+
    ' · Двигатель: '+(str(lead.engine)||'Не важно')+' · Привод: '+(str(lead.drive)||'Не важно');
}
export function renderCatalogLeadVehicle(lead={}, {escape=String,money=v=>'$'+v,rubMoney=v=>v+' ₽'}={}){
  if(!isCatalogVehicleLead(lead))return '';
  const s=lead.catalogVehicle||{};
  const label=(name,value)=>'<div class="auto-catalog-lead-field"><span>'+escape(name)+'</span><b>'+escape(str(value)||'—')+'</b></div>';
  // This block is the original catalog snapshot. Editable customer/CRM values live in separate fields.
  const year=str(s.year||lead.year), mileage=str(s.mileage||lead.mileage);
  const engine=str(s.engine||lead.engine), drive=str(s.drive||lead.drive);
  const baseRub=num(s.priceRub)||num(s.priceAfterDiscountRub);
  const turnkeyRub=num(s.russiaTurnkeyRub);
  const turnkeyOnly=!(num(s.price)>0)&&!baseRub&&turnkeyRub>0;
  // Keep the same source price as the public catalog, including historic
  // posts where only the Russia-with-repair calculation can be verified.
  // A stale lead budget must never displace a newer authoritative source.
  const valueRub=baseRub||turnkeyRub||num(lead.estimatedCostRub);
  const cost=num(s.price)>0?'от '+money(s.price)
    :valueRub?(turnkeyOnly&&num(s.russiaTurnkeyMaxRub)>turnkeyRub?'от ':'')+rubMoney(valueRub)
    :num(s.estimatedBidUsd)>0?'ставка ≈ '+money(s.estimatedBidUsd):'уточняется';
  const originalBefore=num(s.priceBeforeDiscountRub);
  const mainImage=/^https?:\/\//i.test(str(s.image))?'<img class="auto-catalog-lead-image" src="'+escape(s.image)+'" alt="'+escape(str(s.brand)+' '+str(s.model))+'" loading="lazy">':'';
  const fields=[
    label('Год выпуска',year),label('Пробег автомобиля',mileage),
    label('Двигатель',engine),label('Привод',drive),
    ...(num(s.engineCc)>0?[label('Объём двигателя, см³',num(s.engineCc))]:[]),
    ...(num(s.powerHp)>0?[label('Мощность, л.с.',num(s.powerHp))]:[]),
    label('Сценарий покупки',str(s.origin||lead.origin)),
    label(turnkeyOnly?'Расчёт в России с ремонтом (источник)':'Стоимость из карточки',cost),
    ...(num(s.price)>0&&valueRub?[label('Стоимость в рублях',rubMoney(valueRub))]:[]),
    ...(s.discountExplicit===true&&originalBefore&&originalBefore>valueRub?[label('До скидки',rubMoney(originalBefore))]:[]),
    ...(!turnkeyOnly&&num(s.russiaTurnkeyRub)>0?[label('Цена в России с ремонтом (источник)',num(s.russiaTurnkeyMaxRub)>num(s.russiaTurnkeyRub)
      ?rubMoney(s.russiaTurnkeyRub)+' – '+rubMoney(s.russiaTurnkeyMaxRub):rubMoney(s.russiaTurnkeyRub))]:[]),
    ...(num(s.usaTurnkeyRub)>0?[label('Оценка через США (источник)',rubMoney(s.usaTurnkeyRub))]:[]),
    ...(num(s.georgiaTurnkeyRub)>0?[label('Оценка через Грузию (источник)',rubMoney(s.georgiaTurnkeyRub))]:[]),
    ...(num(s.turnkeyDeliveryRub)>0?[label('Разница: доставка под ключ (источник)',rubMoney(s.turnkeyDeliveryRub))]:[]),
    ...(str(s.auction)?[label('Аукцион / площадка',s.auction)]:[]),
    ...(str(s.auctionDate)?[label('Дата аукциона',s.auctionDate)]:[]),
    ...(str(s.delivery)?[label('Срок доставки',s.delivery)]:[]),
    ...(str(s.tag)?[label('Метка',s.tag)]:[]),
    ...(str(s.vin)?[label('VIN',s.vin)]:[]),
    ...(str(s.body)?[label('Кузов',s.body)]:[]),
    ...(str(s.trim)?[label('Комплектация',s.trim)]:[]),
    ...(str(s.transmission)?[label('Коробка передач',s.transmission)]:[]),
    ...(str(s.interior)?[label('Салон',s.interior)]:[]),
    ...(str(s.damage)?[label('Повреждения',s.damage)]:[]),
    ...(str(s.safety)?[label('Безопасность',s.safety)]:[]),
    ...(str(s.power)?[label('Мощность',s.power)]:[]),
    ...(num(s.customsRub)>0?[label('Таможня в источнике',rubMoney(s.customsRub))]:[]),
    ...(str(s.lot)?[label('Лот',s.lot)]:[]),
    ...(str(s.calculationDate)?[label('Дата расчёта источника',s.calculationDate)]:[]),
    ...(Array.isArray(s.highlights)?s.highlights.map(x=>label('Характеристика',x)):[]),
    ...(str(s.sourceUrl)&&/^https:\/\//i.test(s.sourceUrl)?['<div class="auto-catalog-lead-field"><span>Объявление</span><a href="'+escape(s.sourceUrl)+'" target="_blank" rel="noopener noreferrer">Открыть первоисточник</a></div>']:[]),
    label('ID карточки',str(lead.carId||s.id))
  ].join('');
  return '<section class="full auto-note auto-catalog-lead-details" data-catalog-lead-details>'+
    '<h3>Автомобиль, выбранный из каталога</h3>'+
    '<div class="auto-catalog-lead-content">'+mainImage+'<div class="auto-catalog-lead-fields">'+fields+'</div></div>'+
    '</section>';
}


// A legacy lead may have been created by the older request form without carId.
// Use a catalog match only when a client request has one exact candidate. A price,
// year or origin mismatch must never attach a different car.
export function catalogCarForLead(lead={},cars=[]){
  const linked=String(lead.carId||lead.catalogVehicle?.id||'').trim();
  if(linked){
    const found=cars.find(c=>String(c.id)===linked);
    return{car:lead.catalogVehicle||found||null,linked:true,matchedBy:'id'};
  }
  if(!lead.clientCreated||!String(lead.model||'').trim())return{car:null,linked:false,matchedBy:''};
  const norm=s=>String(s||'').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,' ');
  const target=norm(lead.model),origin=String(lead.origin||'').trim();
  const matches=cars.filter(car=>norm([car.brand,car.model].filter(Boolean).join(' '))===target
    &&(!origin||origin==='Уточняется'||String(car.origin||'')===origin)
    &&(!lead.year||String(lead.year)===String(car.year))
    &&(!lead.estimatedCostRub||!Number(car.priceRub)||Number(lead.estimatedCostRub)===Number(car.priceRub)));
  return{car:matches.length===1?matches[0]:null,linked:false,matchedBy:matches.length===1?'unique-name':''};
}

export function catalogPriceRub(car){
  // Last-resort catalog display/budget estimate: the source's Russia turnkey
  // price, never mislabeled as the underlying car purchase price.
  return Number(car?.priceRub)||Number(car?.priceAfterDiscountRub)||Number(car?.russiaTurnkeyRub)||0;
}
export function catalogBudgetUsd(car,rubPerUsd,step=200){
  const usd=Number(car?.price)>0?Number(car.price):catalogPriceRub(car)/Number(rubPerUsd);
  if(!(usd>0&&Number.isFinite(usd))||!(Number(step)>0))return 0;
  return Math.max(step,Math.round(usd/step)*step);
}
