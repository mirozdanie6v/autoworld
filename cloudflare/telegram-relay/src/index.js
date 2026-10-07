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

export default{
  async fetch(request,env){
    const url=new URL(request.url);

    if(url.pathname==='/telegram/health'){
      return json({ok:true,service:'viiversion-telegram-relay'});
    }

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
