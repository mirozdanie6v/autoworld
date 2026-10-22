import {normalizeVkWebProfile,applyVkWebProfileToRequestForm} from './auto-sale-vk-web-profile.mjs';

// VK ID browser login at request submission. Mini Apps retain their existing authentication.
const DRAFT_KEY='awg-vk-web-request-draft-v1';
const query=new URLSearchParams(location.search);
const isEmbedded=Boolean(window.Telegram?.WebApp?.initData)||['vk_app_id','vk_user_id','sign'].every(k=>query.has(k));
let webEnabled=false;
let webAuthenticated=false;
const plainWeb=!isEmbedded;
if(plainWeb){
  try{
    const response=await fetch('/api/auto-sale/vk/web/config',{credentials:'same-origin',cache:'no-store'});
    if(response.ok){
      const data=await response.json();
      webEnabled=Boolean(data.enabled);
      webAuthenticated=Boolean(data.authenticated);
    }
  }catch{}
}
function snapshot(form){
  const values={};
  for(const field of form.elements||[]){
    if(!field.name||!['INPUT','SELECT','TEXTAREA'].includes(field.tagName))continue;
    if(['file','password'].includes(field.type))continue;
    values[field.name]=field.value;
  }
  return values;
}
function beginLogin(form){
  sessionStorage.setItem(DRAFT_KEY,JSON.stringify({values:snapshot(form),at:Date.now()}));
  location.assign('/api/auto-sale/vk/web/start');
}
if(plainWeb&&webEnabled&&!webAuthenticated){
  const placeLogin=()=>{
    const form=document.getElementById('requestForm');
    if(!form||form.elements?.managerMode?.value!=='0'||form.querySelector('[data-vk-web-login]'))return;
    const actions=form.querySelector('.auto-form-actions');
    if(!actions)return;
    const button=document.createElement('button');
    button.type='button';
    button.dataset.vkWebLogin='1';
    button.textContent='Продолжить с VK ID';
    button.className='auto-btn primary';
    button.style.cssText='background:#0077ff;color:white;width:100%;margin-top:12px';
    button.addEventListener('click',()=>beginLogin(form));
    actions.before(button);
  };
  placeLogin();
  new MutationObserver(placeLogin).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});

  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form?.id!=='requestForm'||form.elements?.managerMode?.value!=='0')return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginLogin(form);
  },true);
}
if(plainWeb&&webEnabled&&webAuthenticated){
  const draft=(()=>{try{return JSON.parse(sessionStorage.getItem(DRAFT_KEY)||'null')}catch{return null}})();
  if(draft&&Date.now()-draft.at<15*60*1000){
    const restore=()=>{
      let form=document.getElementById('requestForm');
      const fromCatalog=draft.values?.catalogIntent==='catalog'&&!!draft.values?.carId;
      if(fromCatalog){
        const id=String(draft.values.carId);
        const locate=()=>[...document.querySelectorAll('[data-request-car]')].find(node=>node.dataset.requestCar===id);
        let button=locate();
        if(!button){
          document.querySelector('[data-go="catalog"]')?.click();
          button=locate();
        }
        if(!button){
          // Never restore catalog draft through "Подобрать автомобиль": doing so
          // silently turns a selected car into a generic lead after VK OAuth.
          const app=document.getElementById('app');
          if(app&&!app.querySelector('[data-catalog-login-restore-error]')){
            const warning=document.createElement('p');
            warning.dataset.catalogLoginRestoreError='1';
            warning.className='auto-form-error';
            warning.setAttribute('role','alert');
            warning.textContent='Исходный автомобиль недоступен. Откройте карточку в каталоге заново и нажмите «Рассчитать».';
            app.prepend(warning);
          }
          return false;
        }
        if(!form||form.elements?.carId?.value!==id){
          button.click();form=document.getElementById('requestForm');
        }
        if(!form||form.elements.carId?.value!==id||form.elements.catalogIntent?.value!=='catalog')return false;
      }else if(!form){
        const button=document.querySelector('[data-open-request]');
        if(button){button.click();form=document.getElementById('requestForm')}
      }
      if(!form)return false;
      const editable=fromCatalog?new Set(['name','contact','damage','deliveryCity','note']):null;
      for(const [name,value] of Object.entries(draft.values||{})){
        if(name==='managerMode'||name==='carId'||name==='catalogIntent'||name==='catalogUsdRubRate')continue;
        if(editable&&!editable.has(name))continue;
        if(form.elements?.[name])form.elements[name].value=value;
      }
      sessionStorage.removeItem(DRAFT_KEY);
      return true;
    };
    if(!restore()){
      const watcher=new MutationObserver(()=>{if(restore())watcher.disconnect()});
      watcher.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
      setTimeout(()=>watcher.disconnect(),8000);
    }
  }
}


// Autofill only after the server validates our HttpOnly signed VK session.
// The profile never comes from query parameters or browser local storage.
if(plainWeb&&webEnabled&&webAuthenticated){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),6000);
  void fetch('/api/auto-sale/vk/web/profile',{
    credentials:'same-origin',
    cache:'no-store',
    headers:{accept:'application/json'},
    signal:controller.signal
  })
    .then(async response=>response.ok?response.json():null)
    .then(payload=>{
      const profile=normalizeVkWebProfile(payload);
      if(!profile)return;
      const apply=()=>applyVkWebProfileToRequestForm(document.getElementById('requestForm'),profile);
      apply();
      new MutationObserver(apply).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
    })
    .catch(()=>{}) // Never block the request form if the VK profile request fails.
    .finally(()=>clearTimeout(timeout));
}
