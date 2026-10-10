export function notificationOptions(telegram,vk,{skipTelegram=false}={}){
  return{telegramEnabled:Boolean(telegram?.enabled&&!skipTelegram),vkEnabled:Boolean(vk?.messagingEnabled)};
}

export function notificationsEnabled(telegram,vk,options){
  const channels=notificationOptions(telegram,vk,options);
  return channels.telegramEnabled||channels.vkEnabled;
}

// The legacy fixture header suppresses every channel, just like its new alias.
export function notificationsSuppressed(headers={}, {apiKey=false}={}){
  return apiKey&&(headers['x-auto-sale-skip-notifications']==='1'||headers['x-auto-sale-skip-telegram']==='1');
}

export function collectSaleNotifications(previous,next,{telegram,vk,skipTelegram=false}){
  return telegram.collectStateChanges(previous,next,notificationOptions(telegram,vk,{skipTelegram}));
}

export async function deliverSaleNotifications(pending,{telegram,vk,markNotification}){
  const results=[];
  for(const item of pending){
    const channel=String(item?.channel||'telegram');
    try{
      const sent=channel==='vk'
        ?await vk.send(item.vkUserId,item.message,{idempotencyKey:item.id,notification:item})
        :await telegram.send(item.chatId,item.message,{replyMarkup:item.replyMarkup});
      if(!sent?.message_id)throw new Error(channel==='vk'?'vk_message_id_missing':'telegram_message_id_missing');
      await markNotification(item.id,{ok:true,messageId:sent.message_id,attempts:item.attempts});
      results.push({id:item.id,ok:true,channel,messageId:sent.message_id});
    }catch(error){
      const message=String(error?.vkDescription||error?.telegramDescription||error?.message||'notification_send_failed');
      await markNotification(item.id,{ok:false,error:message,attempts:item.attempts,permanent:Boolean(error?.permanent)});
      results.push({id:item.id,ok:false,channel,error:message});
    }
  }
  return results;
}
