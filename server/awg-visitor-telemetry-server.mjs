// Isolated telemetry-only runtime. No business YDB, leads, orders or catalog access.
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createTelegramService} from './telegram-bot.mjs';
import {createVkService} from './vk.mjs';
import {createVisitorAnalyticsStore} from './awg-visitor-analytics-store.mjs';
import {validateVisitorEvents,visitorAnalyticsReport} from '../shared/awg-visitor-analytics.mjs';

const truthy=value=>/^(1|true|yes)$/i.test(String(value||''));
const numeric=value=>/^\d+$/.test(String(value||''))?String(value):'';
const TELEMETRY_PATH='/ru-central1/b1ggsmuiq7tb2d27f89q/etnbvdb8fdv4qea3c5ap';
const MAX_EVENT_BYTES=48_000;

export function validVisitorTelemetryTarget(connection){
  try {
    const u=new URL(String(connection||''));
    if(u.protocol!=='grpcs:' || u.hostname!=='ydb.serverless.yandexcloud.net' || u.port!=='2135')return false;
    if(u.username||u.password||u.hash)return false;
    return decodeURIComponent(u.searchParams.get('database')||'').replace(/\/+$/,'')===TELEMETRY_PATH;
  } catch {return false}
}
const originsFromEnv=value=>String(value||'').split(',').map(s=>s.trim()).filter(Boolean).filter(s=>{
  try {const u=new URL(s);return u.protocol==='https:'&&u.origin===s}catch{return false}
});
const deny=(res,status,error)=>send(res,status,{error});
function send(res,status,data,extra={}){
  const body=JSON.stringify(data);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(body),...extra});
  res.end(body);
}
async function readPayload(req,max=MAX_EVENT_BYTES){
  const chunks=[];let count=0;
  for await(const chunk of req){
    count+=chunk.length;
    if(count>max)throw Object.assign(new Error('payload_too_large'),{statusCode:413});
    chunks.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
  catch {throw Object.assign(new Error('invalid_json'),{statusCode:400})}
}

export function createVisitorTelemetryServer({
  enabled=truthy(process.env.AWG_VISITOR_ANALYTICS_ENABLED),
  connectionString=process.env.AWG_VISITOR_YDB_CONNECTION_STRING,
  allowedOrigins=originsFromEnv(process.env.AWG_VISITOR_ALLOWED_ORIGINS),
  adminTelegramIds=String(process.env.AWG_VISITOR_ADMIN_TELEGRAM_IDS||'').split(',').map(numeric).filter(Boolean),
  adminVkIds=String(process.env.AWG_VISITOR_ADMIN_VK_IDS||'').split(',').map(numeric).filter(Boolean),
  telegramValidator=null,
  vkValidator=null,
  storeFactory=createVisitorAnalyticsStore
}={}){
  if(enabled&&!validVisitorTelemetryTarget(connectionString))throw new Error('visitor_analytics_isolated_target_required');
  const tgValidate=telegramValidator||createTelegramService().validateInitData;
  const vkValidate=vkValidator||createVkService().validateLaunchParams;
  const originSet=new Set(allowedOrigins);
  const tgAdmins=new Set(adminTelegramIds),vkAdmins=new Set(adminVkIds);
  const windows=new Map();let storePromise=null;
  const getStore=()=>{
    if(!enabled)throw Object.assign(new Error('visitor_analytics_disabled'),{statusCode:503});
    if(!storePromise)storePromise=storeFactory({connectionString}).catch(error=>{storePromise=null;throw error});
    return storePromise;
  };
  const identify=req=>{
    const tg=String(req.headers['x-telegram-init-data']||'').trim();
    const vk=String(req.headers['x-vk-launch-params']||'').trim();
    if(Boolean(tg)===Boolean(vk))return null;
    const auth=tg?tgValidate(tg):vkValidate(vk);
    if(!auth?.ok)return null;
    const id=numeric(auth.user?.id);
    if(!id)return null;
    return{provider:tg?'telegram':'vk',id,key:(tg?'telegram:':'vk:')+id};
  };
  const limit=(key,count)=>{
    const now=Date.now(),current=windows.get(key);
    if(windows.size>5000)for(const [k,item] of windows)if(now-item.start>60000)windows.delete(k);
    const item=!current||now-current.start>60000?{start:now,count:0}:current;
    if(item.count+count>120)return false;
    item.count+=count;windows.set(key,item);return true;
  };
  return http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url||'/', 'http://127.0.0.1');
      const origin=String(req.headers.origin||'');
      if(origin){
        if(!originSet.has(origin)){deny(res,403,'origin_not_allowed');return}
        res.setHeader('Access-Control-Allow-Origin',origin);
        res.setHeader('Vary','Origin');
      }
      if(req.method==='OPTIONS'){
        if(!origin){deny(res,403,'origin_required');return}
        res.writeHead(204,{
          'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':'Content-Type, X-Telegram-Init-Data, X-VK-Launch-Params',
          'Access-Control-Max-Age':'60'
        });res.end();return;
      }
      if(url.pathname==='/health'&&req.method==='GET'){
        send(res,200,{ok:true,enabled});return;
      }
      if(url.pathname==='/api/auto-sale/visitor-analytics/config'&&req.method==='GET'){
        send(res,200,{enabled,retentionDays:30,identification:'session-only'});return;
      }
      if(!url.pathname.startsWith('/api/auto-sale/visitor-analytics/')){deny(res,404,'not_found');return}
      if(!enabled){deny(res,503,'visitor_analytics_disabled');return}
      const access=identify(req);
      if(!access){deny(res,403,'signed_identity_required');return}
      if(url.pathname==='/api/auto-sale/visitor-analytics/events'&&req.method==='POST'){
        if((access.provider==='telegram'?tgAdmins:vkAdmins).has(access.id)){
          deny(res,403,'client_only');return;
        }
        const data=await readPayload(req);
        const result=validateVisitorEvents(data,{provider:access.provider});
        if(!result.ok){deny(res,400,result.error);return}
        if(!limit(access.key,result.events.length)){deny(res,429,'rate_limited');return}
        const written=await (await getStore()).writeEvents(result.events);
        send(res,202,{ok:true,...written});return;
      }
      if(url.pathname==='/api/auto-sale/visitor-analytics/report'&&req.method==='GET'){
        if(!(access.provider==='telegram'?tgAdmins:vkAdmins).has(access.id)){
          deny(res,403,'admin_required');return;
        }
        const days=Number(url.searchParams.get('days')||7);
        if(![7,30].includes(days)){deny(res,400,'invalid_period');return}
        const rows=await(await getStore()).listEvents(days);
        send(res,200,{ok:true,...visitorAnalyticsReport(rows,{days})});return;
      }
      deny(res,404,'not_found');
    }catch(error){
      if(error?.statusCode===413||error?.statusCode===400){deny(res,error.statusCode,error.message);return}
      // Do not log bodies, signed launch params, tokens or IDs.
      console.error('AWG visitor telemetry operation failed',String(error?.name||'Error'));
      deny(res,503,'visitor_analytics_unavailable');
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createVisitorTelemetryServer();
  server.listen(Number(process.env.PORT||8080),'0.0.0.0');
}
