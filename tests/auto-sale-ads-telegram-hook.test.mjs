import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegramService} from '../server/telegram-bot.mjs';

const adsToken='AbcdeFGHIJ_0123456789-abcDEFghijK';
const incoming=(text,{chatId='12345',userId='12345',type='private',updateId=778899}={})=>({
  update_id:updateId,message:{text,chat:{id:chatId,type},from:{id:userId,first_name:'Test'}}
});

test('trusted private /start with opaque ads token calls only injected recorder',async()=>{
  const calls=[];
  const bot=createTelegramService({token:'123:qa-bot-token',
    adsStartRecorder:async data=>{calls.push(data);}});
  const result=await bot.handleWebhookUpdate(incoming('/start '+adsToken),{
    appUrl:'https://awgcars.ru/',webhookReply:true
  });
  assert.equal(result.handled,'/start');
  assert.equal(result.webhookPayload.reply_markup.inline_keyboard[0][0].web_app.url,'https://awgcars.ru/');
  assert.deepEqual(calls,[{telegramUserId:'12345',startPayload:adsToken,updateId:'778899'}]);
  assert.doesNotMatch(result.webhookPayload.text,new RegExp(adsToken));
});

test('invalid or spoofed /start never records attribution and keeps bot working',async()=>{
  const calls=[];
  const bot=createTelegramService({token:'123:qa-bot-token',adsStartRecorder:async v=>{calls.push(v);}});
  const payloads=[
    incoming('/start campaign_public'),
    incoming('/start '+adsToken+' extra'),
    incoming('/start '+adsToken,{type:'group'}),
    incoming('/start '+adsToken,{userId:'98765'}),
    incoming('/start '+adsToken,{updateId:'abc'}),
    incoming('/catalog '+adsToken)
  ];
  for(const entry of payloads){
    const answer=await bot.handleWebhookUpdate(entry,{webhookReply:true});
    assert.ok(answer.ok);
  }
  assert.equal(calls.length,0);
});

test('attribution exceptions do not interrupt /start reply or expose secrets',async()=>{
  const bot=createTelegramService({token:'123:qa-bot-token',
    adsStartRecorder:async()=>{throw Object.assign(new Error('confidential-key'),{code:'temporary_failure'});}});
  const warn=console.warn;
  const seen=[];
  try{
    console.warn=(...args)=>seen.push(args.join(' '));
    const result=await bot.handleWebhookUpdate(incoming('/start '+adsToken),{webhookReply:true});
    assert.equal(result.handled,'/start');
    assert.ok(result.webhookPayload.text.includes('Открыть каталог'));
  }finally{console.warn=warn;}
  assert.equal(seen.length,1);
  assert.doesNotMatch(seen[0],/confidential-key|123:qa-bot-token|AbcdeFGHIJ_/);
});

test('attribution hook is disabled by default without affecting existing bot behavior',async()=>{
  const bot=createTelegramService({token:'123:qa-bot-token'});
  const result=await bot.handleWebhookUpdate(incoming('/start '+adsToken),{webhookReply:true});
  assert.equal(result.handled,'/start');
  assert.throws(()=>createTelegramService({token:'123:qa-bot-token',adsStartRecorder:true}),/ads_start_recorder_invalid/);
});
