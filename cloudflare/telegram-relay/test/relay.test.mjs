import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../src/index.js';

const token='123456:testtoken';
const relaySecret='relay-secret-test';
const env={
  TELEGRAM_BOT_TOKEN:token,
  AUTOWORLD_RELAY_SECRET:relaySecret,
  AUTOWORLD_YANDEX_WEBHOOK_URL:'https://awg-upstream.example/api/auto-sale/telegram/webhook/secret-path'
};

function signed(body,ts=Date.now(),key=relaySecret){
  const raw=JSON.stringify(body);
  const sig=crypto.createHmac('sha256',key).update(String(ts)+'.'+raw).digest('hex');
  return new Request('https://integrationrevision.com/telegram/send',{
    method:'POST',
    headers:{'x-relay-timestamp':String(ts),'x-relay-signature':sig},
    body:raw
  });
}

function telegramWebhookSecret(){
  return crypto.createHmac('sha256',token).update('auto-sale-telegram-webhook-secret-v1').digest('hex');
}

test('health',async()=>{
  const r=await worker.fetch(new Request('https://integrationrevision.com/telegram/health'),env);
  assert.equal(r.status,200);
  assert.equal((await r.json()).ok,true);
});

test('rejects bad signature',async()=>{
  const r=await worker.fetch(new Request('https://integrationrevision.com/telegram/send',{
    method:'POST',
    headers:{'x-relay-timestamp':String(Date.now()),'x-relay-signature':'bad'},
    body:'{}'
  }),env);
  assert.equal(r.status,401);
});

test('rejects stale request',async()=>{
  const r=await worker.fetch(signed({chatId:'1',text:'x'},Date.now()-600000),env);
  assert.equal(r.status,401);
});

test('Telegram webhook ingress requires derived secret',async()=>{
  const r=await worker.fetch(new Request('https://integrationrevision.com/telegram/webhook',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({update_id:1})
  }),env);
  assert.equal(r.status,401);
  assert.equal((await r.json()).error,'invalid_telegram_webhook_secret');
});

test('Telegram webhook ingress forwards valid update and secret to Yandex',async()=>{
  const previousFetch=globalThis.fetch;
  const seen=[];
  globalThis.fetch=async(url,options={})=>{
    seen.push({url:String(url),options});
    return new Response(JSON.stringify({ok:true,handled:'/start',messageId:42}),{
      status:200,
      headers:{'content-type':'application/json'}
    });
  };
  try{
    const secret=telegramWebhookSecret();
    const r=await worker.fetch(new Request('https://integrationrevision.com/telegram/webhook',{
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-telegram-bot-api-secret-token':secret
      },
      body:JSON.stringify({update_id:2,message:{chat:{id:777},text:'/start'}})
    }),env);
    assert.equal(r.status,200);
    assert.deepEqual(await r.json(),{ok:true,handled:'/start',messageId:42});
    assert.equal(seen.length,1);
    assert.equal(seen[0].url,env.AUTOWORLD_YANDEX_WEBHOOK_URL);
    assert.equal(seen[0].options.headers['x-telegram-bot-api-secret-token'],secret);
  }finally{
    globalThis.fetch=previousFetch;
  }
});
