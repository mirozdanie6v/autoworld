// Recoverable optional advertising connection. AutoWorld's primary HTTP/CRM
// startup is never dependent on this connection when explicitly enabled.
// Bot /start still fails 503 on missing ads YDB, preserving webhook retry;
// client CRM writes persist a recoverable lookup_unavailable marker instead.
import {createAdsStageBBridge} from './ads-attribution-stage-b.mjs';

export function createAdsRecoverableBridge({
  open,onFailure=async()=>{},now=()=>Date.now(),
  retryDelayMs=5000,openDeadlineMs=1500
}={}){
  if(typeof open!=='function'||typeof onFailure!=='function'
    ||typeof now!=='function'
    ||!Number.isInteger(retryDelayMs)||retryDelayMs<100
    ||!Number.isInteger(openDeadlineMs)||openDeadlineMs<100)
    throw new Error('ads_recoverable_bridge_invalid');
  let active=null,opening=null,retryAfter=0,closed=false;
  const temporary=()=>new Error('ads_staging_ydb_temporarily_unavailable');
  async function getBackend(){
    if(closed)throw temporary();
    if(active)return active;
    if(!opening){
      if(now()<retryAfter)throw temporary();
      opening=Promise.resolve().then(open).then(result=>{
        if(!result?.service||!result?.repository
          ||typeof result.close!=='function')
          throw new Error('ads_recoverable_backend_invalid');
        if(closed){void result.close();throw temporary();}
        active=result;
        return result;
      }).catch(async error=>{
        retryAfter=now()+retryDelayMs;
        try{await onFailure({code:'ads_staging_connection_retry_pending'});}
        catch{/* never let failed metrics sink block the CRM */}
        throw error;
      }).finally(()=>{opening=null;});
    }
    let timer;
    try{
      return await Promise.race([
        opening,
        new Promise((_,reject)=>{
          timer=setTimeout(()=>reject(temporary()),openDeadlineMs);
          timer.unref?.();
        })
      ]);
    }finally{clearTimeout(timer);}
  }
  async function call(method,payload){
    const backend=await getBackend();
    try{
      const implementation=backend.service?.[method];
      if(typeof implementation!=='function')throw new Error('ads_method_missing');
      return await implementation(payload);
    }catch(error){
      // The YDB SDK may recover automatically, but a failed call invalidates
      // this handle; the next call reconnects after a short bounded backoff.
      active=null;
      retryAfter=now()+retryDelayMs;
      try{await backend.close();}catch{}
      throw error;
    }
  }
  const proxy=Object.fromEntries([
    'recordBotStart','getAttribution','recordTrustedEvent',
    'recordTrustedSnapshotEvent','getAttributionAtTime'
  ].map(method=>[method,payload=>call(method,payload)]));
  const bridge=createAdsStageBBridge({enabled:true,service:proxy,onFailure});
  return {...bridge,report:async()=>{
    const backend=await getBackend();
    return backend.report();
  },close:async()=>{
    closed=true;
    if(opening)try{await opening;}catch{}
    if(active){const connection=active;active=null;await connection.close();}
  }};
}
