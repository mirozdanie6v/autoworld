import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const flag=value=>/^(1|true|yes)$/i.test(String(value||''));
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const from64=value=>JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
const encode=value=>encodeURIComponent(value);
const COOKIE_TX='awg_vkid_tx';
const COOKIE_SESSION='awg_vkid_session';
const cookies=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(part=>part.trim().split(/=(.*)/s).slice(0,2)).filter(([key])=>key));
const setCookie=(res,name,value,maxAge)=>res.setHeader('set-cookie',[...(res.getHeader('set-cookie')||[]),name+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge]);
const digest=(key,text)=>createHmac('sha256',key).update(text).digest('base64url');

export function createVkWebAuth({
 enabled=process.env.AUTO_SALE_VK_WEB_ENABLED,
 clientId=process.env.AUTO_SALE_VK_WEB_CLIENT_ID,
 cookieKey=process.env.AUTO_SALE_VK_WEB_COOKIE_KEY,
 origin=process.env.AUTO_SALE_VK_WEB_ORIGIN||'https://awgcars.ru',
 fetchImpl=globalThis.fetch,
 now=()=>Date.now()
}={}){
 const active=flag(enabled)&&/^\d+$/.test(String(clientId||''))&&String(cookieKey||'').length>=32;
 const site=new URL(origin);
 if(site.protocol!=='https:'||site.pathname!=='/'||site.search||site.hash)throw new Error('vk_web_origin_invalid');
 const redirect=site.origin+'/api/auto-sale/vk/web/callback';
 const issue=(payload)=>{const raw=b64(payload);return raw+'.'+digest(cookieKey,raw)};
 const decode=value=>{
   if(!active||!value||value.length>3000)return null;
   const [raw,sig,...more]=value.split('.');
   if(more.length||!raw||!sig)return null;
   const expected=digest(cookieKey,raw);
   const a=Buffer.from(sig),b=Buffer.from(expected);
   if(a.length!==b.length||!timingSafeEqual(a,b))return null;
   try{return from64(raw)}catch{return null}
 };
 const clear=(res,name)=>setCookie(res,name,'',0);
 function auth(req){
   if(!active)return null;
   const item=decode(cookies(req)[COOKIE_SESSION]);
   if(!item||item.type!=='session'||item.exp<now()||!/^\d+$/.test(String(item.id)))return null;
   return {user:{id:String(item.id),provider:'vk',first_name:item.firstName||'',last_name:item.lastName||''},
     identity:{provider:'vk',id:String(item.id),key:'vk:'+item.id}};
 }
 function start(req,res){
   if(!active)return {status:503,error:'vk_web_not_configured'};
   const state=randomBytes(24).toString('base64url');
   const verifier=randomBytes(48).toString('base64url');
   const challenge=createHash('sha256').update(verifier).digest('base64url');
   setCookie(res,COOKIE_TX,issue({type:'transaction',state,verifier,exp:now()+600000}),600);
   const q=new URLSearchParams({client_id:String(clientId),response_type:'code',redirect_uri:redirect,
     state,code_challenge:challenge,code_challenge_method:'S256',scope:''});
   return {status:302,location:'https://id.vk.ru/authorize?'+q.toString()};
 }
 async function complete(req,res,url){
   if(!active)return {status:503,error:'vk_web_not_configured'};
   const tx=decode(cookies(req)[COOKIE_TX]);
   clear(res,COOKIE_TX);
   const payload=url.searchParams.has('payload')?(()=>{try{return JSON.parse(url.searchParams.get('payload'))}catch{return {}}})():Object.fromEntries(url.searchParams);
   if(!tx||tx.type!=='transaction'||tx.exp<now()||!payload.state||payload.state!==tx.state)return {status:400,error:'vk_web_state_invalid'};
   if(payload.error)return {status:400,error:'vk_web_login_denied'};
   if(!payload.code||!payload.device_id)return {status:400,error:'vk_web_code_required'};
   const params=new URLSearchParams({grant_type:'authorization_code',client_id:String(clientId),
     redirect_uri:redirect,code_verifier:tx.verifier,device_id:String(payload.device_id),state:tx.state});
   const response=await fetchImpl('https://id.vk.ru/oauth2/auth?'+params.toString(),{
     method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
     body:new URLSearchParams({code:String(payload.code)}),signal:AbortSignal.timeout(8000)});
   const tokens=await response.json();
   if(!response.ok||tokens.error||!tokens.access_token||tokens.state!==tx.state)return {status:401,error:'vk_web_token_invalid'};
   const infoResponse=await fetchImpl('https://id.vk.ru/oauth2/user_info?client_id='+encode(String(clientId)),{
     method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
     body:new URLSearchParams({access_token:tokens.access_token}),signal:AbortSignal.timeout(8000)});
   const info=await infoResponse.json();
   const user=info.user||info;
   const id=String(user.user_id||user.id||'');
   if(!infoResponse.ok||info.error||!/^\d+$/.test(id))return {status:401,error:'vk_web_user_invalid'};
   setCookie(res,COOKIE_SESSION,issue({type:'session',id,firstName:String(user.first_name||'').slice(0,80),
     lastName:String(user.last_name||'').slice(0,80),exp:now()+86400000}),86400);
   return {status:302,location:site.origin+'/?vk_login=success'};
 }
 function logout(res){clear(res,COOKIE_SESSION)}
 function isTrustedWrite(req){
   const o=String(req.headers.origin||'');
   return o===site.origin;
 }
 return {enabled:active,auth,start,complete,logout,isTrustedWrite,redirect};
}
