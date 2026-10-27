import {readFileSync} from 'node:fs';

const before=JSON.parse(readFileSync('/tmp/awg-price-state.json','utf8')).catalog;
const after=JSON.parse(readFileSync('/tmp/awg-price-state-after.json','utf8')).catalog;
const items=JSON.parse(readFileSync('/tmp/awg-price-repair-items.json','utf8'));
const beforeMap=new Map(before.map(car=>[car.id,car]));
const afterMap=new Map(after.map(car=>[car.id,car]));
if(beforeMap.size!==afterMap.size)throw Error('catalog_count_changed_during_price_repair');
for(const repair of items){
  const old=beforeMap.get(repair.id),current=afterMap.get(repair.id);
  if(!old||!current)throw Error('missing_repair_identity_'+repair.id);
  if(!(Number(current.priceRub)>0))throw Error('price_still_missing_'+repair.id);
  if(old.active!==current.active)throw Error('manual_visibility_changed_'+repair.id);
  if(old.image!==current.image||
    JSON.stringify(old.otherPhotos)!==JSON.stringify(current.otherPhotos))
    throw Error('catalog_media_changed_'+repair.id);
  if(String(old.sourcePostId)!==String(current.sourcePostId))
    throw Error('source_identity_changed_'+repair.id);
}
console.log('AWG_PRICE_REPAIR_VERIFY_OK',JSON.stringify({
  inspected:items.length,liveCatalogCount:after.length
}));
