import assert from 'node:assert/strict';
import {AnonymousCredentialsProvider} from '@ydbjs/auth/anonymous';
import {createVisitorAnalyticsStore} from '../server/awg-visitor-analytics-store.mjs';
import {validateVisitorEvents,visitorAnalyticsReport} from '../shared/awg-visitor-analytics.mjs';

const endpoint=String(process.env.AWG_ANALYTICS_LOCAL_YDB||'');
if(endpoint!=='grpc://127.0.0.1:2136/local')throw new Error('local_ydb_only_required');
const createdAt=new Date('2026-11-02T12:00:00.000Z');
const payload={
  sessionId:'synthetic_local_session_001',
  events:[
    {eventId:'local_event_car_open_001',type:'app_open'},
    {eventId:'local_event_car_open_002',type:'car_open',carId:'CAR_TEST_42'},
    {eventId:'local_event_car_open_003',type:'photo_view',carId:'CAR_TEST_42'},
    {eventId:'local_event_car_open_004',type:'request_success',carId:'CAR_TEST_42'}
  ],
  customerName:'unwanted sensitive field',
  phone:'+0000000000'
};
const checked=validateVisitorEvents(payload,{now:createdAt,provider:'telegram'});
assert.equal(checked.ok,true);
assert.equal(checked.events.every(e=>!Object.hasOwn(e,'customerName')&&!Object.hasOwn(e,'phone')),true);
let store;
for(let attempt=1;attempt<=12;attempt++){
  try{
    store=await createVisitorAnalyticsStore({connectionString:endpoint,credentialsProvider:new AnonymousCredentialsProvider()});
    break;
  }catch(error){
    if(attempt===12)throw error;
    console.log('Local synthetic YDB not ready, retry',attempt,String(error.message).slice(0,120));
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
}
try{
  assert.deepEqual(await store.writeEvents(checked.events),{written:4});
  const loaded=await store.listEvents(30);
  assert.equal(loaded.length,4);
  assert.equal(loaded.every(e=>e.sessionId===payload.sessionId),true);
  assert.equal(loaded.every(e=>Object.keys(e).sort().join(',')==='carId,eventAt,sessionId,source,type'),true);
  const report=visitorAnalyticsReport(loaded,{days:30});
  assert.equal(report.sessions,1);
  assert.equal(report.counts.app_open,1);
  assert.equal(report.counts.car_open,1);
  assert.equal(report.counts.photo_view,1);
  assert.equal(report.counts.request_success,1);
  assert.equal(report.topCars[0].carId,'CAR_TEST_42');
  assert.equal(report.topCars[0].views,1);
  console.log('PASS: synthetic events persisted and read from isolated local YDB; analytics report validated.');
}finally{await store?.close()}
