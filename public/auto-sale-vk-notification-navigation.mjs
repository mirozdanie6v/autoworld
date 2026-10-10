import {parseNotificationHash,resolveNotificationTarget} from './auto-sale-notification-links.mjs';

export function initializeNotificationNavigation(win=window,doc=document){
  let openedHash='',identityKey='';
  const read=(key,fallback)=>{try{return JSON.parse(win.localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
  const open=()=>{
    const access=win.__AUTO_SALE_ACCESS__;
    const nextIdentity=access?.authenticated===true?String(access.identity?.key||access.user?.id||''):'';
    if(nextIdentity!==identityKey){identityKey=nextIdentity;openedHash='';doc.querySelector('[data-client-detail-bg]')?.remove()}
    const raw=win.location.hash||new URLSearchParams(win.location.search||'').get('vk_hash')||'';
    const target=parseNotificationHash(raw);
    if(!target||raw===openedHash)return;
    // Wait for server hydration instead of trusting an unsigned launch URL.
    if(access?.authenticated!==true||access.role!=='client'||!win.__AUTO_SALE_OPEN_CLIENT_DETAIL__)return;
    const state={leads:read('auto-sale-leads-v2',[]),quotes:read('auto-sale-quotes-v2',[]),orders:read('auto-sale-orders-v2',[])};
    const resolved=resolveNotificationTarget(target,state,access);
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
