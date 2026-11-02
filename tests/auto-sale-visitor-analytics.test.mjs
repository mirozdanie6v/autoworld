import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVisitorEvents,visitorAnalyticsReport,VISITOR_EVENT_TYPES,isolatedVisitorYdbTarget} from '../shared/awg-visitor-analytics.mjs';

const event=(type='car_open',more={})=>({type,eventId:'evt_123456789',carId:'car_1',...more});
const payload=(events=[event()])=>({sessionId:'session_123456789',events});
const at=new Date('2026-11-02T12:00:00Z');

test('accepts only signed supported providers, uses server time and server-derived channel',()=>{
 const parsed=validateVisitorEvents(payload(),{now:at,provider:'telegram'});
 assert.equal(parsed.ok,true);
 assert.deepEqual(parsed.events[0],{
  eventId:'evt_123456789',sessionId:'session_123456789',
  eventDay:'2026-11-02',eventAt:'2026-11-02T12:00:00.000Z',
  type:'car_open',carId:'car_1',source:'telegram'
 });
 assert.equal(validateVisitorEvents(payload(),{provider:'public'}).ok,false);
 assert.equal(validateVisitorEvents(payload(),{provider:'vk-web'}).events[0].source,'vk');
});
test('does not forward unrecognized PII or fake ad/source fields',()=>{
 const parsed=validateVisitorEvents({...payload(),contact:'+7 999 000 0000',source:'telegram_ads',events:[{...event(),phone:'999',userId:'123',source:'paid',query:'VIN ABC'}]},{provider:'vk'});
 assert.equal(parsed.ok,true);
 assert.equal(JSON.stringify(parsed.events).includes('999'),false);
 assert.equal(JSON.stringify(parsed.events).includes('VIN'),false);
 assert.equal(parsed.events[0].source,'vk');
});
test('rejects arbitrary event kinds, bad IDs, duplicates and excessive batches',()=>{
 assert.equal(validateVisitorEvents(payload([event('keystroke')]),{provider:'telegram'}).error,'invalid_event_type');
 assert.equal(validateVisitorEvents(payload([event('car_open',{carId:'<script>'})]),{provider:'telegram'}).error,'invalid_car_id');
 assert.equal(validateVisitorEvents(payload([event(),event()]),{provider:'telegram'}).error,'duplicate_event_id');
 assert.equal(validateVisitorEvents(payload(Array(21).fill(event())),{provider:'telegram'}).error,'invalid_event_batch');
 assert.equal(validateVisitorEvents({sessionId:'x',events:[event()]},{provider:'telegram'}).error,'invalid_session');
 assert.equal(VISITOR_EVENT_TYPES.has('payment'),false);
});
test('aggregates visits, funnel, car views and anonymous timeline without identifying visitors',()=>{
 const base={sessionId:'session_123456789',eventAt:'2026-11-02T12:00:00.000Z',source:'telegram'};
 const rows=[
  {...base,type:'app_open'}, {...base,type:'car_open',carId:'car_1'},
  {...base,type:'car_open',carId:'car_1'}, {...base,type:'photo_view',carId:'car_1'},
  {...base,type:'request_success',carId:'car_1'},
  {...base,sessionId:'session_987654321',type:'app_open',source:'vk'},
 ];
 const report=visitorAnalyticsReport(rows,{days:7});
 assert.equal(report.sessions,2);
 assert.equal(report.counts.car_open,2);
 assert.equal(report.counts.request_success,1);
 assert.deepEqual(report.topCars[0],{carId:'car_1',views:2});
 assert.equal(report.sources.length,2);
 assert.equal(report.recentSessions[0].sessionId.length,8);
 assert.equal(report.recentSessions[0].events.some(e=>e.type==='request_success'),true);
});

test('analytics connection must be a different staging YDB database, not an alias to business YDB',()=>{
 const main='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/folder/business';
 const same='grpcs://ydb.serverless.yandexcloud.net:2135/?database=%2Fru-central1%2Ffolder%2Fbusiness';
 const separate='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/folder/visitor';
 assert.equal(isolatedVisitorYdbTarget(main,main),false);
 assert.equal(isolatedVisitorYdbTarget(main,same),false);
 assert.equal(isolatedVisitorYdbTarget(main,separate),true);
 assert.equal(isolatedVisitorYdbTarget(main,'grpcs://other.example:2135/?database=/ru-central1/folder/visitor'),false);
 assert.equal(isolatedVisitorYdbTarget(main,''),false);
});
