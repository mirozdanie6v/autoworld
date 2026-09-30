import type { AutoSaleEnv,AnyRecord } from './auto-sale/types.js';
import { loadState } from './auto-sale/storage.js';
import { syncState } from './auto-sale/state-api.js';

const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-auto-sale-key','access-control-allow-methods':'GET,PUT,OPTIONS'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const allowed=(request:Request,env:AutoSaleEnv)=>env.AUTO_SALE_DEMO_MODE==='1'||Boolean(env.AUTO_SALE_API_KEY&&request.headers.get('x-auto-sale-key')===env.AUTO_SALE_API_KEY);
async function parse(request:Request):Promise<AnyRecord|null>{try{return await request.json() as AnyRecord}catch{return null}}

export default{async fetch(request:Request,env:AutoSaleEnv):Promise<Response>{
  const url=new URL(request.url);
  if(request.method==='OPTIONS'&&url.pathname.startsWith('/api/'))return new Response(null,{status:204,headers});
  if(url.pathname==='/api/health')return json({ok:true,service:'auto-sale-usa',productMode:env.PRODUCT_MODE||'auto-sale-usa',d1:Boolean(env.DB),schemaVersion:10,demoMode:env.AUTO_SALE_DEMO_MODE==='1',demoCardsPersistent:false,teamManagement:true});
  if(url.pathname==='/api/auto-sale/state'&&request.method==='GET'){
    if(!env.DB)return json({error:'persistence_not_configured'},503);
    return json(await loadState(env.DB));
  }
  if(url.pathname==='/api/auto-sale/state'&&request.method==='PUT'){
    if(!env.DB)return json({error:'persistence_not_configured'},503);
    if(!allowed(request,env))return json({error:'unauthorized'},401);
    const input=await parse(request);if(!input)return json({error:'invalid_json'},400);
    const result=await syncState(env.DB,input);return json(result.data,result.status);
  }
  if(url.pathname.startsWith('/api/'))return json({error:'not_found'},404);
  return env.ASSETS.fetch(request);
}};
