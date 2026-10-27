import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAdsStagingEndpoint,probeAdsStageBHttp
} from '../scripts/probe-awg-ads-staging-readonly.mjs';

test('staging HTTP target enforces explicit allowlist and rejects live AWG',()=>{
  assert.equal(validateAdsStagingEndpoint('https://ads-staging.awgcars.ru/','ads-staging.awgcars.ru'),
    'https://ads-staging.awgcars.ru');
  for(const url of [
    'https://awgcars.ru/','https://autoworld.viiversion.com/',
    'https://ads-staging.awgcars.ru:8443/','http://ads-staging.awgcars.ru/',
    'https://ads-staging.awgcars.ru@awgcars.ru/',
    'https://ads-staging.awgcars.ru/hidden',
    'https://ads-staging.awgcars.ru/?redirect=https://awgcars.ru'
  ])assert.throws(()=>validateAdsStagingEndpoint(url,'ads-staging.awgcars.ru'),/not_allowlisted/);
  assert.throws(()=>validateAdsStagingEndpoint('https://ads-staging.awgcars.ru/',''),/not_configured/);
});
test('anonymous production-secret-free HTTP preflight verifies staging status and director denial',async()=>{
  const requests=[];
  const probe=async(url,options)=>{
    requests.push({url,options});
    if(url.endsWith('/api/health'))return{status:200,json:async()=>({ok:true})};
    if(url.endsWith('/api/auto-sale/state'))return{status:200,json:async()=>({
      _adsTrackingEnabled:false,_adsDirectorEnabled:false
    })};
    if(url.endsWith('/api/auto-sale/ads/director-report'))return{
      status:403,json:async()=>({error:'ads_director_required'})};
    throw Error('unexpected URL');
  };
  const result=await probeAdsStageBHttp({
    stagingUrl:'https://ads-staging.awgcars.ru/',approvedHost:'ads-staging.awgcars.ru',
    fetchImpl:probe
  });
  assert.equal(result.status,'staging_readonly_preflight_pass');
  assert.equal(requests.length,3);
  assert.ok(requests.every(x=>x.options.method==='GET'&&x.options.redirect==='error'));
});
test('disabled Stage B and leaking anonymous analytics controls cannot pass',async()=>{
  const base='https://ads-staging.awgcars.ru/';
  const testCase=(tracking,reportStatus)=>probeAdsStageBHttp({
    stagingUrl:base,approvedHost:'ads-staging.awgcars.ru',
    fetchImpl:async url=>{
      if(url.endsWith('/api/health'))return{status:200,json:async()=>({ok:true})};
      if(url.endsWith('/api/auto-sale/state'))return{status:200,json:async()=>({
        _adsTrackingEnabled:tracking,_adsDirectorEnabled:false
      })};
      return{status:reportStatus,json:async()=>({error:'ads_director_required'})};
    }
  });
  assert.equal((await testCase(false,404)).status,'blocked_ads_stage_b_not_enabled');
  await assert.rejects(testCase(true,403),/anonymous_client_exposed/);
  await assert.rejects(testCase(false,200),/director_access_invalid/);
});
