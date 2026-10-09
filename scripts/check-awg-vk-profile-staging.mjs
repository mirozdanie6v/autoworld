const root='https://vk-test.awgcars.ru';
const timeout=AbortSignal.timeout(20000);
const targets={
  profile:'/api/auto-sale/vk/web/profile',
  module:'/auto-sale-vk-web-profile.mjs',
  app:'/auto-sale-vk-web.mjs',
  config:'/api/auto-sale/vk/web/config',
  health:'/api/health'
};
const results={};
for(const [name,path] of Object.entries(targets)){
  const response=await fetch(root+path,{redirect:'manual',signal:timeout});
  const text=await response.text();
  const json=(name==='profile'||name==='config'||name==='health')?(()=>{try{return JSON.parse(text)}catch{return null}})():null;
  results[name]={status:response.status,type:response.headers.get('content-type'),cacheControl:response.headers.get('cache-control'),cors:response.headers.get('access-control-allow-origin'),allowCredentials:response.headers.get('access-control-allow-credentials'),
    ...(name==='profile'?{authenticated:json?.authenticated,error:json?.error}:{}),
    ...(name==='config'?{enabled:json?.enabled,authenticated:json?.authenticated}:{}),
    ...(name==='health'?{ok:json?.ok}:{}),
    ...(name==='module'?{hasAutofill:text.includes('applyVkWebProfileToRequestForm')}:{}),
    ...(name==='app'?{hasProfileEndpoint:text.includes('/api/auto-sale/vk/web/profile')}: {})
  };
}
const checks={
  anonProfileStatus:results.profile.status===401,
  anonProfileBody:results.profile.authenticated===false,
  noCrossOriginCredentialExposure:!(results.profile.cors==='*' && String(results.profile.allowCredentials||'').toLowerCase()==='true'),
  noProfileCache:/no-store/.test(results.profile.cacheControl||''),
  autofillModuleStatus:results.module.status===200,
  autofillModuleMime:/text\/javascript/.test(results.module.type||''),
  autofillExport:results.module.hasAutofill===true,
  appStatus:results.app.status===200,
  appCallsProfile:results.app.hasProfileEndpoint===true,
  configStatus:results.config.status===200,
  configIsEnabled:results.config.enabled===true&&results.config.authenticated===false,
  healthStatus:results.health.status===200,
  healthOk:results.health.ok===true
};
console.log('STAGING_PROFILE_PUBLIC_DIAGNOSTICS',JSON.stringify({results,checks},null,2));
const failures=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length)throw new Error('staging_autofill_smoke_failed:'+failures.join(','));
