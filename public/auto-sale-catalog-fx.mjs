// Informational ruble/USD conversion for catalog card budgets, not binding quote exchange rates.
// An external rate is never invented. A failed lookup leaves the RUB price visible and lets
// the manager supply a verified rate manually.
const URL='https://www.cbr-xml-daily.ru/daily_json.js';
let cached=null, inflight=null;
export function parseRubPerUsd(payload,now=Date.now()){
  const rate=Number(payload?.Valute?.USD?.Value);
  const when=Date.parse(payload?.Date||payload?.Timestamp||'');
  if(!(rate>0&&Number.isFinite(rate))||!Number.isFinite(when)||when>now+48*3600000||when<now-7*86400000)
    throw new Error('catalog_usd_rate_missing_or_stale');
  return{rate,date:new Date(when).toISOString().slice(0,10),source:'CBR via cbr-xml-daily.ru'};
}
export async function catalogRubPerUsd({fetchImpl=globalThis.fetch,now=Date.now(),timeoutMs=4000}={}){
  if(cached&&now-cached.fetchedAt<6*3600000)return cached.value;
  if(inflight)return inflight;
  inflight=(async()=>{
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
    try{
      const response=await fetchImpl(URL,{signal:ctrl.signal,cache:'no-store'});
      if(!response?.ok)throw new Error('catalog_usd_rate_http_error');
      const result=parseRubPerUsd(await response.json(),now);
      cached={value:result,fetchedAt:now};
      return result;
    }finally{clearTimeout(timer)}
  })();
  try{return await inflight}finally{inflight=null}
}
