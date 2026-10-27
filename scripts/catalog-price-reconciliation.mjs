import {verifiedSourceRubPrice} from './catalog-price-extract.mjs';

const postId=value=>String(value??'').trim();
const validPrice=value=>{
  const amount=Number(value);
  return Number.isSafeInteger(amount)&&amount>=100000&&amount<=100000000;
};
export function planCatalogPriceRepairs(liveCatalog=[],archivePosts=[],recentPosts=[]){
  const sources=new Map();
  for(const source of [...archivePosts,...recentPosts]){
    const id=postId(source?.sourcePostId);
    if(!/^\d+$/.test(id)||!String(source?.rawText||'').trim())continue;
    const resolved=verifiedSourceRubPrice(source);
    const current=sources.get(id);
    if(!current || (resolved.priceRub>0 && !current.resolution.priceRub) ||
      (source===current.source && resolved.priceRub>0))sources.set(id,{source,resolution:resolved});
  }
  const repairItems=[],priceConflicts=[],unresolved=[],missingSources=[],priced=[],bidOnly=[];
  for(const car of liveCatalog){
    if(String(car?.source||'')!=='AutoWorld_Georgia')continue;
    const id=postId(car.sourcePostId),priceRub=Number(car.priceRub)||0;
    if(!/^\d+$/.test(id))continue;
    const found=sources.get(id);
    if(!found){
      if(priceRub<=0)missingSources.push({id:car.id,sourcePostId:id,sourceUrl:car.sourceUrl});
      continue;
    }
    const {source,resolution}=found,expected=Number(resolution.priceRub)||0;
    if(!validPrice(expected)){
      if(priceRub<=0)unresolved.push({id:car.id,sourcePostId:id,reason:resolution.reason||'invalid_source_price'});
      continue;
    }
    if(priceRub>0){
      if(priceRub!==expected)priceConflicts.push({id:car.id,sourcePostId:id,existingPriceRub:priceRub,sourcePriceRub:expected});
      else priced.push(id);
      continue;
    }
    if(Number(car.estimatedBidUsd)>0){
      bidOnly.push({id:car.id,sourcePostId:id,estimatedBidUsd:Number(car.estimatedBidUsd)});
    }
    if(car.id!==('AWG-'+id)){
      unresolved.push({id:car.id,sourcePostId:id,reason:'unexpected_catalog_identity'});
      continue;
    }
    repairItems.push({
      id:car.id,sourcePostId:id,sourceUrl:'https://t.me/AutoWorld_Georgia/'+id,
      priceRub:expected,sourcePriceMethod:resolution.method||'source_metadata'
    });
  }
  return {
    items:repairItems,
    audit:{
      liveSourceCount:liveCatalog.filter(x=>x?.source==='AutoWorld_Georgia').length,
      sourceRawPosts:sources.size,
      repairCount:repairItems.length,
      verifiedExistingCount:priced.length,
      positivePriceConflicts:priceConflicts,
      unresolved,
      missingSources,
      bidOnly,
      repairs:repairItems.map(x=>({sourcePostId:x.sourcePostId,priceRub:x.priceRub,method:x.sourcePriceMethod}))
    }
  };
}
