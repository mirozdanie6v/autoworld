import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisitorTelemetryServer,validVisitorTelemetryTarget} from '../server/awg-visitor-telemetry-server.mjs';

const GOOD='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnbvdb8fdv4qea3c5ap';
const SITE='https://vk-test.awgcars.ru';
async function withServer(server,handler){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{return await handler('http://127.0.0.1:'+server.address().port)}
  finally{await new Promise(resolve=>server.close(resolve))}
}
function makeServer(extra={}){
 const rows=[];
 const store={
   writeEvents:async events=>{rows.push(...events);return{written:events.length}},
   listEvents:async()=>rows
 };
 const server=createVisitorTelemetryServer({
  enabled:true,connectionString:GOOD,allowedOrigins:[SITE],
  adminTelegramIds:['999'],adminVkIds:['888'],
  telegramValidator:()=>({ok:true,user:{id:'111'}}),
  vkValidator:()=>({ok:true,user:{id:'222'}}),
  storeFactory:async()=>store,...extra
 });
 return{server,rows};
}
async function req(url,{method='GET',body,headers={}}={}){
 const response=await fetch(url,{method,body:body?JSON.stringify(body):undefined,headers});
 const data=response.status===204?null:await response.json();
 return{status:response.status,body:data,headers:response.headers};
}
const events={sessionId:'session_valid_1',events:[{eventId:'event_valid_001',type:'car_open',carId:'CAR_42'}]};
test('strict YDB destination is exactly the dedicated staging telemetry DB',()=>{
 assert.equal(validVisitorTelemetryTarget(GOOD),true);
 assert.equal(validVisitorTelemetryTarget('grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnhujtu1t6f89tdtohs'),false);
 assert.equal(validVisitorTelemetryTarget('grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnbvdb8fdv4qea3c5ap2'),false);
 assert.equal(validVisitorTelemetryTarget('grpc://127.0.0.1:2136/local'),false);
 assert.throws(()=>createVisitorTelemetryServer({enabled:true,connectionString:'grpcs://bad.example'}),/isolated_target_required/);
});
test('staging runtime is disabled by default and never reaches YDB',async()=>{
 let calls=0;
 const srv=createVisitorTelemetryServer({enabled:false,storeFactory:async()=>{calls++;throw Error('should not run')}});
 await withServer(srv,async base=>{
   assert.equal((await req(base+'/health')).status,200);
   assert.deepEqual((await req(base+'/api/auto-sale/visitor-analytics/config')).body.enabled,false);
   const denied=await req(base+'/api/auto-sale/visitor-analytics/events',{method:'POST',headers:{'x-telegram-init-data':'dummy'},body:events});
   assert.equal(denied.status,503);
   assert.equal(calls,0);
 });
});
test('signed Telegram event writes only whitelisted fields; admin is read-only',async()=>{
 const {server,rows}=makeServer({telegramValidator:raw=>({ok:['VALID','ADMIN'].includes(raw),user:{id:raw==='ADMIN'?'999':'111'}})});
 await withServer(server,async base=>{
   const root=base+'/api/auto-sale/visitor-analytics/';
   const noAuth=await req(root+'events',{method:'POST',body:events});
   assert.equal(noAuth.status,403);
   const both=await req(root+'events',{method:'POST',body:events,headers:{'x-telegram-init-data':'VALID','x-vk-launch-params':'signed'}});
   assert.equal(both.status,403);
   const invalid=await req(root+'events',{method:'POST',body:events,headers:{'x-telegram-init-data':'bad'}});
   assert.equal(invalid.status,403);
   const insert=await req(root+'events',{method:'POST',body:{...events,phone:'secret phone',contact:'secret contact'},headers:{'x-telegram-init-data':'VALID'}});
   assert.equal(insert.status,202);
   assert.equal(insert.body.written,1);
   assert.equal(rows.length,1);
   assert.equal(Object.hasOwn(rows[0],'phone'),false);
   assert.equal(Object.hasOwn(rows[0],'contact'),false);
   const noReport=await req(root+'report?days=7',{headers:{'x-telegram-init-data':'VALID'}});
   assert.equal(noReport.status,403);
   const admin=await req(root+'report?days=7',{headers:{'x-telegram-init-data':'ADMIN'}});
   assert.equal(admin.status,200);
   assert.equal(admin.body.counts.car_open,1);
   const noAdminEvents=await req(root+'events',{method:'POST',body:events,headers:{'x-telegram-init-data':'ADMIN'}});
   assert.equal(noAdminEvents.status,403);
 });
});
test('signed VK events, CORS allowlist, malformed body and unknown events enforced',async()=>{
 const {server,rows}=makeServer();
 await withServer(server,async base=>{
   const path=base+'/api/auto-sale/visitor-analytics/events';
   assert.equal((await req(path,{method:'POST',headers:{origin:'https://evil.example','x-vk-launch-params':'signed'},body:events})).status,403);
   const valid=await req(path,{method:'POST',headers:{origin:SITE,'x-vk-launch-params':'signed'},body:events});
   assert.equal(valid.status,202);
   assert.equal(valid.headers.get('access-control-allow-origin'),SITE);
   assert.equal(rows[0].source,'vk');
   const bad=await req(path,{method:'POST',headers:{'x-vk-launch-params':'signed'},body:{sessionId:'session_valid_1',events:[{eventId:'event_valid_002',type:'user_email',email:'pii'}]}});
   assert.equal(bad.status,400);
   const tooLarge={...events,noise:'x'.repeat(49000)};
   assert.equal((await req(path,{method:'POST',headers:{'x-vk-launch-params':'signed'},body:tooLarge})).status,413);
   assert.equal(rows.length,1);
 });
});
