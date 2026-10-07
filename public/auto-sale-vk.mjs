const hasVkLaunch=()=>{
  const params=new URLSearchParams(window.location.search||'');
  return Boolean(params.get('vk_app_id')&&params.get('vk_user_id')&&params.get('sign'));
};

let bridgePromise=null;
let configPromise=null;
let initPromise=null;

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
    script.src='/vendor/vk-bridge-3.0.2.min.js';
    script.async=true;
    script.onload=()=>window.vkBridge?resolve(window.vkBridge):reject(new Error('vk_bridge_global_missing'));
    script.onerror=()=>reject(new Error('vk_bridge_load_failed'));
    document.head.appendChild(script);
  });
  return bridgePromise;
}

export async function initVkMiniAppShell(){
  if(!hasVkLaunch())return{ok:true,skipped:'not-vk'};
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    try{
      const bridge=await loadBridge();
      await bridge.send('VKWebAppInit');
      const result={ok:true};
      window.__AUTO_SALE_VK_SHELL__=result;
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

export async function ensureVkMessagesAllowed(){
  if(!hasVkLaunch())return{ok:true,skipped:'not-vk'};
  const shell=await initVkMiniAppShell();
  if(!shell.ok)return shell;
  if(sessionStorage.getItem('auto-sale-vk-messages-allowed')==='1')return{ok:true,cached:true};
  const config=await vkConfig();
  if(!config?.enabled||!config?.groupId)return{ok:false,skipped:'vk-messaging-not-configured'};
  try{
    const bridge=await loadBridge();
    await bridge.send('VKWebAppAllowMessagesFromGroup',{group_id:Number(config.groupId)});
    sessionStorage.setItem('auto-sale-vk-messages-allowed','1');
    return{ok:true};
  }catch(error){
    console.warn('AUTO SALE VK messages permission not granted',String(error?.message||error));
    return{ok:false,error:'vk_messages_permission_not_granted'};
  }
}

window.__AUTO_SALE_INIT_VK_SHELL__=initVkMiniAppShell;
window.__AUTO_SALE_ENSURE_VK_MESSAGES__=ensureVkMessagesAllowed;
