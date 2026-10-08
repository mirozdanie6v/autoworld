import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const resourceId = 'bc8rp2vwj26zt3hg2ewz';
const {stdout} = await exec('yc', ['cdn','resource','get',resourceId,'--format','json'], {timeout: 45000});
const resource = JSON.parse(stdout);
console.log(JSON.stringify({cdnCurrent: {id: resource.id, cname: resource.cname, providerCname: resource.provider_cname, certificate: resource.ssl_certificate, originGroupId: resource.origin_group_id}}));
let sequence = 0;
async function request(url, extra = []) {
  const file = path.join(process.env.RUNNER_TEMP, 'awg-cdn-inspect-' + sequence++);
  const args = ['-4','-sS','--connect-timeout','8','--max-time','20',...extra,
    '-D',file+'.headers','-o',file+'.body','-w','%{http_code} %{time_starttransfer} %{time_connect} %{time_appconnect}',url];
  let result;
  try { result = (await exec('curl', args, {timeout: 25000})).stdout; }
  catch (error) { return {status: 0, error: String(error.stderr), body: '', headers: new Map()}; }
  const [status,ttfb,tcp,tls] = result.trim().split(/\s+/).map(Number);
  const headers = new Map((await readFile(file+'.headers','utf8')).split(/\r?\n/).filter(line=>line.indexOf(':')>0).map(line=>[line.slice(0,line.indexOf(':')).toLowerCase(),line.slice(line.indexOf(':')+1).trim()]));
  return {status,ttfbMs:Math.round(ttfb*1000),tcpMs:Math.round(tcp*1000),tlsMs:Math.round(tls*1000),headers,body:await readFile(file+'.body','utf8')};
}
const rules = await request('https://cdn.api.cloud.yandex.net/cdn/v1/rules?resourceId='+resourceId,
  ['-H','Authorization: Bearer '+process.env.YC_IAM_TOKEN]);
if (rules.status === 200) console.log(JSON.stringify({cdnRules: JSON.parse(rules.body).rules.map(x=>({id:x.id,name:x.name,pattern:x.rulePattern,originGroupId:x.originsGroupId,options:x.options}))}));
else console.log(JSON.stringify({cdnRulesStatus:rules.status,error:rules.error}));
const target = resource.provider_cname;
if (!target || !/^[a-f0-9]+\.topology\.gslb\.yccdn\.ru$/.test(target)) throw new Error('Unexpected CDN target');
await Promise.all(['/', '/releases/e98fa766421f9fe97211d6aa3a8795114a38bf73/index.html','/api/health','/api/auto-sale/vk/config','/api/auto-sale/nonexistent-cdn-probe'].map(async route=>{
  const response = await request('https://awgcars.ru'+route, ['--connect-to','awgcars.ru:443:'+target+':443']);
  let json;
  try { json = JSON.parse(response.body); } catch {}
  console.log(JSON.stringify({cdnRoute:route,status:response.status,ttfbMs:response.ttfbMs,tcpMs:response.tcpMs,tlsMs:response.tlsMs,contentType:response.headers.get('content-type'),cacheControl:response.headers.get('cache-control'),candidateHtml:response.body.includes('auto-sale-static-release'),backend:json?.buildSha ? {buildSha:json.buildSha,vkAuth:json.vkAuth,vkMessaging:json.vkMessaging}:undefined,apiError:json?.error,error:response.error}));
}));
