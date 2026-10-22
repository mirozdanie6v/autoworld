const enc=new TextEncoder();

const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});

const hex=buffer=>[...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,'0')).join('');

async function hmac(key,value){
  const imported=await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    {name:'HMAC',hash:'SHA-256'},
    false,
    ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC',imported,enc.encode(value)));
}

function equal(a,b){
  if(a.length!==b.length)return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}

async function expectedWebhookSecret(botToken){
  return hmac(botToken,'auto-sale-telegram-webhook-secret-v1');
}


async function repairProductionWebhook(request,env){
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  const token=String(env.TELEGRAM_BOT_TOKEN||'').trim();
  const relaySecret=String(env.AUTOWORLD_RELAY_SECRET||'');
  if(!token||!relaySecret)return json({error:'repair_not_configured'},503);
  const raw=await request.text();
  if(raw!=='{"action":"restore_cloudflare_ingress"}')return json({error:'invalid_repair_action'},400);
  const ts=String(request.headers.get('x-relay-timestamp')||'');
  const sig=String(request.headers.get('x-relay-signature')||'');
  const timestamp=Number(ts);
  if(!/^\d{13}$/.test(ts)||!Number.isSafeInteger(timestamp)||Math.abs(Date.now()-timestamp)>60000){
    return json({error:'stale_request'},401);
  }
  const expected=await hmac(relaySecret,ts+'.'+raw);
  if(!sig||!equal(sig,expected))return json({error:'invalid_signature'},401);

  const base='https://integration-telegram.viiversion.com';
  const target=base+'/telegram/webhook';
  const key=(await hmac(token,'auto-sale-telegram-webhook-v2')).slice(0,32);
  const webhookPath='/api/auto-sale/telegram/webhook/'+key;
  const upstream=String(env.AUTOWORLD_YANDEX_WEBHOOK_URL||'').trim();
  let configured;
  try{configured=new URL(upstream)}catch{return json({error:'invalid_upstream_config'},503)}
  if(configured.protocol!=='https:'||configured.hostname!=='awgcars.ru'||configured.pathname!==webhookPath||configured.search||configured.hash){
    return json({error:'invalid_upstream_config'},503);
  }
  const oldYandex='https://d5dbgio6limv03usvipl.s183zexc.apigw.yandexcloud.net'+webhookPath;
  const oldPublic='https://awgcars.ru'+webhookPath;
  const webhookSecret=await expectedWebhookSecret(token);
  async function telegram(method,body={}){
    const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),
      signal:AbortSignal.timeout(18000)
    });
    const data=await response.json().catch(()=>({}));
    if(response.status!==200||data.ok!==true)throw Error('telegram_'+method+'_failed');
    return data.result;
  }
  try{
    const me=await telegram('getMe');
    if(me?.username!=='AutoWorld_Georgia_bot')return json({error:'wrong_bot'},409);
    const before=await telegram('getWebhookInfo');
    if(![oldYandex,oldPublic,target].includes(String(before?.url||''))){
      return json({error:'unexpected_existing_webhook'},409);
    }
    const probe=await fetch(upstream,{
      method:'POST',
      headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':webhookSecret},
      body:JSON.stringify({update_id:-91020261022}),
      signal:AbortSignal.timeout(20000)
    });
    const probeBody=await probe.json().catch(()=>({}));
    if(probe.status!==200||probeBody?.ok!==true||probeBody?.ignored!==true){
      return json({error:'production_signed_probe_failed'},502);
    }
    const updated=before.url!==target;
    if(updated){
      await telegram('setWebhook',{
        url:target,secret_token:webhookSecret,allowed_updates:['message'],
        drop_pending_updates:false,max_connections:20
      });
    }
    const after=await telegram('getWebhookInfo');
    if(after?.url!==target||!(after?.allowed_updates||[]).includes('message')){
      return json({error:'webhook_verification_failed'},502);
    }
    return json({
      ok:true,verified:true,registered:true,updated,
      webhookHost:'integration-telegram.viiversion.com',
      pendingBefore:Number(before.pending_update_count||0),
      pendingAfter:Number(after.pending_update_count||0),
      dropPendingUpdates:false
    });
  }catch(error){
    return json({error:'telegram_repair_failed',stage:String(error?.message||'unknown').replace(/[^a-zA-Z_]/g,'').slice(0,64)},502);
  }
}

export default{
  async fetch(request,env){
    const url=new URL(request.url);

    if(url.pathname==='/telegram/health'){
      return json({ok:true,service:'viiversion-telegram-relay'});
    }

    if(url.pathname==='/telegram/admin/repair-webhook')return repairProductionWebhook(request,env);

    if(url.pathname==='/telegram/webhook'){
      if(request.method!=='POST')return json({error:'method_not_allowed'},405);
      const botToken=String(env.TELEGRAM_BOT_TOKEN||'').trim();
      const upstream=String(env.AUTOWORLD_YANDEX_WEBHOOK_URL||'').trim();
      if(!botToken||!upstream)return json({error:'webhook_upstream_not_configured'},503);

      const supplied=String(request.headers.get('x-telegram-bot-api-secret-token')||'');
      const expected=await expectedWebhookSecret(botToken);
      if(!supplied||!equal(supplied,expected))return json({error:'invalid_telegram_webhook_secret'},401);

      const raw=await request.text();
      let response;
      try{
        response=await fetch(upstream,{
          method:'POST',
          headers:{
            'content-type':'application/json',
            'x-telegram-bot-api-secret-token':supplied
          },
          body:raw,
          signal:AbortSignal.timeout(20_000)
        });
      }catch(error){
        return json({error:'webhook_upstream_unavailable',detail:String(error?.message||error)},502);
      }
      const body=await response.text();
      return new Response(body,{
        status:response.status,
        headers:{
          'content-type':response.headers.get('content-type')||'application/json; charset=utf-8',
          'cache-control':'no-store'
        }
      });
    }

    if(url.pathname!=='/telegram/send')return json({error:'not_found'},404);
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);

    const headerBotToken=request.headers.get('x-telegram-bot-token')||'';
    const botToken=env.TELEGRAM_BOT_TOKEN||headerBotToken;
    const relaySecret=env.AUTOWORLD_RELAY_SECRET||'';
    if(!botToken)return json({error:'relay_not_configured'},503);

    const raw=await request.text();
    const ts=request.headers.get('x-relay-timestamp')||'';
    const sig=request.headers.get('x-relay-signature')||'';
    const timestamp=Number(ts);
    if(!Number.isFinite(timestamp)||Math.abs(Date.now()-timestamp)>300000)return json({error:'stale_request'},401);

    const primaryKey=relaySecret||botToken;
    let expected=await hmac(primaryKey,ts+'.'+raw);
    let valid=equal(sig,expected);
    if(!valid&&relaySecret&&headerBotToken){
      expected=await hmac(headerBotToken,ts+'.'+raw);
      valid=equal(sig,expected);
    }
    if(!valid)return json({error:'invalid_signature'},401);

    let body;
    try{body=JSON.parse(raw)}catch{return json({error:'invalid_json'},400)}
    const chatId=String(body.chatId||'').trim();
    const text=String(body.text||'').trim();
    if(!/^-?\d+$/.test(chatId)||!text||text.length>3500)return json({error:'invalid_payload'},400);

    const tg=await fetch('https://api.telegram.org/bot'+botToken+'/sendMessage',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        chat_id:chatId,
        text,
        disable_web_page_preview:body.disableWebPagePreview!==false,
        ...(body.replyMarkup?{reply_markup:body.replyMarkup}:{})
      })
    });
    let data={};
    try{data=await tg.json()}catch{}
    if(!tg.ok||data.ok===false){
      return json({ok:false,error:'telegram_api_error',description:String(data.description||('HTTP '+tg.status))},502);
    }
    return json({ok:true,messageId:data.result?.message_id||null,chatId});
  }
};
