const launchParams=()=>new URLSearchParams(window.location.search||'');
const launchVkUserId=()=>String(launchParams().get('vk_user_id')||'').trim();
const hasVkLaunch=()=>{
  const params=launchParams();
  return Boolean(params.get('vk_app_id')&&params.get('vk_user_id')&&params.get('sign'));
};

let bridgePromise=null;
let configPromise=null;
let initPromise=null;
let userPromise=null;
let currentVkUser=null;
let messagesPromise=null;

function withTimeout(promise,ms,code){
  let timer=null;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(code)),ms);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

async function vkConfig(){
  if(!configPromise)configPromise=fetch('/api/auto-sale/vk/config',{cache:'no-store'})
    .then(async response=>response.ok?response.json():({enabled:false}))
    .catch(()=>({enabled:false}));
  return configPromise;
}

async function loadBridge(){
  if(window.vkBridge)return window.vkBridge;
  if(bridgePromise)return bridgePromise;
  bridgePromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const timer=setTimeout(()=>reject(new Error('vk_bridge_load_timeout')),7000);
    const settle=(fn,value)=>{
      clearTimeout(timer);
      script.onload=null;
      script.onerror=null;
      fn(value);
    };
    script.src='https://unpkg.com/@vkontakte/vk-bridge@3.0.2/dist/browser.min.js';
    script.async=true;
    script.crossOrigin='anonymous';
    script.referrerPolicy='no-referrer';
    script.onload=()=>window.vkBridge
      ?settle(resolve,window.vkBridge)
      :settle(reject,new Error('vk_bridge_global_missing'));
    script.onerror=()=>settle(reject,new Error('vk_bridge_load_failed'));
    document.head.appendChild(script);
  });
  return bridgePromise;
}

function esc(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function normalizeVkUser(profile={}){
  const id=String(profile?.id||launchVkUserId()||'').trim();
  if(!/^\d+$/.test(id))return null;
  const firstName=String(profile?.first_name||'').trim();
  const lastName=String(profile?.last_name||'').trim();
  const domain=String(profile?.screen_name||profile?.domain||'').trim().replace(/^@/,'');
  const displayName=[firstName,lastName].filter(Boolean).join(' ')||domain||'';
  const contact=domain?'https://vk.com/'+domain:'https://vk.com/id'+id;
  return{id,provider:'vk',firstName,lastName,displayName,domain,contact};
}

function autofillVkClientRequest(){
  if(typeof document==='undefined')return false;
  const form=document.querySelector('#requestForm');
  if(!form||form.elements?.managerMode?.value!=='0'||form.dataset.vkReady==='1')return false;
  const user=currentVkUser||window.__AUTO_SALE_VK_USER__;
  if(!user)return false;
  const name=form.elements?.name,contact=form.elements?.contact;
  if(name&&!name.value.trim()&&user.displayName){
    name.value=user.displayName;
    name.dataset.vkAutofilled='1';
  }
  if(contact&&!contact.value.trim()&&user.contact){
    contact.value=user.contact;
    contact.dataset.vkAutofilled='1';
  }
  form.dataset.vkReady='1';
  if(!form.querySelector?.('[data-vk-client-hint]')){
    const note=document.createElement('div');
    note.className='auto-tg-hint full';
    note.dataset.vkClientHint='1';
    const label=user.displayName||('VK ID '+user.id);
    note.innerHTML='<span>VK</span><b>'+esc(label)+'</b><small>Имя и контакт подставлены из профиля VK</small>';
    form.querySelector?.('.auto-form-actions')?.before?.(note);
  }
  return true;
}

async function ensureVkUserProfile(bridgeArg=null){
  if(!hasVkLaunch())return null;
  if(currentVkUser)return currentVkUser;
  if(userPromise)return userPromise;
  userPromise=(async()=>{
    try{
      const bridge=bridgeArg||await loadBridge();
      const profile=await withTimeout(bridge.send('VKWebAppGetUserInfo'),5000,'vk_user_info_timeout');
      const user=normalizeVkUser(profile||{});
      if(!user)throw new Error('vk_user_info_invalid');
      currentVkUser=user;
      window.__AUTO_SALE_VK_USER__=user;
      autofillVkClientRequest();
      return user;
    }catch(error){
      console.warn('AUTO SALE VK user profile unavailable',String(error?.message||error));
      window.__AUTO_SALE_VK_PROFILE_ERROR__='vk_user_profile_unavailable';
      return null;
    }
  })();
  return userPromise;
}

function scheduleVkClientPrefill(){
  if(!hasVkLaunch())return;
  setTimeout(()=>{
    ensureVkUserProfile().then(()=>autofillVkClientRequest()).catch(()=>{});
  },0);
}

export async function initVkMiniAppShell(){
  if(!hasVkLaunch())return{ok:true,skipped:'not-vk'};
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    try{
      const bridge=await loadBridge();
      await withTimeout(bridge.send('VKWebAppInit'),5000,'vk_init_timeout');
      const result={ok:true};
      window.__AUTO_SALE_VK_SHELL__=result;
      void ensureVkUserProfile(bridge);
      void restoreVkMessagesState().catch(()=>console.warn('AUTO SALE VK permission state unavailable'));
      return result;
    }catch(error){
      console.warn('AUTO SALE VK shell initialization failed',String(error?.message||error));
      const result={ok:false,error:'vk_shell_init_failed'};
      window.__AUTO_SALE_VK_SHELL__=result;
      return result;
    }
  })();
  return initPromise;
}

function setMessagesState(status){
  window.__AUTO_SALE_VK_MESSAGES_STATE__={status};
  renderVkMessagesHint();
}

async function restoreVkMessagesState(){
  const config=await vkConfig();
  if(!config?.messagingEnabled||!config?.groupId)return;
  let cached=null;
  try{cached=sessionStorage.getItem(`auto-sale-vk-messages-allowed:${config.groupId}:${launchVkUserId()}`)}catch{return}
  if(cached==='1'||cached==='0')setMessagesState(cached==='1'?'allowed':'denied');
}

export function renderVkMessagesHint(){
  if(typeof document==='undefined')return;
  const state=window.__AUTO_SALE_VK_MESSAGES_STATE__;
  const form=document.querySelector('#requestForm');
  const area=form?.elements?.managerMode?.value==='0'?form:document.querySelector('[data-client-orders]');
  document.querySelectorAll('[data-vk-messages-notice]').forEach(node=>{if(!area?.contains(node))node.remove()});
  if(!area)return;
  let note=area.querySelector('[data-vk-messages-notice]');
  if(!state||state.status==='allowed'){note?.remove();return}
  if(!note){note=document.createElement('div');note.className='auto-note full';note.dataset.vkMessagesNotice='1';note.setAttribute('role','status');area.prepend(note)}
  const unavailable=state.status==='unavailable',pending=state.status==='pending';
  note.innerHTML='<b>Сообщения ВК</b><span>Статусы заявки доступны в «Мои заказы». '+
    (unavailable?'Уведомления ВК временно недоступны.':pending?'Ожидаем разрешение на сообщения.':'Включите сообщения, чтобы получать расчёт и этапы доставки в ВК.')+'</span>'+
    (unavailable?'':'<button type="button" class="auto-btn ghost" data-vk-allow-messages'+(pending?' disabled':'')+'>Включить сообщения</button>');
}

export function ensureVkMessagesAllowed(options={}){
  if(!messagesPromise)messagesPromise=requestVkMessagesAllowed(options).finally(()=>{messagesPromise=null});
  return messagesPromise;
}

async function requestVkMessagesAllowed({force=false}={}){
  if(!hasVkLaunch())return{ok:true,skipped:'not-vk'};
  const shell=await initVkMiniAppShell();
  if(!shell.ok){setMessagesState('unavailable');return shell}
  if(force)configPromise=null;
  const config=await vkConfig();
  if(!config?.enabled||!config?.messagingEnabled||!config?.groupId){setMessagesState('unavailable');return{ok:false,skipped:'vk-messaging-not-configured'}}
  const cacheKey=`auto-sale-vk-messages-allowed:${config.groupId}:${launchVkUserId()}`;
  let cached=false;
  try{cached=sessionStorage.getItem(cacheKey)==='1'}catch{console.warn('AUTO SALE VK permission cache unavailable')}
  if(!force&&cached){setMessagesState('allowed');return{ok:true,cached:true}}
  setMessagesState('pending');
  try{
    const bridge=await loadBridge();
    const permission=await withTimeout(bridge.send('VKWebAppAllowMessagesFromGroup',{group_id:Number(config.groupId)}),15000,'vk_messages_permission_timeout');
    if(permission?.result!==true)throw new Error('vk_messages_permission_not_granted');
    try{sessionStorage.setItem(cacheKey,'1')}catch{console.warn('AUTO SALE VK permission cache unavailable')}
    setMessagesState('allowed');
    return{ok:true};
  }catch(error){
    try{sessionStorage.setItem(cacheKey,'0')}catch{console.warn('AUTO SALE VK permission cache unavailable')}
    setMessagesState('denied');
    console.warn('AUTO SALE VK messages permission not granted',String(error?.message||error));
    return{ok:false,error:'vk_messages_permission_not_granted'};
  }
}

if(typeof document!=='undefined'){
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-open-request],[data-request-car]'))scheduleVkClientPrefill();
    if(event.target?.closest?.('[data-vk-allow-messages]')&&!event.target.closest('[data-vk-allow-messages]').disabled){
      void ensureVkMessagesAllowed({force:true}).catch(()=>setMessagesState('unavailable'));
    }
  },true);
  document.addEventListener('submit',event=>{
    if(event.target?.id==='requestForm')autofillVkClientRequest();
  },true);
}

window.__AUTO_SALE_INIT_VK_SHELL__=initVkMiniAppShell;
window.__AUTO_SALE_ENSURE_VK_MESSAGES__=ensureVkMessagesAllowed;
window.__AUTO_SALE_PREFILL_VK_CLIENT__=autofillVkClientRequest;
window.__AUTO_SALE_RENDER_VK_MESSAGES_HINT__=renderVkMessagesHint;
