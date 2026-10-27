import {readFile,writeFile} from 'node:fs/promises';
import {planCatalogPriceRepairs} from './catalog-price-reconciliation.mjs';

const STATE_PATH=process.env.STATE_PATH||'/tmp/awg-price-state.json';
const ARCHIVE_PATH=process.env.ARCHIVE_SOURCE_PATH||'data/autoworld-georgia/cars.json';
const SNAPSHOT_PATH=process.env.SNAPSHOT_SOURCE_PATH||'data/autoworld-georgia-recent/cars.json';
const RECENT_PATH=process.env.RECENT_SOURCE_PATH||'/tmp/awg-price-scrape/cars.json';
const OUTPUT_PATH=process.env.OUTPUT_PATH||'/tmp/awg-price-repair-items.json';
const AUDIT_PATH=process.env.AUDIT_PATH||'/tmp/awg-price-repair-audit.json';

async function loadArray(file,{optional=false}={}){
  try{
    const value=JSON.parse(await readFile(file,'utf8'));
    if(!Array.isArray(value))throw new Error('array_expected_'+file);
    return value;
  }catch(error){
    if(optional&&error?.code==='ENOENT')return [];
    throw error;
  }
}
const state=JSON.parse(await readFile(STATE_PATH,'utf8'));
if(!Array.isArray(state.catalog))throw new Error('production_catalog_missing');
const archive=await loadArray(ARCHIVE_PATH);
const snapshot=await loadArray(SNAPSHOT_PATH,{optional:true});
const recent=await loadArray(RECENT_PATH,{optional:true});
const {items,audit}=planCatalogPriceRepairs(state.catalog,[...archive,...snapshot],recent);
await writeFile(OUTPUT_PATH,JSON.stringify(items,null,2)+'\n');
await writeFile(AUDIT_PATH,JSON.stringify(audit,null,2)+'\n');
console.log('AWG_PRICE_REPAIR_PLAN',JSON.stringify({
  liveSourceCount:audit.liveSourceCount,rawPosts:audit.sourceRawPosts,
  repairCount:audit.repairCount,verifiedExistingCount:audit.verifiedExistingCount,
  conflicts:audit.positivePriceConflicts.length,
  unresolved:audit.unresolved.length,missingSources:audit.missingSources.length,
  repairIds:audit.repairs.map(item=>item.sourcePostId)
}));
if(audit.liveSourceCount<100)throw new Error('suspiciously_small_production_catalog');
if(audit.repairCount>0&&items.some(x=>!Number.isSafeInteger(x.priceRub)||x.priceRub<=0))throw new Error('unsafe_price_repair_plan');
