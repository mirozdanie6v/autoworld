import {parseNotificationHash,resolveNotificationTarget,resolveManagerNotificationTarget} from './auto-sale-notification-links.mjs';

export function initializeNotificationNavigation(win=window,doc=document){
  let openedHash='',identityKey='';
  const read=(key,fallback)=>{try{return JSON.parse(win.localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
  const open=()=>{
    const access=win.__AUTO_SALE_ACCESS__;
    const nextIdentity=access?.authenticated===true?String(access.role||'')+':'+String(access.identity?.key||access.user?.id||access.member?.name||'admin'):'';
    if(nextIdentity!==identityKey){identityKey=nextIdentity;openedHash='';doc.querySelector('[data-client-detail-bg]')?.remove()}
    const params=new URLSearchParams(win.location.search||'');
    // Telegram injects its own tgWebAppData hash. The query survives that
    // launch, while the old VK hash and vk_hash deep links remain supported.
    const raw=params.get('awg_notification')||win.location.hash||params.get('vk_hash')||'';
    const target=parseNotificationHash(raw);
    if(!target||raw===openedHash)return;
    // A URL selects an entity ONLY after signed Telegram/VK authentication,
    // server hydration and role-specific visibility checks.
    if(access?.authenticated!==true)return;
    const isClient=access.role==='client',isManager=access.role==='admin';
    if(!isClient&&!isManager)return;
    if(isClient&&!win.__AUTO_SALE_OPEN_CLIENT_DETAIL__)return;
    if(isManager&&!win.__AUTO_SALE_OPEN_MANAGER_NOTIFICATION__)return;
    const state={leads:read('auto-sale-leads-v2',[]),quotes:read('auto-sale-quotes-v2',[]),orders:read('auto-sale-orders-v2',[])};
    const resolved=isClient?resolveNotificationTarget(target,state,access):resolveManagerNotificationTarget(target,state,access);
    if(isManager){
      if(!resolved)return;
      if(win.__AUTO_SALE_OPEN_MANAGER_NOTIFICATION__(target,resolved))openedHash=raw;
      return;
    }
    openedHash=raw;
    win.dispatchEvent(new win.CustomEvent('auto-sale-open-client-orders'));
    if(resolved){
      win.__AUTO_SALE_OPEN_CLIENT_DETAIL__(resolved.leadId,resolved);
      return;
    }
    doc.querySelector('[data-client-detail-bg]')?.remove();
    const area=doc.querySelector('[data-client-orders]');
    if(area){
      const note=doc.createElement('p');note.className='auto-muted-copy';note.setAttribute('role','status');
      note.textContent='Эта заявка недоступна в текущем аккаунте. Здесь показаны ваши заявки.';
      area.prepend(note);
    }
  };
  const schedule=()=>queueMicrotask(open);
  for(const event of ['auto-sale-server-synced','auto-sale-client-detail-ready','hashchange'])win.addEventListener(event,schedule);
  schedule();
  return()=>{for(const event of ['auto-sale-server-synced','auto-sale-client-detail-ready','hashchange'])win.removeEventListener(event,schedule)};
}

if(typeof window!=='undefined'&&typeof document!=='undefined')initializeNotificationNavigation();
