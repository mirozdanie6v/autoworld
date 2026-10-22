// Read-only targeted production check. Never logs customer contact, name, API credentials or full state.
import assert from 'node:assert/strict';
import {catalogCarForLead} from '../public/auto-sale-catalog-lead.mjs';

const TARGET='L-3493B4C3-B1BB-41B0-9C65-F0FA1FF0AB58';
const apiKey=String(process.env.AUTO_SALE_API_KEY||'').trim();
assert.ok(apiKey.length>=16,'admin API key unavailable');
const response=await fetch('https://awgcars.ru/api/auto-sale/state',{
  method:'GET',headers:{'x-auto-sale-key':apiKey,'accept':'application/json'},
  signal:AbortSignal.timeout(45000)
});
assert.equal(response.status,200,'read-only production state HTTP');
const state=await response.json();
assert.equal(state?._access?.role,'admin','API caller is not authorized as admin');
const leads=Array.isArray(state.leads)?state.leads:[];
const cars=Array.isArray(state.catalog)?state.catalog:[];
const target=leads.find(x=>String(x?.id||'').toUpperCase()===TARGET);
if(!target){
  console.log('AWG_TARGET_LEAD_READONLY_AUDIT',JSON.stringify({
    found:false,targetId:TARGET,productionRevision:state.revision,
    leadCount:leads.length,catalogCount:cars.length
  }));
  process.exit(0);
}
const norm=v=>String(v??'').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,' ');
const model=norm(target.model),origin=String(target.origin||'').trim();
const nameMatches=cars.filter(c=>norm([c.brand,c.model].filter(Boolean).join(' '))===model);
const sameOrigin=nameMatches.filter(c=>!origin||origin==='Уточняется'||String(c.origin||'')===origin);
const sameYear=sameOrigin.filter(c=>!target.year||String(c.year)===String(target.year));
const exactMatches=sameYear.filter(c=>!target.estimatedCostRub||!Number(c.priceRub)||Number(target.estimatedCostRub)===Number(c.priceRub));
const binding=catalogCarForLead(target,cars),linkedId=String(target.carId||'').trim(),
  snapId=String(target.catalogVehicle?.id||'').trim();
const linkedCurrent=linkedId?cars.find(c=>String(c.id)===linkedId):null;
const notes=Array.isArray(state.notes?.[target.id])?state.notes[target.id]:[];
const relatedQuotes=(state.quotes||[]).filter(q=>q.leadId===target.id);
const report={
 found:true,targetId:TARGET,productionRevision:state.revision,
 status:target.status,source:target.source,clientCreated:Boolean(target.clientCreated),
 catalogRequest:Boolean(target.catalogRequest),model:target.model,origin:target.origin,
 year:target.year||null,mileage:target.mileage||null,engine:target.engine||null,drive:target.drive||null,
 carId:linkedId||null,snapshotCarId:snapId||null,
 snapshotMatchesCarId:Boolean(linkedId&&snapId&&linkedId===snapId),
 hasSnapshot:Boolean(target.catalogVehicle),snapshotModel:target.catalogVehicle?
  [target.catalogVehicle.brand,target.catalogVehicle.model].filter(Boolean).join(' '):null,
 linkedCarExistsInCurrentCatalog:Boolean(linkedCurrent),
 linkedCarActive:linkedCurrent?linkedCurrent.active!==false:null,
 resolveMethod:binding.matchedBy||'none',autoResolvedCandidateId:binding.car?.id||null,
 matchingCatalogCounts:{byName:nameMatches.length,withOrigin:sameOrigin.length,withYear:sameYear.length,exact:exactMatches.length},
 matchingCandidates:exactMatches.slice(0,12).map(c=>({
  id:c.id,year:c.year,origin:c.origin,active:c.active!==false,
  priceRub:Number(c.priceRub)||null,vinPresent:Boolean(c.vin)
 })),
 quoteCount:relatedQuotes.length,latestQuoteStatus:relatedQuotes.at(-1)?.status||null,
 notesCount:notes.length,
 availableCatalogCount:cars.length
};
console.log('AWG_TARGET_LEAD_READONLY_AUDIT',JSON.stringify(report));
