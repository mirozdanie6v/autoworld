import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {extractSourcePrices} from './catalog-source-price.mjs';

const archivePath=process.env.ARCHIVE_PATH||'data/autoworld-georgia/cars.json';
const recentPath=process.env.RECENT_PATH||'/tmp/awg-price-audit/recent/cars.json';
const livePath=process.env.LIVE_PATH||'/tmp/awg-price-audit/live-catalog.json';
const outputPath=process.env.REPORT_PATH||'/tmp/awg-price-audit/live-price-drift.json';
const csvPath=process.env.CSV_PATH||'/tmp/awg-price-audit/live-price-drift.csv';
const n=v=>Math.max(0,Math.round(Number(v)||0));
const id=v=>String(v??'').trim();
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const [archived,recent,live]=await Promise.all([read(archivePath),read(recentPath),read(livePath)]);
if(archived.length<50||recent.length<10||live.length<100)throw Error('incomplete_source_or_live_snapshot');
const sourceByPost=new Map();
for(const row of archived){if(row?.sourcePostId&&row.rawText)sourceByPost.set(id(row.sourcePostId),{...row,capture:'archive'});}
for(const row of recent){if(row?.sourcePostId&&row.rawText)sourceByPost.set(id(row.sourcePostId),{...row,capture:'fresh_telegram'});}
const liveByPost=new Map(live.filter(c=>c?.source==='AutoWorld_Georgia').map(c=>[id(c.sourcePostId),c]));
const verified=[],priceDiffs=[],turnkeyDiffs=[],unresolved=[],reposts=[];
for(const [postId,car] of liveByPost){
  const src=sourceByPost.get(postId);
  const base={postId,carId:id(car.id),title:[car.brand,car.model,car.year].filter(Boolean).join(' '),
    vin:id(car.vin).toUpperCase(),sourceUrl:id(src?.sourceUrl)||id(car.sourceUrl)||'https://t.me/AutoWorld_Georgia/'+postId,
    appPriceRub:n(car.priceRub),appTurnkeyRub:n(car.russiaTurnkeyRub),sourceCapturedFrom:src?.capture||'not_available'};
  if(!src?.rawText){unresolved.push({...base,reason:'source_message_not_captured'});continue;}
  const p=extractSourcePrices(src.rawText);
  const expected=n(p.priceRub),expectedTurnkey=n(p.russiaTurnkeyRub);
  const evidence=p.priceEvidence;
  if(expected>0 && ['channel_emoji','source_label'].includes(evidence)){
    if(expected!==base.appPriceRub){
      priceDiffs.push({...base,sourcePriceRub:expected,deltaRub:base.appPriceRub-expected,
        evidence,reason:base.appPriceRub===0?'missing_listing_price':'different_listing_price'});
    }else verified.push({...base,sourcePriceRub:expected});
    if(expectedTurnkey>0 && expectedTurnkey!==base.appTurnkeyRub)
      turnkeyDiffs.push({...base,sourceTurnkeyRub:expectedTurnkey,sourcePriceRub:expected,deltaRub:base.appTurnkeyRub-expectedTurnkey,evidence});
  }else if(evidence==='russia_turnkey_only' && expectedTurnkey>0){
    if(expectedTurnkey!==base.appTurnkeyRub)
      turnkeyDiffs.push({...base,sourceTurnkeyRub:expectedTurnkey,sourcePriceRub:0,deltaRub:base.appTurnkeyRub-expectedTurnkey,evidence});
    else verified.push({...base,sourceTurnkeyRub:expectedTurnkey,verifiedField:'russiaTurnkeyRub'});
  }else{
    unresolved.push({...base,reason:'source_price_not_unambiguously_decoded',extractedPriceRub:expected,
      extractedTurnkeyRub:expectedTurnkey,sourceNumericPriceRub:n(src.priceRub)});
  }
}
// A repost is NOT a proven wrong price for another post; keep separately for manual review.
const currentByVin=new Map();
for(const c of liveByPost.values()){const v=id(c.vin).toUpperCase();if(v)currentByVin.set(v,c);}
for(const s of recent){
  const v=id(s.vin).toUpperCase(),actual=v?currentByVin.get(v):null;
  if(!actual||id(actual.sourcePostId)===id(s.sourcePostId))continue;
  const p=extractSourcePrices(s.rawText||'');
  if(!p.priceRub||!n(actual.priceRub)||p.priceRub===n(actual.priceRub))continue;
  reposts.push({vin:v,appPostId:id(actual.sourcePostId),newPostId:id(s.sourcePostId),
    carId:id(actual.id),title:[actual.brand,actual.model,actual.year].filter(Boolean).join(' '),
    appPriceRub:n(actual.priceRub),repostPriceRub:p.priceRub,
    sourceUrl:id(s.sourceUrl)||'https://t.me/AutoWorld_Georgia/'+s.sourcePostId,
    reason:'newer_or_different_post_same_vin_check_listing_identity'});
}
const report={generatedAt:new Date().toISOString(),mode:'READ_ONLY',liveCars:liveByPost.size,
  archivedCars:archived.length,recentCars:recent.length,capturedSourcePosts:sourceByPost.size,
  verifiedCount:verified.length,purchaseDiscrepancyCount:priceDiffs.length,
  turnkeyDiscrepancyCount:turnkeyDiffs.length,unresolvedCount:unresolved.length,
  repostPriceReviewCount:reposts.length,
  purchaseDiscrepancies:priceDiffs,turnkeyDiscrepancies:turnkeyDiffs,
  unresolved,repostPriceReview:reposts,verified};
const csvQuote=x=>'"'+String(x??'').replaceAll('"','""')+'"';
const cols=['category','title','postId','sourceUrl','appPriceRub','sourcePriceRub','appTurnkeyRub','sourceTurnkeyRub','deltaRub','reason'];
const row=(cat,x)=>cols.map(k=>csvQuote(k==='category'?cat:x[k])).join(',');
const csv=[cols.join(','),...priceDiffs.map(x=>row('purchase_price',x)),
  ...turnkeyDiffs.map(x=>row('turnkey_price',x)),...unresolved.map(x=>row('manual_review',x)),
  ...reposts.map(x=>row('same_vin_repost',x))].join('\n')+'\n';
await mkdir(dirname(outputPath),{recursive:true});
await writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
await writeFile(csvPath,csv);
console.log('AWG_LIVE_PRICE_DRIFT',JSON.stringify({
  generatedAt:report.generatedAt,liveCars:report.liveCars,archivedCars:report.archivedCars,
  recentCars:report.recentCars,verifiedCount:report.verifiedCount,
  purchaseDiscrepancyCount:report.purchaseDiscrepancyCount,
  turnkeyDiscrepancyCount:report.turnkeyDiscrepancyCount,unresolvedCount:report.unresolvedCount,
  repostPriceReviewCount:report.repostPriceReviewCount,
  purchaseDiscrepancies:report.purchaseDiscrepancies,
  turnkeyDiscrepancies:report.turnkeyDiscrepancies,
  unresolved:report.unresolved,
  repostPriceReview:report.repostPriceReview
}));
