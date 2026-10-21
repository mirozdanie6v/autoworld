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
    tag:str(car.tag),vin:str(car.vin),image:str(car.image),
    price:num(car.price),estimatedBidUsd:num(car.estimatedBidUsd),priceRub:num(car.priceRub),
    priceBeforeDiscountRub:num(car.priceBeforeDiscountRub),
    priceAfterDiscountRub:num(car.priceAfterDiscountRub),
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
  const valueRub=num(s.priceRub)||num(s.priceAfterDiscountRub)||num(lead.estimatedCostRub);
  const cost=num(s.price)>0?'от '+money(s.price):valueRub?rubMoney(valueRub):num(s.estimatedBidUsd)>0?'ставка ≈ '+money(s.estimatedBidUsd):'уточняется';
  const originalBefore=num(s.priceBeforeDiscountRub);
  const mainImage=/^https?:\/\//i.test(str(s.image))?'<img class="auto-catalog-lead-image" src="'+escape(s.image)+'" alt="'+escape(str(s.brand)+' '+str(s.model))+'" loading="lazy">':'';
  const fields=[
    label('Год выпуска',year),label('Пробег автомобиля',mileage),
    label('Двигатель',engine),label('Привод',drive),
    label('Сценарий покупки',str(s.origin||lead.origin)),
    label('Стоимость из карточки',cost),
    ...(num(s.price)>0&&valueRub?[label('Стоимость в рублях',rubMoney(valueRub))]:[]),
    ...(originalBefore&&originalBefore>valueRub?[label('До скидки',rubMoney(originalBefore))]:[]),
    ...(str(s.auction)?[label('Аукцион / площадка',s.auction)]:[]),
    ...(str(s.auctionDate)?[label('Дата аукциона',s.auctionDate)]:[]),
    ...(str(s.delivery)?[label('Срок доставки',s.delivery)]:[]),
    ...(str(s.tag)?[label('Метка',s.tag)]:[]),
    ...(str(s.vin)?[label('VIN',s.vin)]:[]),
    label('ID карточки',str(lead.carId||s.id))
  ].join('');
  return '<section class="full auto-note auto-catalog-lead-details" data-catalog-lead-details>'+
    '<h3>Автомобиль, выбранный из каталога</h3>'+
    '<div class="auto-catalog-lead-content">'+mainImage+'<div class="auto-catalog-lead-fields">'+fields+'</div></div>'+
    '</section>';
}
