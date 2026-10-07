import {createHmac,timingSafeEqual} from 'node:crypto';

const clean=value=>String(value??'').trim();
const arr=value=>Array.isArray(value)?value.filter(Boolean):[];
const num=value=>Number(value)||0;
const money=value=>'$'+new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(num(value));
const unique=list=>[...new Set(list.map(clean).filter(Boolean))];

function safeEqualHex(a,b){
  try{
    const left=Buffer.from(String(a||''),'hex'),right=Buffer.from(String(b||''),'hex');
    return left.length===right.length&&left.length>0&&timingSafeEqual(left,right);
  }catch{return false}
}
function parseManagerIds(value){
  return unique(String(value||'').split(',').map(x=>x.trim()).filter(x=>/^-?\d+$/.test(x)));
}
function leadFor(state,leadId){
  return arr(state?.leads).find(x=>clean(x.id)===clean(leadId))||null;
}
function quoteLead(state,quote){
  return leadFor(state,quote?.leadId);
}
function orderLead(state,order){
  return leadFor(state,order?.leadId);
}
function clientId(lead){return /^\d+$/.test(clean(lead?.telegramUserId))?clean(lead.telegramUserId):''}
function managerIds(lead,fallback=[],state=null){
  const team=arr(state?.team);
  const managerName=clean(lead?.manager);
  const member=managerName?team.find(item=>clean(item?.name)===managerName&&item?.active!==false):null;
  const username=clean(member?.telegramUsername||member?.telegram||lead?.managerTelegramUsername).replace(/^@/,'').toLowerCase();
  const linked=username?team.find(item=>item.active!==false&&clean(item.telegramUsername||item.telegram).replace(/^@/,'').toLowerCase()===username&&/^\d+$/.test(clean(item.telegramUserId))):null;
  const preferred=unique([
    /^\d+$/.test(clean(lead?.managerTelegramUserId))?clean(lead.managerTelegramUserId):'',
    /^\d+$/.test(clean(member?.telegramUserId))?clean(member.telegramUserId):'',
    clean(linked?.telegramUserId)
  ]);
  const availableTeamManagers=preferred.length?[]:team
    .filter(item=>item?.active!==false&&clean(item?.role)==='Менеджер'&&/^\d+$/.test(clean(item?.telegramUserId)))
    .map(item=>clean(item.telegramUserId));
  return unique([...preferred,...availableTeamManagers,...fallback]);
}
function paymentStageTitle(order,payment){
  return arr(order?.paymentPlan).find(x=>clean(x.id)===clean(payment?.paymentStage))?.title||'Платёж';
}
function leadTitle(lead){return clean(lead?.model)||clean(lead?.name)||clean(lead?.id)||'заявка'}
function orderTitle(order){return clean(order?.model)||clean(order?.id)||'автомобиль'}
function statusClientTitle(status){
  return ({'В работе':'Менеджер принял заявку в работу','Расчёт':'Менеджер готовит расчёт','Ожидает клиента':'Расчёт готов','Сделка':'Расчёт согласован — оформляем заказ'}[clean(status)]||('Статус заявки: '+(clean(status)||'обновлён')));
}
function stageClientTitle(stage){
  return ({'Выкуп':'Автомобиль готовится к выкупу','Подготовка к отправке':'Автомобиль готовится к отправке','В пути':'Автомобиль в пути','Порт США':'Автомобиль доставлен в порт','В море':'Автомобиль отправлен морем','Таможня':'Автомобиль проходит таможенное оформление','Доставка':'Автомобиль направлен к месту выдачи','Выдача':'Автомобиль готов к выдаче'}[clean(stage)]||('Новый этап: '+(clean(stage)||'обновлён')));
}
function nextStageText(stage){
  return ({'Выкуп':'Сообщим, когда автомобиль будет передан в логистику.','Подготовка к отправке':'Сообщим после отправки автомобиля.','В пути':'Сообщим после прибытия автомобиля.','Порт США':'Сообщим после отправки автомобиля морем.','В море':'Сообщим после прибытия и перехода к таможенному оформлению.','Таможня':'Сообщим, когда автомобиль будет передан в доставку.','Доставка':'Сообщим, когда автомобиль будет готов к выдаче.','Выдача':'Свяжитесь с менеджером для согласования получения автомобиля.'}[clean(stage)]||'Следующее уведомление придёт при изменении этапа.');
}

export function createTelegramService({
  token=process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'',
  managerChatIds=process.env.AUTO_SALE_MANAGER_CHAT_IDS||'',
  fetchImpl=globalThis.fetch,
  apiBaseUrl=process.env.AUTO_SALE_TELEGRAM_API_BASE_URL||'https://api.telegram.org',
  relayUrl=process.env.AUTO_SALE_TELEGRAM_RELAY_URL||'',
  relaySecret=process.env.AUTOWORLD_RELAY_SECRET||'',
  now=()=>Date.now(),
  maxInitDataAgeSec=86400
}={}){
  const botToken=clean(token);
  const fallbackManagers=parseManagerIds(managerChatIds);
  const telegramApiBase=clean(apiBaseUrl).replace(/\/$/,'')||'https://api.telegram.org';
  const telegramRelayUrl=clean(relayUrl).replace(/\/$/,'');
  const telegramRelaySecret=clean(relaySecret);
  const enabled=Boolean(botToken&&fetchImpl);
  const webhookKey=botToken?createHmac('sha256',botToken).update('auto-sale-telegram-webhook-v2').digest('hex').slice(0,32):'';
  const webhookPath=webhookKey?`/api/auto-sale/telegram/webhook/${webhookKey}`:'';

  async function api(method,payload){
    if(!enabled){const error=new Error('telegram_not_configured');error.statusCode=503;throw error}
    const headers={'content-type':'application/json'};
    const response=await fetchImpl(`${telegramApiBase}/bot${botToken}/${method}`,{
      method:'POST',
      headers,
      body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)
    });
    let data={};
    try{data=await response.json()}catch{}
    if(!response.ok||data?.ok===false){
      const error=new Error('telegram_api_error');
      error.statusCode=502;
      error.telegramDescription=clean(data?.description)||`HTTP ${response.status}`;
      throw error;
    }
    return data?.result||data;
  }

  async function send(chatId,message,{disableWebPagePreview=true,replyMarkup=null}={}){
    const id=clean(chatId),body=clean(message);
    if(!/^-?\d+$/.test(id)){const error=new Error('telegram_chat_id_required');error.statusCode=409;throw error}
    if(!body){const error=new Error('telegram_message_required');error.statusCode=400;throw error}
    if(body.length>3500){const error=new Error('telegram_message_too_long');error.statusCode=400;throw error}
    if(telegramRelayUrl){
      const payload=JSON.stringify({chatId:id,text:body,disableWebPagePreview,replyMarkup});
      const timestamp=String(now());
      const relayKey=telegramRelaySecret||botToken;
      const signature=createHmac('sha256',relayKey).update(timestamp+'.'+payload).digest('hex');
      const relayHeaders={'content-type':'application/json','x-relay-timestamp':timestamp,'x-relay-signature':signature};
      if(!telegramRelaySecret)relayHeaders['x-telegram-bot-token']=botToken;
      const response=await fetchImpl(telegramRelayUrl,{method:'POST',headers:relayHeaders,body:payload,signal:AbortSignal.timeout(8000)});
      let data={};try{data=await response.json()}catch{}
      if(!response.ok||data?.ok===false){const error=new Error('telegram_relay_error');error.statusCode=502;error.telegramDescription=clean(data?.description)||clean(data?.error)||`HTTP ${response.status}`;throw error}
      return{message_id:data?.messageId||null};
    }
    return api('sendMessage',{chat_id:id,text:body,disable_web_page_preview:disableWebPagePreview,...(replyMarkup?{reply_markup:replyMarkup}:{})});
  }

  function validateInitData(initData){
    if(!enabled)return{ok:false,error:'telegram_not_configured'};
    const raw=clean(initData);
    if(!raw)return{ok:false,error:'telegram_init_data_required'};
    const params=new URLSearchParams(raw);
    const hash=clean(params.get('hash'));
    if(!hash)return{ok:false,error:'telegram_hash_required'};
    const authDate=Number(params.get('auth_date')||0);
    if(!authDate)return{ok:false,error:'telegram_auth_date_required'};
    const nowSec=Math.floor(now()/1000);
    if(authDate>nowSec+300||nowSec-authDate>maxInitDataAgeSec)return{ok:false,error:'telegram_init_data_expired'};
    const check=[...params.entries()]
      .filter(([key])=>key!=='hash')
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([key,value])=>`${key}=${value}`)
      .join('\n');
    const secret=createHmac('sha256','WebAppData').update(botToken).digest();
    const expected=createHmac('sha256',secret).update(check).digest('hex');
    if(!safeEqualHex(hash,expected))return{ok:false,error:'telegram_init_data_invalid'};
    let user=null;
    try{user=JSON.parse(params.get('user')||'null')}catch{}
    if(!user?.id)return{ok:false,error:'telegram_user_required'};
    return{ok:true,user:{...user,id:String(user.id)},authDate};
  }

  function manualRecipient(state,{leadId,target,senderId,isAdmin=false}={}){
    const lead=leadFor(state,leadId);
    if(!lead)return{ok:false,error:'lead_not_found'};
    const sender=clean(senderId);
    if(target==='client'){
      const allowedManagers=managerIds(lead,fallbackManagers,state);
      if(!isAdmin&&!allowedManagers.includes(sender))return{ok:false,error:'telegram_sender_forbidden'};
      const chatId=clientId(lead);
      if(!chatId)return{ok:false,error:'client_telegram_not_linked'};
      return{ok:true,lead,chatId};
    }
    if(target==='manager'){
      if(clientId(lead)!==sender)return{ok:false,error:'telegram_sender_forbidden'};
      const ids=managerIds(lead,fallbackManagers,state);
      if(!ids.length)return{ok:false,error:'manager_telegram_not_linked'};
      return{ok:true,lead,chatId:ids[0]};
    }
    return{ok:false,error:'telegram_target_invalid'};
  }

  async function sendManual(state,{leadId,target,text,senderId,isAdmin=false}={}){
    const body=clean(text);
    if(!body){const error=new Error('telegram_message_required');error.statusCode=400;throw error}
    if(body.length>1500){const error=new Error('telegram_message_too_long');error.statusCode=400;throw error}
    const recipient=manualRecipient(state,{leadId,target,senderId,isAdmin});
    if(!recipient.ok){const error=new Error(recipient.error);error.statusCode=recipient.error==='lead_not_found'?404:recipient.error.includes('forbidden')?403:409;throw error}
    const lead=recipient.lead;
    const prefix=target==='client'
      ?`AUTO МИР · сообщение менеджера\n${leadTitle(lead)}\n\n`
      :`AUTO МИР · сообщение клиента\n${clean(lead.name)||leadTitle(lead)}\n\n`;
    const result=await send(recipient.chatId,prefix+body);
    return{ok:true,chatId:recipient.chatId,messageId:result?.message_id||null};
  }

  async function collectStateChanges(previous,next){
    if(!enabled||!previous?.initialized)return[];
    const deliveries=[];
    const eventKey=meta=>[Number(previous.revision||0)+1,meta.event,meta.leadId,meta.quoteId,meta.orderId,meta.paymentId].filter(x=>x!==undefined&&x!=='').join(':');
    const prevLeads=new Map(arr(previous.leads).map(x=>[clean(x.id),x]));
    const prevQuotes=new Map(arr(previous.quotes).map(x=>[clean(x.id),x]));
    const prevOrders=new Map(arr(previous.orders).map(x=>[clean(x.id),x]));

    const appUrl=clean(process.env.AUTO_SALE_TELEGRAM_APP_URL||'');
    const actionMarkup=label=>appUrl?{inline_keyboard:[[{text:label,web_app:{url:appUrl}}]]}:null;
    const deliver=async(chatId,message,meta,replyMarkup=null)=>{
      deliveries.push({chatId,message,replyMarkup,id:eventKey(meta)+':'+meta.target+':'+chatId,...meta});
    };
    const toManagers=async(lead,message,meta,label='Открыть заявку')=>{
      for(const chatId of managerIds(lead,fallbackManagers,next))await deliver(chatId,message,{target:'manager',...meta},actionMarkup(label));
    };
    const toClient=async(lead,message,meta,label='Открыть AUTO МИР')=>{
      const chatId=clientId(lead);if(chatId)await deliver(chatId,message,{target:'client',...meta},actionMarkup(label));
    };

    for(const lead of arr(next?.leads)){
      const before=prevLeads.get(clean(lead.id));
      if(!before){
        const source=lead.clientCreated?'Новая заявка клиента':'Новый лид';
        await toManagers(lead,`🚗 AUTO МИР · ${source.toLowerCase()}\n${clean(lead.name)||'Клиент'}\n${leadTitle(lead)}\nБюджет: ${lead.budget?money(lead.budget):'не указан'}\nКонтакт: ${clean(lead.contact)||'—'}`,{event:'lead_created',leadId:lead.id});
        if(lead.clientCreated){
          await toClient(lead,`🚗 AUTO МИР · заявка принята\n\n${leadTitle(lead)}\nБюджет: ${lead.budget?money(lead.budget):'не указан'}\nСтатус: ${clean(lead.status)||'Новый'}\n\nЗаявка передана менеджеру. Мы сообщим здесь, когда будет готов расчёт, а после оформления заказа — об оплатах и этапах доставки.`,{event:'lead_created_confirmation',leadId:lead.id});
        }
      }else if(before&&clean(before.status)!==clean(lead.status)){
        const clientMsg=`🚗 AUTO МИР\n\n${statusClientTitle(lead.status)}\n${leadTitle(lead)}\n\n${clean(lead.status)==='В работе'?'Менеджер уже работает с вашей заявкой. Сообщим, когда расчёт будет готов.':clean(lead.status)==='Ожидает клиента'?'Откройте AUTO МИР: расчёт готов и ждёт вашего решения.':'Следующее важное изменение мы также пришлём сюда.'}`;
        const managerMsg=`🔔 AUTO МИР · статус заявки\nКлиент: ${clean(lead.name)||'—'}\nАвтомобиль: ${leadTitle(lead)}\n${clean(before.status)||'—'} → ${clean(lead.status)||'—'}`;
        await toClient(lead,clientMsg,{event:'lead_status',leadId:lead.id});
        await toManagers(lead,managerMsg,{event:'lead_status',leadId:lead.id});
      }
    }

    for(const quote of arr(next?.quotes)){
      const before=prevQuotes.get(clean(quote.id));
      const decisionChanged=quote.clientDecision==='changes_requested'&&(before?.clientDecision!==quote.clientDecision||before?.clientDecisionAt!==quote.clientDecisionAt);
      if(before&&clean(before.status)===clean(quote.status)&&!decisionChanged)continue;
      const lead=quoteLead(next,quote);if(!lead)continue;
      if(decisionChanged){
        const message=`✏️ AUTO МИР · клиент запросил изменения\n${leadTitle(lead)}\nРасчёт: ${clean(quote.id)}\n${clean(quote.clientComment)||'Уточните пожелания клиента.'}`;
        await toClient(lead,message,{event:'quote_changes_requested',leadId:lead.id,quoteId:quote.id});
        await toManagers(lead,message,{event:'quote_changes_requested',leadId:lead.id,quoteId:quote.id});
        continue;
      }
      const total=num(quote.total)?`\nСтоимость: ${money(quote.total)}`:'';
      const clientMsg=`💰 AUTO МИР · расчёт\n\n${clean(quote.model)||leadTitle(lead)}\nСтатус: ${clean(quote.status)}${total}\n\n${clean(quote.status)==='Отправлен'?'Расчёт готов. Откройте AUTO МИР, чтобы увидеть итоговую стоимость и детали.':clean(quote.status)==='Согласован'?'Расчёт согласован. Менеджер переходит к оформлению заказа.':'Следующее важное изменение мы также пришлём сюда.'}`;
      const managerMsg=`💰 AUTO МИР · расчёт\nКлиент: ${clean(lead.name)||'—'}\nАвтомобиль: ${clean(quote.model)||leadTitle(lead)}\nСтатус: ${clean(quote.status)}${total}`;
      await toClient(lead,clientMsg,{event:'quote_status',leadId:lead.id,quoteId:quote.id},'Посмотреть расчёт');
      await toManagers(lead,managerMsg,{event:'quote_status',leadId:lead.id,quoteId:quote.id});
    }

    for(const order of arr(next?.orders)){
      const before=prevOrders.get(clean(order.id));
      const lead=orderLead(next,order);if(!lead)continue;
      if(!before){
        const clientMsg=`✅ AUTO МИР · заказ оформлен\n\n${orderTitle(order)}\nНомер заказа: ${clean(order.id)}\nТекущий этап: ${clean(order.stage)||'Выкуп'}\n\nЗаказ создан. Здесь будут приходить подтверждения платежей и изменения этапов доставки автомобиля.`;
        const managerMsg=`✅ AUTO МИР · заказ создан\nКлиент: ${clean(lead.name)||'—'}\nАвтомобиль: ${orderTitle(order)}\nЗаказ: ${clean(order.id)}\nЭтап: ${clean(order.stage)||'Выкуп'}`;
        await toClient(lead,clientMsg,{event:'order_created',leadId:lead.id,orderId:order.id},'Открыть заказ');
        await toManagers(lead,managerMsg,{event:'order_created',leadId:lead.id,orderId:order.id});
      }else if(clean(before.stage)!==clean(order.stage)){
        const extra=clean(order.location)?`\nЛокация: ${clean(order.location)}`:'';
        const clientMsg=`🚚 AUTO МИР · заказ\n\n${stageClientTitle(order.stage)}\n${orderTitle(order)}${extra}\n\n${nextStageText(order.stage)}`;
        const managerMsg=`🚚 AUTO МИР · этап заказа\nКлиент: ${clean(lead.name)||'—'}\nАвтомобиль: ${orderTitle(order)}\n${clean(before.stage)||'—'} → ${clean(order.stage)||'—'}${extra}`;
        await toClient(lead,clientMsg,{event:'order_stage',leadId:lead.id,orderId:order.id},'Отследить автомобиль');
        await toManagers(lead,managerMsg,{event:'order_stage',leadId:lead.id,orderId:order.id});
      }
      const previousPaymentIds=new Set(arr(before?.payments).map(x=>clean(x.id)));
      const newPayments=arr(order.payments).filter(x=>!previousPaymentIds.has(clean(x.id)));
      for(const payment of newPayments){
        const title=paymentStageTitle(order,payment);
        const fullyPaid=num(order.paid)>=num(order.total)&&num(order.total)>0;
        const clientMsg=`💳 AUTO МИР · ${fullyPaid?'оплата получена полностью':'платёж получен'}\n\n${orderTitle(order)}\n${title}\nСумма: ${money(payment.amount)}\nОплачено по заказу: ${money(order.paid)} из ${money(order.total)}\n\n${fullyPaid?'Оплата по заказу получена полностью. Информация сохранена в заказе.':'Платёж получен и зафиксирован. Следующее уведомление придёт при изменении заказа.'}`;
        const managerMsg=`💳 AUTO МИР · платёж\nКлиент: ${clean(lead.name)||'—'}\nАвтомобиль: ${orderTitle(order)}\n${title}\nСумма: ${money(payment.amount)}\nОплачено: ${money(order.paid)} из ${money(order.total)}`;
        await toClient(lead,clientMsg,{event:'payment',leadId:lead.id,orderId:order.id,paymentId:payment.id});
        await toManagers(lead,managerMsg,{event:'payment',leadId:lead.id,orderId:order.id,paymentId:payment.id});
      }
    }
    return deliveries;
  }

  async function notifyStateChanges(previous,next){
    const deliveries=[];
    for(const item of await collectStateChanges(previous,next)){
      try{const result=await send(item.chatId,item.message,{replyMarkup:item.replyMarkup});deliveries.push({...item,ok:true,messageId:result?.message_id||null})}
      catch(error){deliveries.push({...item,ok:false,error:clean(error.telegramDescription||error.message)||'telegram_send_failed'})}
    }
    return deliveries;
  }

  function isWebhookPath(pathname=''){
    return Boolean(enabled&&webhookPath&&clean(pathname)===webhookPath);
  }

  async function handleWebhookUpdate(update,{appUrl='',webhookReply=false}={}){
    if(!enabled){const error=new Error('telegram_not_configured');error.statusCode=503;throw error}
    const message=update?.message;
    if(!message?.chat?.id)return{ok:true,ignored:true};
    const chatId=String(message.chat.id),textValue=clean(message.text),firstName=clean(message.from?.first_name)||'';
    const command=textValue.split(/\s+/)[0].toLowerCase().replace(/@[^\s]+$/,'');
    const webAppUrl=clean(appUrl);

    if(command==='/start'||command==='/catalog'||command==='/app'){
      const greeting=command==='/start'
        ?`🚗 AUTO МИР\n\nЗдравствуйте${firstName?', '+firstName:''}!\n\nЗдесь можно выбрать автомобиль из США или Грузии, получить расчёт и отслеживать заказ — всё в одном приложении.\n\nНажмите «Открыть каталог», чтобы начать.`
        :`🚗 Каталог AUTO МИР\n\nОткройте приложение, чтобы посмотреть автомобили, отправить заявку или проверить свой заказ.`;
      const payload={chat_id:chatId,text:greeting};
      if(webAppUrl)payload.reply_markup={inline_keyboard:[[{text:'🚗 Открыть каталог',web_app:{url:webAppUrl}}]]};
      if(webhookReply)return{ok:true,handled:command,webhookMethod:'sendMessage',webhookPayload:payload};
      const result=await send(chatId,greeting,{replyMarkup:payload.reply_markup||null});
      return{ok:true,handled:command,messageId:result?.message_id||null};
    }

    if(command==='/help'){
      const body='AUTO МИР помогает пройти весь путь покупки автомобиля:\n\n1. Выбрать авто из США или Грузии\n2. Получить прозрачный расчёт\n3. Оформить заявку\n4. Следить за этапами заказа и оплатами\n5. Получать уведомления прямо в Telegram';
      const payload={chat_id:chatId,text:body};
      if(webAppUrl)payload.reply_markup={inline_keyboard:[[{text:'Открыть AUTO МИР',web_app:{url:webAppUrl}}]]};
      if(webhookReply)return{ok:true,handled:'/help',webhookMethod:'sendMessage',webhookPayload:payload};
      const result=await send(chatId,body,{replyMarkup:payload.reply_markup||null});
      return{ok:true,handled:'/help',messageId:result?.message_id||null};
    }

    if(textValue){
      const payload={chat_id:chatId,text:'Для работы с AUTO МИР используйте кнопку каталога ниже или команду /help.'};
      if(webhookReply)return{ok:true,handled:'fallback',webhookMethod:'sendMessage',webhookPayload:payload};
      const result=await send(chatId,payload.text);
      return{ok:true,handled:'fallback',messageId:result?.message_id||null};
    }
    return{ok:true,ignored:true};
  }

  return{
    enabled,
    fallbackManagerCount:fallbackManagers.length,
    webhookPath,
    isWebhookPath,
    handleWebhookUpdate,
    send,
    validateInitData,
    manualRecipient,
    managerIds:(lead,state)=>managerIds(lead,fallbackManagers,state),
    sendManual,
    notifyStateChanges,
    collectStateChanges
  };
}
