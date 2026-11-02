// Isolated, non-PII event contract for AWG visitor telemetry.
export const VISITOR_EVENT_TYPES=new Set([
  'app_open','catalog_open','car_open','photo_view','filter_change',
  'request_open','request_attempt','request_success','request_failure'
]);
const ID=/^[a-zA-Z0-9_-]{8,80}$/;
const CAR=/^[a-zA-Z0-9_:-]{1,100}$/;
export function validateVisitorEvents(payload,{now=new Date(),provider=''}={}){
  if(!payload||!Array.isArray(payload.events)||!payload.events.length||payload.events.length>20)
    return{ok:false,error:'invalid_event_batch'};
  if(!['telegram','vk','vk-web'].includes(provider))return{ok:false,error:'unsupported_identity'};
  const sessionId=String(payload.sessionId||'');
  if(!ID.test(sessionId))return{ok:false,error:'invalid_session'};
  const at=now.toISOString(),day=at.slice(0,10);
  const events=[];
  for(const item of payload.events){
    if(!item||!VISITOR_EVENT_TYPES.has(item.type))return{ok:false,error:'invalid_event_type'};
    const eventId=String(item.eventId||'');
    if(!ID.test(eventId))return{ok:false,error:'invalid_event_id'};
    const carId=item.carId==null?'':String(item.carId);
    if(carId&&!CAR.test(carId))return{ok:false,error:'invalid_car_id'};
    events.push({eventId,sessionId,eventDay:day,eventAt:at,type:item.type,carId,source:provider==='telegram'?'telegram':'vk'});
  }
  if(new Set(events.map(e=>e.eventId)).size!==events.length)return{ok:false,error:'duplicate_event_id'};
  return{ok:true,events};
}
export function visitorAnalyticsReport(rows=[],{days=7}={}){
  const counts=Object.fromEntries([...VISITOR_EVENT_TYPES].map(type=>[type,0]));
  const sessions=new Set(),carViews=new Map(),sources=new Map(),paths=new Map();
  for(const row of rows){
    const type=String(row.type||row.event_type||'');
    if(!VISITOR_EVENT_TYPES.has(type))continue;
    counts[type]++;
    const session=String(row.sessionId||row.session_id||'');
    const carId=String(row.carId||row.car_id||'');
    const source=String(row.source||'unknown');
    if(session){sessions.add(session);if(!paths.has(session))paths.set(session,[]);paths.get(session).push({type,at:String(row.eventAt||row.event_at||''),carId});}
    if(type==='car_open'&&carId)carViews.set(carId,(carViews.get(carId)||0)+1);
    if(type==='app_open')sources.set(source,(sources.get(source)||0)+1);
  }
  const pathsOutput=[...paths.entries()].map(([sessionId,events])=>({sessionId:sessionId.slice(0,8),events:events.sort((a,b)=>a.at.localeCompare(b.at)).slice(-30)}))
    .sort((a,b)=>String(b.events.at(-1)?.at||'').localeCompare(String(a.events.at(-1)?.at||''))).slice(0,20);
  return {days,sessions:sessions.size,counts,topCars:[...carViews.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([carId,views])=>({carId,views})),sources:[...sources.entries()].map(([source,opens])=>({source,opens})),recentSessions:pathsOutput,limited:rows.length>=10000};
}
