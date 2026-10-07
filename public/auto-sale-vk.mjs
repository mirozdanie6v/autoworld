const hasVkLaunch=()=>{
  const params=new URLSearchParams(window.location.search||'');
  return Boolean(params.get('vk_app_id')&&params.get('vk_user_id')&&params.get('sign'));
};

let bridgePromise=null;
let configPromise=null;

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
    script.src='https://unpkg.com/@vkontakte/vk-bridge@3.0.2/dist/browser.min.js';
    script.async=true;
    script.crossOrigin='anonymous';
    script.referrerPolicy='no-referrer';
    script.onload=()=>window.vkBridge?resolve(window.vkBridge):reject(new Error('vk_bridge_global_missing'));
    script.onerror=()=>reject(new Error('vk_bridge_load_failed'));
    document.head.appendChild(script);
  });
  return bridgePromise;
}

export async function ensureVkMessagesAllowed(){
  if(!hasVkLaunch())return{ok:true,skipped:'not-vk'};
  if(sessionStorage.getItem('auto-sale-vk-messages-allowed')==='1')return{ok:true,cached:true};
  const config=await vkConfig();
  if(!config?.enabled||!config?.groupId)return{ok:false,skipped:'vk-messaging-not-configured'};
  try{
    const bridge=await loadBridge();
    await bridge.send('VKWebAppInit');
    await bridge.send('VKWebAppAllowMessagesFromGroup',{group_id:Number(config.groupId)});
    sessionStorage.setItem('auto-sale-vk-messages-allowed','1');
    return{ok:true};
  }catch(error){
    console.warn('AUTO SALE VK messages permission not granted',String(error?.message||error));
    return{ok:false,error:'vk_messages_permission_not_granted'};
  }
}

window.__AUTO_SALE_ENSURE_VK_MESSAGES__=ensureVkMessagesAllowed;
