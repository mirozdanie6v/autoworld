import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {extractSourcePrices} from './catalog-source-price.mjs';

// Produces minimal price-only updates for existing cars. Never replaces an
// existing catalog ID/VIN or writes manager fields from a scraper snapshot.
const val=x=>String(x??'').trim();
const rub=x=>Math.round(Number(x)||0);
const post=x=>Number(x)||0;
const validVin=x=>/^[A-HJ-NPR-Z0-9]{17}$/.test(val(x).toUpperCase());
const PRICE_FIELDS=['priceRub','priceBeforeDiscountRub','priceAfterDiscountRub',
  'discountExplicit','catalogPriceEvidence','russiaTurnkeyRub',
  'russiaTurnkeyMaxRub','russiaTurnkeyKind','usaTurnkeyRub',
  'georgiaTurnkeyRub','turnkeyDeliveryRub','turnkeyDeliverySource',
  'catalogPriceSourcePostId','catalogPriceSourceUrl','sourceUrl'];

export function prepareCatalogPriceSync({source,live,normalized}){
  if(!Array.isArray(source)||!Array.isArray(live)||!Array.isArray(normalized))
    throw Error('catalog_price_sync_invalid_input');
  const originals=live.filter(c=>c?.source==='AutoWorld_Georgia');
  if(originals.length<1)throw Error('catalog_price_sync_no_source_cars');
  const byId=new Map(originals.map(c=>[val(c.id),c]));
  const byPost=new Map(originals.map(c=>[val(c.sourcePostId),c]));
  const byVin=new Map(),duplicateLiveVins=new Set();
  for(const car of originals){
    const vin=val(car.vin).toUpperCase();
    if(!validVin(vin))continue;
    if(byVin.has(vin))duplicateLiveVins.add(vin);
    else byVin.set(vin,car);
  }
  const latest=new Map(),unresolved=[];
  for(const row of source){
    const postId=val(row?.sourcePostId),vin=val(row?.vin).toUpperCase();
    if(!/^\d+$/.test(postId)||!val(row?.rawText))continue;
    const candidate=validVin(vin)&&!duplicateLiveVins.has(vin)?byVin.get(vin):byPost.get(postId);
    if(!candidate)continue;
    // A post ID may match a different car. Never match using a name alone.
    if(validVin(vin)&&validVin(candidate.vin)&&vin!==val(candidate.vin).toUpperCase()){
      unresolved.push({postId,vin,reason:'source_vin_conflicts_with_live_post'});
      continue;
    }
    if(duplicateLiveVins.has(vin)){
      unresolved.push({postId,vin,reason:'duplicate_live_vin'});
      continue;
    }
    const lastPost=Math.max(post(candidate.sourcePostId),post(candidate.catalogPriceSourcePostId));
    if(post(postId)<lastPost)continue; // Older repost must not lower a newer quote.
    const key=val(candidate.id),before=latest.get(key);
    if(!before||post(postId)>post(before.row.sourcePostId))latest.set(key,{row,car:candidate});
  }

  const patches=[],changes=[];
  for(const {row,car} of latest.values()){
    const sourcePostId=val(row.sourcePostId),e=extractSourcePrices(row.rawText);
    if(!['channel_emoji','source_label'].includes(e.priceEvidence)||rub(e.priceRub)<100000){
      unresolved.push({postId:sourcePostId,id:car.id,reason:'primary_price_not_verified'});
      continue;
    }
    if(rub(row.priceRub)>0 && rub(row.priceRub)!==rub(e.priceRub)){
      unresolved.push({postId:sourcePostId,id:car.id,reason:'independent_price_parsers_disagree',
        fromScraper:rub(row.priceRub),fromRaw:rub(e.priceRub)});
      continue;
    }
    if(car.manualPriceOverride===true||car.priceOverrideManual===true||
       /manual|manager/i.test(val(car.catalogPriceEvidence))){
      unresolved.push({postId:sourcePostId,id:car.id,reason:'manager_price_override'});
      continue;
    }
    const original=rub(car.priceRub),expected=rub(e.priceRub);
    if(original>0 && Math.abs(expected-original)/original>0.5){
      unresolved.push({postId:sourcePostId,id:car.id,reason:'change_over_50_percent',old:original,new:expected});
      continue;
    }
    // No evidence of a Russian turnkey sum means preserve its prior value.
    const turnkey=rub(e.russiaTurnkeyRub)>0?rub(e.russiaTurnkeyRub):rub(car.russiaTurnkeyRub);
    const fields={
      priceRub:expected,
      priceBeforeDiscountRub:rub(e.priceBeforeDiscountRub),
      priceAfterDiscountRub:rub(e.priceAfterDiscountRub),
      discountExplicit:Boolean(e.discountExplicit),
      catalogPriceEvidence:e.priceEvidence,
      russiaTurnkeyRub:turnkey,
      russiaTurnkeyMaxRub:e.russiaTurnkeyRub>0?rub(e.russiaTurnkeyMaxRub):rub(car.russiaTurnkeyMaxRub),
      russiaTurnkeyKind:e.russiaTurnkeyRub>0?val(e.russiaTurnkeyKind):val(car.russiaTurnkeyKind),
      usaTurnkeyRub:e.russiaTurnkeyRub>0?rub(e.usaTurnkeyRub):rub(car.usaTurnkeyRub),
      georgiaTurnkeyRub:e.russiaTurnkeyRub>0?rub(e.georgiaTurnkeyRub):rub(car.georgiaTurnkeyRub),
      turnkeyDeliveryRub:turnkey>expected?turnkey-expected:0,
      turnkeyDeliverySource:turnkey>expected?'source_russia_with_repair_difference':'',
      catalogPriceSourcePostId:sourcePostId,
      catalogPriceSourceUrl:'https://t.me/AutoWorld_Georgia/'+sourcePostId,
      sourceUrl:sourcePostId!==val(car.sourcePostId)?'https://t.me/AutoWorld_Georgia/'+sourcePostId:
        val(car.sourceUrl)||'https://t.me/AutoWorld_Georgia/'+sourcePostId
    };
    const altered=Object.entries(fields).filter(([k,v])=>String(car[k]??(typeof v==='number'?0:typeof v==='boolean'?false:''))!==String(v)).map(([k])=>k);
    // Only refresh price-source metadata if a numeric price field changed.
    const substantive=altered.some(k=>['priceRub','priceBeforeDiscountRub',
      'priceAfterDiscountRub','discountExplicit','russiaTurnkeyRub',
      'russiaTurnkeyMaxRub','usaTurnkeyRub','georgiaTurnkeyRub',
      'turnkeyDeliveryRub'].includes(k));
    if(!substantive)continue;
    const patch={id:val(car.id)};
    for(const field of PRICE_FIELDS)if(altered.includes(field))patch[field]=fields[field];
    // These partial records contain NO photos, VIN, sourcePostId, active,
    // status, manager pricing fields or other catalog data.
    patches.push(patch);
    changes.push({id:patch.id,vin:val(car.vin),sourcePostId:val(car.sourcePostId),
      priceSourcePostId:sourcePostId,sourceUrl:fields.catalogPriceSourceUrl,
      previousPriceRub:original,nextPriceRub:expected,
      previousTurnkeyRub:rub(car.russiaTurnkeyRub),nextTurnkeyRub:turnkey,
      modifiedFields:altered});
  }

  // The server's legacy same-VIN path deletes and recreates IDs; prevent it
  // by excluding already known VINs and IDs from full-card imports.
  const fresh=[];
  for(const item of normalized){
    const vin=val(item?.vin).toUpperCase(),id=val(item?.id);
    if(!id||val(item?.source)!=='AutoWorld_Georgia')throw Error('unexpected_catalog_item');
    if(byId.has(id)||(validVin(vin)&&byVin.has(vin)))continue;
    if(validVin(vin)&&duplicateLiveVins.has(vin))
      throw Error('duplicate_live_vin_full_import_'+vin);
    fresh.push(item);
  }
  if(patches.length>60)throw Error('price_patch_scope_exceeds_60');
  if(new Set([...patches,...fresh].map(c=>val(c.id))).size!==patches.length+fresh.length)
    throw Error('duplicate_import_id');
  return {items:[...fresh,...patches],report:{
    mode:'PRICE_SAFE_UPSERT',liveSourceCars:originals.length,freshPosts:source.length,
    normalizedCars:normalized.length,newCars:fresh.length,pricePatches:patches.length,
    unchangedOrOlderPosts:source.length-latest.size,changes,unresolved,
    duplicateLiveVins:[...duplicateLiveVins]}};
}

async function main(){
  const source=JSON.parse(await readFile(process.env.SOURCE_PATH||'/tmp/awg-import/cars.json','utf8'));
  const live=JSON.parse(await readFile(process.env.LIVE_PATH||'/tmp/awg-import/live-catalog.json','utf8'));
  const normalized=JSON.parse(await readFile(process.env.NORMALIZED_PATH||'/tmp/awg-catalog-normalized.json','utf8'));
  const out=prepareCatalogPriceSync({source,live,normalized});
  const outputPath=process.env.OUTPUT_PATH||'/tmp/awg-catalog-import.json';
  const reportPath=process.env.REPORT_PATH||'/tmp/awg-import/price-sync-report.json';
  for(const p of [outputPath,reportPath])await mkdir(dirname(p),{recursive:true});
  await writeFile(outputPath,JSON.stringify(out.items,null,2)+'\n');
  await writeFile(reportPath,JSON.stringify(out.report,null,2)+'\n');
  console.log('AWG_PRICE_SAFE_IMPORT_PLAN',JSON.stringify(out.report));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(e=>{console.error(e);process.exit(1)});
