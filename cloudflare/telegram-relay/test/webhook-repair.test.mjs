import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker from '../src/index.js';

const token='123456:testtoken';
const relaySecret='relay-secret-test';
const key=createHmac('sha256',token).update('auto-sale-telegram-webhook-v2').digest('hex').slice(0,32);
const oldUrl='https://d5dbgio6limv03usvipl.s183zexc.apigw.yandexcloud.net/api/auto-sale/telegram/webhook/'+key;
const target='https://integration-telegram.viiversion.com/telegram/webhook';
const upstream='https://awgcars.ru/api/auto-sale/telegram/webhook/'+key;
const env={TELEGRAM_BOT_TOKEN:token,AUTOWORLD_RELAY_SECRET:relaySecret,AUTOWORLD_YANDEX_WEBHOOK_URL:upstream};
const body='{"action":"restore_cloudflare_ingress"}';
function request(ts=Date.now(),secret=relaySecret,payload=body){
  const signature=createHmac('sha256',secret).update(String(ts)+'.'+payload).digest('hex');
  return new Request('https://integration-telegram.viiversion.com/telegram/admin/repair-webhook',{
    method:'POST',
    headers:{'x-relay-timestamp':String(ts),'x-relay-signature':signature},
    body:payload
  });
}
test('rejects unsigned, forged and stale Cloudflare webhook repair commands',async()=>{
  const bad=[
    new Request('https://integration-telegram.viiversion.com/telegram/admin/repair-webhook',{method:'POST',body}),
    request(Date.now(),'wrong-secret'),
    request(Date.now()-120000)
  ];
  for(const req of bad){
    const r=await worker.fetch(req,env);
    assert.equal(r.status,401);
  }
});
test('rejects arbitrary actions without touching Telegram',async()=>{
  const r=await worker.fetch(request(Date.now(),relaySecret,'{"action":"deleteWebhook"}'),env);
  assert.equal(r.status,400);
});
test('preflights signed upstream before atomically switching only the allowlisted bot webhook',async()=>{
  const previous=globalThis.fetch;
  const calls=[];
  let switched=false;
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url);
    calls.push({url:u,body:opts.body?JSON.parse(opts.body):null});
    if(u.endsWith('/getMe'))return Response.json({ok:true,result:{username:'AutoWorld_Georgia_bot'}});
    if(u.endsWith('/getWebhookInfo'))return Response.json({ok:true,result:{
      url:switched?target:oldUrl,pending_update_count:2,allowed_updates:['message']
    }});
    if(u===upstream)return Response.json({ok:true,ignored:true});
    if(u.endsWith('/setWebhook')){
      assert.equal(calls.find(c=>c.url===upstream)!==undefined,true);
      assert.equal(JSON.parse(opts.body).drop_pending_updates,false);
      assert.equal(JSON.parse(opts.body).url,target);
      switched=true;
      return Response.json({ok:true,result:true});
    }
    throw Error('Unexpected mocked URL: '+u);
  };
  try{
    const r=await worker.fetch(request(),env);
    assert.equal(r.status,200);
    const result=await r.json();
    assert.equal(result.verified,true);
    assert.equal(result.updated,true);
    assert.equal(result.pendingBefore,2);
    assert.equal(result.dropPendingUpdates,false);
    assert.equal(switched,true);
  }finally{globalThis.fetch=previous}
});
test('never changes registration when production no-message probe is unhealthy',async()=>{
  const previous=globalThis.fetch;
  let webhookWrites=0;
  globalThis.fetch=async (url)=>{
    const u=String(url);
    if(u.endsWith('/getMe'))return Response.json({ok:true,result:{username:'AutoWorld_Georgia_bot'}});
    if(u.endsWith('/getWebhookInfo'))return Response.json({ok:true,result:{url:oldUrl}});
    if(u===upstream)return Response.json({ok:false,ignored:false},{status:502});
    if(u.endsWith('/setWebhook'))webhookWrites++;
    throw Error('should not proceed after failed probe');
  };
  try{
    const r=await worker.fetch(request(),env);
    assert.equal(r.status,502);
    assert.equal(webhookWrites,0);
  }finally{globalThis.fetch=previous}
});
test('never changes an unknown Telegram webhook URL',async()=>{
  const previous=globalThis.fetch;
  let wrote=0;
  globalThis.fetch=async (url)=>{
    const u=String(url);
    if(u.endsWith('/getMe'))return Response.json({ok:true,result:{username:'AutoWorld_Georgia_bot'}});
    if(u.endsWith('/getWebhookInfo'))return Response.json({ok:true,result:{url:'https://unexpected.example/webhook'}});
    wrote++;
    throw Error('unexpected fetch');
  };
  try{
    const r=await worker.fetch(request(),env);
    assert.equal(r.status,409);
    assert.equal(wrote,0);
  }finally{globalThis.fetch=previous}
});
