import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {extractSourcePrices} from './catalog-source-price.mjs';

const SOURCE_PATH=process.env.SOURCE_PATH||'data/autoworld-georgia/cars.json';
const LIVE_PATH=process.env.LIVE_PATH||'/tmp/awg-price-audit/live-catalog.json';
const REPORT_PATH=process.env.REPORT_PATH||'/tmp/awg-price-audit/report.json';
const DELTA_PATH=process.env.DELTA_PATH||'/tmp/awg-price-audit/corrections.json';
const clean=x=>String(x||'').trim();
const num=x=>Math.round(Math.max(0,Number(x)||0));
const FIELDS=['priceRub','priceBeforeDiscountRub','priceAfterDiscountRub',
  'discountExplicit','russiaTurnkeyRub','turnkeyDeliveryRub','turnkeyDeliverySource',
  'catalogPriceEvidence'];

const source=JSON.parse(await readFile(SOURCE_PATH,'utf8'));
const current=JSON.parse(await readFile(LIVE_PATH,'utf8'));
if(!Array.isArray(source)||source.length<50)throw Error('source_history_missing_or_incomplete');
if(!Array.isArray(current)||current.length<50)throw Error('live_catalog_missing_or_incomplete');
const existing=new Map(current.filter(x=>x?.source==='AutoWorld_Georgia')
  .map(x=>[clean(x.sourcePostId),x]).filter(x=>x[0]));
const sourceByPost=new Map(source.filter(x=>x&&x.sourcePostId)
  .map(x=>[clean(x.sourcePostId),x]));
const candidate=[],unresolved=[],report=[];
for(const [postId,car] of existing){
  const row=sourceByPost.get(postId);
  if(!row||!row.rawText){
    unresolved.push({postId,reason:'no_archived_source_text',livePriceRub:num(car.priceRub)});
    continue;
  }
  const recovered=extractSourcePrices(row.rawText);
  if(!recovered.priceRub||recovered.priceEvidence==='unresolved'){
    unresolved.push({postId,reason:'source_price_not_confirmed',livePriceRub:num(car.priceRub)});
    continue;
  }
  const patch={priceRub:recovered.priceRub,
    priceBeforeDiscountRub:recovered.priceBeforeDiscountRub,
    priceAfterDiscountRub:recovered.priceAfterDiscountRub,
    discountExplicit:recovered.discountExplicit,
    catalogPriceEvidence:recovered.priceEvidence};
  if(recovered.russiaTurnkeyRub>0){
    patch.russiaTurnkeyRub=recovered.russiaTurnkeyRub;
    patch.turnkeyDeliveryRub=recovered.turnkeyDeliveryRub;
    patch.turnkeyDeliverySource=recovered.turnkeyDeliverySource;
  }
  const changed=Object.keys(patch).filter(k=>String(car[k]??(typeof patch[k]==='boolean'?false:k==='catalogPriceEvidence'?'':0))!==String(patch[k]));
  // A backfill of price evidence alone is NOT a catalog discrepancy and
  // should not generate a database write for an otherwise identical car.
  if(!changed.some(k=>k!=='catalogPriceEvidence'))continue;
  const original=num(car.priceRub),price=recovered.priceRub;
  // Guard against editing an independently manager-priced car with a wildly
  // different source. Such records require manual investigation.
  if(original>0&&Math.abs(price-original)/original>0.5){
    unresolved.push({postId,reason:'large_price_difference_requires_review',livePriceRub:original,sourcePriceRub:price});
    continue;
  }
  const next={...car,...patch,id:car.id,source:'AutoWorld_Georgia',active:car.active!==false};
  candidate.push(next);
  report.push({postId,sourceUrl:row.sourceUrl||'https://t.me/AutoWorld_Georgia/'+postId,
    livePriceRub:original,sourcePriceRub:price,
    liveTurnkeyRub:num(car.russiaTurnkeyRub),sourceTurnkeyRub:num(recovered.russiaTurnkeyRub),
    evidence:recovered.priceEvidence,fields:changed,active:car.active!==false});
}
if(candidate.length>180)throw Error('price_correction_scope_exceeds_180');
if(candidate.some(item=>!(item.priceRub>0)||!existing.has(clean(item.sourcePostId))))
  throw Error('invalid_price_correction_payload');
if(candidate.some(item=>item.source!=='AutoWorld_Georgia'))throw Error('cross_source_edit_forbidden');
if(new Set(candidate.map(x=>x.id)).size!==candidate.length)throw Error('duplicate_catalog_record_target');
for(const path of [REPORT_PATH,DELTA_PATH])await mkdir(dirname(path),{recursive:true});
const unpricedCases=current.filter(car=>car.source==='AutoWorld_Georgia'&&num(car.priceRub)===0).map(car=>{
  const postId=clean(car.sourcePostId),row=sourceByPost.get(postId),raw=String(row?.rawText||'');
  const result=extractSourcePrices(raw);
  return {postId,active:car.active!==false,hasBid:Number(car.estimatedBidUsd||0)>0,
    sourceArchived:Boolean(raw),archiveChars:raw.length,
    priceBeforeDiscountRub:num(car.priceBeforeDiscountRub),russiaTurnkeyRub:num(car.russiaTurnkeyRub),
    priceEvidence:result.priceEvidence,publicExcerpt:raw.slice(0,650).replace(/\b\d{7,}\b/g,'[number]')};
});
const unpricedArchiveSummary={archived:unpricedCases.filter(c=>c.sourceArchived).length,unarchived:unpricedCases.filter(c=>!c.sourceArchived).length};
const audit={generatedAt:new Date().toISOString(),sourcePosts:source.length,
  liveSourceCars:existing.size,
  liveUnpriced:current.filter(x=>x.source==='AutoWorld_Georgia'&&num(x.priceRub)===0&&num(x.estimatedBidUsd)===0).length,
  sourceStickerRecovered:source.filter(x=>extractSourcePrices(x.rawText||'').priceRub>0).length,
  candidates:report.length,unresolvedCount:unresolved.length,
  missingPricesCorrectable:report.filter(x=>x.livePriceRub===0&&x.sourcePriceRub>0).length,
  existingPricesCorrectable:report.filter(x=>x.livePriceRub>0&&x.livePriceRub!==x.sourcePriceRub).length,
  secondaryPriceCorrections:report.filter(x=>x.livePriceRub===x.sourcePriceRub&&x.fields.some(f=>f!=='catalogPriceEvidence')).length,
  corrections:report,unresolved};
audit.unpricedDiagnostics=unpricedCases;
audit.unpricedArchiveSummary=unpricedArchiveSummary;
await writeFile(REPORT_PATH,JSON.stringify(audit,null,2)+'\n');
await writeFile(DELTA_PATH,JSON.stringify(candidate,null,2)+'\n');
console.log('AWG_UNPRICED_CASES',JSON.stringify({total:unpricedCases.length,archive:unpricedArchiveSummary,cases:unpricedCases}));
console.log('AWG_PRICE_AUDIT',JSON.stringify({
  sourcePosts:audit.sourcePosts,liveSourceCars:audit.liveSourceCars,
  liveUnpriced:audit.liveUnpriced,sourceStickerRecovered:audit.sourceStickerRecovered,
  candidates:audit.candidates,unresolvedCount:audit.unresolvedCount,
  missingPricesCorrectable:audit.missingPricesCorrectable,
  existingPricesCorrectable:audit.existingPricesCorrectable,
  secondaryPriceCorrections:audit.secondaryPriceCorrections,
  sample:report.slice(0,35).map(x=>({postId:x.postId,old:x.livePriceRub,new:x.sourcePriceRub,
    turnkey:x.sourceTurnkeyRub,fields:x.fields})),
  unresolvedSample:unresolved.slice(0,25)
}));
