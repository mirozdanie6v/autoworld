// Fail closed when a card-origin request arrives without its exact vehicle identity.
// Older/stale Mini App builds can send the exact free-text catalog engine and model
// as a "general" lead after losing the selected-card context. Never guess a car ID.
const text=v=>String(v??'').trim();
const normal=v=>text(v).toLocaleLowerCase('ru-RU').replace(/\s+/g,' ');
const broadEngines=new Set(['','не важно','бензин','дизель','гибрид','electric','электро','электромобиль']);
export const CATALOG_REQUEST_CLIENT_VERSION='20261022-catalog-binding-v3';
export function catalogLeadCreationGuard(lead={},catalog=[]){
  if(lead.clientCreated!==true)return null;
  const selected=text(lead.carId),snap=text(lead.catalogVehicle?.id),intent=text(lead.requestFlow);
  if(lead.catalogRequest===true){
    if(!selected||!snap||selected!==snap||intent==='general_request')
      return 'catalog_car_binding_required';
    if(!catalog.some(car=>text(car.id)===selected&&car.active!==false))
      return 'catalog_car_not_available';
    return null;
  }
  // All modern catalog entrypoints carry this metadata; it cannot silently
  // disappear even if legacy form hidden inputs were changed or dropped.
  if(selected||snap||intent==='catalog_card'||text(lead.requestCarId))
    return 'catalog_car_binding_required';
  const engine=normal(lead.engine);
  if(broadEngines.has(engine)||!engine)return null;
  const model=normal(lead.model),origin=normal(lead.origin),drive=normal(lead.drive);
  // General selection UI offers only broad fuel-type engines. A detailed
  // catalog-spec string matching current vehicle records identifies an older
  // card form that was submitted without its selected ID; reject, don't guess.
  const catalogLike=catalog.some(car=>car.active!==false&&
    normal([car.brand,car.model].filter(Boolean).join(' '))===model&&
    (!origin||normal(car.origin)===origin)&&normal(car.engine)===engine&&
    (!drive||normal(car.drive)===drive));
  return catalogLike?'catalog_car_binding_missing':null;
}
