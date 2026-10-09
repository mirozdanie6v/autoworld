// Compact, staging-only VK sign-in status. Never trust unsigned launch parameters.
const STAGING_HOST='vk-test.awgcars.ru';
export const isVkStatusStagingHost=host=>host===STAGING_HOST;
const asName=value=>String(value||'').trim().slice(0,120);
export function deriveVkStatus({mode='web',config=null,profile=null,access=null,vkUser=null}={}){
  if(mode==='mini'){
    const verified=access?.authenticated===true && access?.identity?.provider==='vk' &&
      /^\d+$/.test(String(access.identity.id||'')) && access?.authType==='vk';
    return verified?{status:'in',name:asName(vkUser?.displayName)||asName([access.user?.first_name,access.user?.last_name].filter(Boolean).join(' ')),mode}
      :{status:access?.authenticated===false?'out':'pending',name:'',mode};
  }
  if(config?.enabled===false)return{status:'unavailable',name:'',mode};
  if(config?.enabled!==true)return{status:'pending',name:'',mode};
  if(config.authenticated!==true)return{status:'out',name:'',mode};
  return{status:'in',name:asName(profile?.name),mode};
}

function createWidget(document){
  const root=document.createElement('div');
  root.className='auto-vk-status';
  root.dataset.vkStatusWidget='1';
  root.innerHTML='<button type="button" class="auto-vk-status-trigger" data-vk-status-trigger aria-haspopup="true" aria-expanded="false"><span class="auto-vk-status-mark" aria-hidden="true">VK</span><span class="auto-vk-status-dot" aria-hidden="true"></span><span class="auto-vk-status-caption" data-vk-status-caption>Проверяем</span></button><div class="auto-vk-status-panel" data-vk-status-panel hidden><strong>Вход ВКонтакте</strong><p data-vk-status-message></p><div class="auto-vk-status-panel-actions" data-vk-status-actions></div></div>';
  return root;
}

export function initializeVkStatusWidget({
  win=window,doc=document,fetchImpl=fetch,mode=null
}={}){
  if(!isVkStatusStagingHost(win.location?.hostname))return null;
  const query=new URLSearchParams(win.location.search||'');
  const mini=mode==='mini'||(mode===null&&['vk_app_id','vk_user_id','sign'].every(key=>query.has(key)));
  const currentMode=mini?'mini':'web';
  const root=createWidget(doc),button=root.querySelector('[data-vk-status-trigger]'),panel=root.querySelector('[data-vk-status-panel]');
  const caption=root.querySelector('[data-vk-status-caption]');
  const message=root.querySelector('[data-vk-status-message]');
  const actions=root.querySelector('[data-vk-status-actions]');
  let state={status:'pending',name:'',mode:currentMode};
  let destroyed=false;
  const style=doc.createElement('link');
  style.rel='stylesheet';
  style.href='./auto-sale-vk-status-widget.css?v=20261010-staging-v1';
  style.dataset.vkStatusStyle='1';
  if(!doc.querySelector('[data-vk-status-style]'))doc.head.appendChild(style);

  function attach(){
    if(destroyed)return;
    const topbar=doc.querySelector('#app .auto-topbar');
    if(topbar&&root.parentElement!==topbar)topbar.appendChild(root);
  }
  let scheduled=false;
  const observer=new MutationObserver(()=>{
    if(scheduled)return;
    scheduled=true;
    queueMicrotask(()=>{scheduled=false;attach()});
  });
  const app=doc.getElementById('app');
  if(app)observer.observe(app,{subtree:true,childList:true});
  attach();

  const labels={in:'Вошли',out:currentMode==='mini'?'Нет входа':'Войти',pending:'Проверяем',unavailable:'Недоступно'};
  function paint(){
    root.dataset.vkStatus=state.status;
    caption.textContent=labels[state.status];
    button.setAttribute('aria-label',state.status==='in'
      ?'ВКонтакте: вход выполнен'+(state.name?' — '+state.name:'')
      :state.status==='out'?'ВКонтакте: не выполнен вход; нажмите, чтобы войти'
      :'ВКонтакте: '+labels[state.status].toLowerCase());
    const inVk=state.status==='in';
    const title=inVk?'Вы вошли через ВКонтакте'
      :state.status==='pending'?'Проверяем авторизацию ВКонтакте…'
      :state.status==='unavailable'?'Вход VK ID сейчас недоступен'
      :'Вход через ВКонтакте не выполнен';
    message.textContent=state.name&&inVk?title+' · '+state.name:title;
    actions.replaceChildren();
    if(currentMode==='web'&&state.status==='in'){
      const exit=doc.createElement('button');
      exit.type='button';exit.textContent='Выйти из VK ID';exit.dataset.vkStatusLogout='1';
      actions.appendChild(exit);
    }else if(currentMode==='web'&&state.status==='out'){
      const login=doc.createElement('button');
      login.type='button';login.textContent='Войти через VK ID';login.dataset.vkStatusLogin='1';
      actions.appendChild(login);
    }else if(currentMode==='mini'&&state.status==='out'){
      message.textContent='Не удалось подтвердить вход. Откройте мини-приложение через ВКонтакте.';
    }
  }
  const setState=next=>{state=next;paint()};
  paint();

  function accessStatus(){
    if(currentMode!=='mini')return;
    const access=win.__AUTO_SALE_ACCESS__;
    if(!access||(!access.authenticated&&access.role==='public'&&!win.__AUTO_SALE_SERVER__))return;
    setState(deriveVkStatus({mode:'mini',access,vkUser:win.__AUTO_SALE_VK_USER__}));
  }

  async function checkWeb(){
    if(currentMode!=='web')return;
    try{
      const response=await fetchImpl('/api/auto-sale/vk/web/config',{
        credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'},
        signal:AbortSignal.timeout(7000)
      });
      if(!response.ok)throw Error('config_error');
      const config=await response.json();
      let profile=null;
      if(config.enabled===true&&config.authenticated===true){
        const details=await fetchImpl('/api/auto-sale/vk/web/profile',{
          credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'},
          signal:AbortSignal.timeout(7000)
        });
        if(details.ok){
          const data=await details.json();
          if(data?.authenticated&&/^\d+$/.test(String(data.user?.id||''))){
            profile={name:[data.user.firstName,data.user.lastName].filter(Boolean).join(' ')};
          }
        }
      }
      if(!destroyed)setState(deriveVkStatus({mode:'web',config,profile}));
    }catch{
      if(!destroyed)setState({status:'unavailable',name:'',mode:'web'});
    }
  }

  const onSync=()=>accessStatus();
  win.addEventListener('auto-sale-server-synced',onSync);
  const onVisibility=()=>{if(!doc.hidden)void(currentMode==='web'?checkWeb():accessStatus())};
  doc.addEventListener('visibilitychange',onVisibility);
  const interval=mini?setInterval(accessStatus,800):null;
  const endMiniWait=mini?setTimeout(()=>clearInterval(interval),12000):null;
  if(mini)accessStatus();
  else void checkWeb();

  async function logout(){
    const res=await fetchImpl('/api/auto-sale/vk/web/logout',{
      method:'POST',credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}
    });
    if(!res.ok)throw Error('logout_failed');
    // Re-fetch full filtered state; never leave another user's requests in cache.
    win.location.assign('/');
  }
  const click=event=>{
    if(event.target.closest('[data-vk-status-login]')){
      win.location.assign('/api/auto-sale/vk/web/start');return;
    }
    if(event.target.closest('[data-vk-status-logout]')){
      message.textContent='Выходим из VK ID…';
      void logout().catch(()=>{message.textContent='Не удалось выйти. Повторите попытку.'});
      return;
    }
    if(!event.target.closest('[data-vk-status-trigger]'))return;
    if(state.status==='out'&&currentMode==='web'){
      win.location.assign('/api/auto-sale/vk/web/start');
      return;
    }
    panel.hidden=!panel.hidden;
    button.setAttribute('aria-expanded',String(!panel.hidden));
  };
  const outside=event=>{
    if(root.contains(event.target))return;
    panel.hidden=true;
    button.setAttribute('aria-expanded','false');
  };
  root.addEventListener('click',click);
  doc.addEventListener('click',outside);
  return{root,getState:()=>({...state}),refresh:()=>currentMode==='web'?checkWeb():accessStatus(),destroy(){
    destroyed=true;observer.disconnect();win.removeEventListener('auto-sale-server-synced',onSync);
    doc.removeEventListener('click',outside);doc.removeEventListener('visibilitychange',onVisibility);
    if(interval)clearInterval(interval);
    if(endMiniWait)clearTimeout(endMiniWait);root.remove();
  }};
}
if(typeof window!=='undefined'&&typeof document!=='undefined'&&isVkStatusStagingHost(window.location?.hostname)){
  initializeVkStatusWidget();
}
