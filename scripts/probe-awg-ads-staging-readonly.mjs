// Read-only physical staging HTTP preflight. Never submits a lead, sends a
// notification or accesses production. Actual user E2E requires later approval
// of a dedicated test bot, credentials and disposable staging fixtures.
import {pathToFileURL} from 'node:url';

export function validateAdsStagingEndpoint(raw,approvedHost){
  const safe=String(raw||'').trim(),approved=String(approvedHost||'').trim().toLowerCase();
  if(!safe||!approved)throw new Error('ads_staging_endpoint_not_configured');
  const u=new URL(safe);
  const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'
    ||u.search||u.hash||host!==approved
    ||!(host.endsWith('.awgcars.ru')||host.endsWith('.viiversion.com'))
    ||!/(^|[-.])(staging|test)([-.]|$)/.test(host)
    ||['awgcars.ru','www.awgcars.ru','autoworld.viiversion.com',
      'awg.viiversion.com'].includes(host))
    throw new Error('ads_staging_endpoint_not_allowlisted');
  return u.origin;
}
export async function probeAdsStageBHttp({
  stagingUrl,approvedHost,fetchImpl=fetch
}={}){
  const base=validateAdsStagingEndpoint(stagingUrl,approvedHost);
  const get=async path=>{
    const response=await fetchImpl(base+path,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),
      headers:{accept:'application/json','cache-control':'no-store'}
    });
    const data=await response.json().catch(()=>null);
    return {status:response.status,data};
  };
  const health=await get('/api/health');
  if(health.status!==200||health.data?.ok!==true)
    throw new Error('ads_staging_health_unavailable');
  const state=await get('/api/auto-sale/state');
  if(state.status!==200||state.data?._adsTrackingEnabled!==false
    ||state.data?._adsDirectorEnabled!==false)
    throw new Error('ads_staging_anonymous_client_exposed');
  const director=await get('/api/auto-sale/ads/director-report');
  if(director.status===404)
    return {status:'blocked_ads_stage_b_not_enabled',health:true,
      clientDataGuard:true,directorDenied:true};
  if(director.status!==403||director.data?.error!=='ads_director_required')
    throw new Error('ads_staging_director_access_invalid');
  return {status:'staging_readonly_preflight_pass',health:true,
    clientDataGuard:true,directorDenied:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  probeAdsStageBHttp({
    stagingUrl:process.env.AWG_ADS_STAGING_URL,
    approvedHost:process.env.AWG_ADS_STAGING_APPROVED_HOST
  }).then(result=>{
    console.log('AWG_ADS_PHYSICAL_READONLY_PREFLIGHT',JSON.stringify(result));
    if(result.status!=='staging_readonly_preflight_pass')process.exitCode=3;
  }).catch(error=>{
    console.error('AWG_ADS_PHYSICAL_READONLY_PREFLIGHT_BLOCKED',
      String(error?.message||'preflight_failed'));
    process.exitCode=2;
  });
}
