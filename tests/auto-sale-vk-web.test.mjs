import test from 'node:test';
import assert from 'node:assert/strict';
import {createVkWebAuth} from '../server/vk-web-auth.mjs';

const key='this-is-an-isolated-test-cookie-signing-key-123456';
const base={enabled:true,clientId:'12345',cookieKey:key,origin:'https://awgcars.ru',now:()=>2_000_000_000_000};
const request=(cookie='',origin='https://awgcars.ru')=>({headers:{cookie,origin}});
function response(){
 const headers={};
 return {getHeader:name=>headers[name],setHeader:(name,value)=>{headers[name]=value},headers};
}
function cookieFrom(res,name){
 return res.headers['set-cookie'].find(x=>x.startsWith(name+'=')).split(';')[0];
}
test('browser VK OAuth is disabled without explicit flag and secret',()=>{
 const auth=createVkWebAuth({enabled:false,clientId:'12345',cookieKey:key});
 assert.equal(auth.start(request(),response()).status,503);
 assert.equal(auth.auth(request()),null);
});
test('PKCE challenge, state, signed session and provider scope',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('/oauth2/auth'))return {ok:true,json:async()=>({state:tokenState,access_token:'trusted-token'})};
  return {ok:true,json:async()=>({user:{user_id:42,first_name:'Иван'}})};
 };
 const auth=createVkWebAuth({...base,fetchImpl});
 const res=response();
 const started=auth.start(request(),res);
 assert.equal(started.status,302);
 const authorization=new URL(started.location);
 assert.equal(authorization.host,'id.vk.ru');
 assert.equal(authorization.searchParams.get('code_challenge_method'),'s256');
 const tokenState=authorization.searchParams.get('state');
 assert.ok(tokenState);
 const transaction=cookieFrom(res,'awg_vkid_tx');
 const done=response();
 const callback=new URL('https://awgcars.ru/api/auto-sale/vk/web/callback?code=test-code&device_id=dev-1&state='+tokenState);
 const completed=await auth.complete(request(transaction),done,callback);
 assert.equal(completed.status,302);
 assert.ok(calls[0].url.includes('/oauth2/auth?'));
 assert.equal(new URLSearchParams(calls[0].opts.body).get('code'),'test-code');
 const session=cookieFrom(done,'awg_vkid_session');
 assert.deepEqual(auth.auth(request(session)).identity,{provider:'vk',id:'42',key:'vk:42'});
 assert.equal(auth.auth(request(session.replace(/.$/,'x'))),null);
 assert.equal(auth.isTrustedWrite(request(session,'https://evil.example')),false);
 assert.equal(auth.isTrustedWrite(request(session)),true);
 const denied=await auth.complete(request(transaction),response(),new URL('https://awgcars.ru/api/auto-sale/vk/web/callback?code=a&state=wrong&device_id=dev-1'));
 assert.equal(denied.error,'vk_web_state_invalid');
 const out=response();auth.logout(out);
 assert.match(out.headers['set-cookie'].join(' '),/awg_vkid_session=;.*Max-Age=0/);
});
