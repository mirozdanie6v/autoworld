import {managerTelegramContact,managerTelegramIdentity} from './auto-sale-manager-directory.mjs';
const KEYS={leads:'auto-sale-leads-v2',quotes:'auto-sale-quotes-v2',orders:'auto-sale-orders-v2'};
const tg=window.Telegram?.WebApp;
try{tg?.ready?.()}catch{}

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'$'+new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(Number(value)||0);
const dateRu=value=>{if(!value)return'—';const d=new Date(`${value}T00:00:00`);return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'})};
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
const write=(key,value)=>{if(window.__AUTO_SALE_CACHE_WRITE__)window.__AUTO_SALE_CACHE_WRITE__(key,value);else localStorage.setItem(key,JSON.stringify(value))};
const leads=()=>read(KEYS.leads,[]);
const quotes=()=>read(KEYS.quotes,[]);
const orders=()=>read(KEYS.orders,[]);

function telegramIdentity(){
  const user=tg?.initDataUnsafe?.user;
  if(!user?.id)return null;
  const firstName=String(user.first_name||'').trim();
  const lastName=String(user.last_name||'').trim();
  const username=String(user.username||'').replace(/^@/,'').trim();
  const displayName=[firstName,lastName].filter(Boolean).join(' ')||username||`Telegram ${user.id}`;
  return{id:String(user.id),username,firstName,lastName,displayName,contact:username?`@${username}`:`Telegram ID ${user.id}`};
}
const currentTelegram=telegramIdentity();
window.__AUTO_SALE_TELEGRAM_USER__=currentTelegram;
const botMessagingAvailable=Boolean(tg?.initData&&currentTelegram?.id);
let managerRegistrationPromise=null;
function teamRows(){return read('auto-sale-team-v1',[])}
function registrationCandidate(){
  return teamRows().find(item=>item&&item.active!==false&&String(item.telegramUserId||'')===String(currentTelegram?.id||''))||null;
}
function showTelegramManagerStatus(data){
  const strip=document.querySelector('.auto-role-strip');
  if(!strip||!data?.ok)return;
  let badge=strip.querySelector('[data-telegram-manager-status]');
  if(!badge){badge=document.createElement('small');badge.dataset.telegramManagerStatus='1';strip.append(badge)}
  badge.innerHTML='Telegram подтверждён · <b>'+esc(data.member?.name||currentTelegram?.displayName||'')+'</b>';
  badge.dataset.state='connected';
}
async function registerCurrentManager(){
  if(!botMessagingAvailable)return null;
  const candidate=registrationCandidate();
  if(candidate){
    const data={ok:true,unchanged:true,access:'admin',telegramUserId:String(candidate.telegramUserId),username:String(candidate.telegramUsername||currentTelegram?.username||''),member:{id:candidate.id,name:candidate.name,role:candidate.role}};
    window.__AUTO_SALE_TELEGRAM_MANAGER__=data;
    showTelegramManagerStatus(data);
    return data;
  }
  if(managerRegistrationPromise)return managerRegistrationPromise;
  managerRegistrationPromise=fetch('/api/auto-sale/telegram/register-manager',{
    method:'POST',
    headers:{'content-type':'application/json','x-telegram-init-data':tg.initData},
    body:JSON.stringify({})
  }).then(async response=>{
    const data=await response.json().catch(()=>({}));
    if(response.status===403&&['admin_invite_required','manager_telegram_invite_mismatch'].includes(data.error))return null;
    if(!response.ok)throw Object.assign(new Error(data.error||'telegram_manager_registration_failed'),{data});
    window.__AUTO_SALE_TELEGRAM_MANAGER__=data;
    showTelegramManagerStatus(data);
    if(window.__AUTO_SALE_ACCESS__?.role!=='admin'&&data.access==='admin'){
      try{sessionStorage.setItem('auto-sale-role-v2','manager')}catch{}
      try{await window.__AUTO_SALE_REFRESH_STATE__?.()}catch{}
      location.reload();
      return data;
    }
    window.dispatchEvent(new CustomEvent('auto-sale-telegram-manager-registered',{detail:data}));
    return data;
  }).catch(error=>{
    console.warn('AUTO SALE Telegram manager registration failed',error);
    return null;
  }).finally(()=>{managerRegistrationPromise=null});
  return managerRegistrationPromise;
}
window.addEventListener('auto-sale-entity-synced',()=>{if(window.__AUTO_SALE_ACCESS__?.role==='admin')registerCurrentManager()});
window.addEventListener('auto-sale-server-synced',()=>{if(window.__AUTO_SALE_ACCESS__?.role==='admin')registerCurrentManager()});
if(botMessagingAvailable)setTimeout(()=>registerCurrentManager(),0);

function usernameFrom(value){const match=String(value||'').match(/(?:^|\s|\/)(?:@|t\.me\/)?([A-Za-z0-9_]{5,32})(?:$|\s|\?|\/)/i);return match?.[1]||''}
function clientTelegram(lead){
  const stored=String(lead.telegramUsername||'').replace(/^@/,'').trim();
  const contact=String(lead.contact||'').trim();
  const explicit=/^@[A-Za-z0-9_]{5,32}$/.test(contact)?contact.slice(1):(/^https?:\/\/t\.me\/[A-Za-z0-9_]{5,32}\/?$/i.test(contact)?contact.replace(/^https?:\/\/t\.me\//i,'').replace(/\/$/,''):'');
  return{username:stored||explicit,id:String(lead.telegramUserId||'')}
}
function managerTelegram(lead){
  const managerName=String(lead.manager||'').trim();
  const canonical=managerTelegramIdentity(managerName,teamRows());
  const member=teamRows().find(item=>item&&item.active!==false&&String(item.name||'').trim()===managerName);
  const username=String(canonical.username||lead.managerTelegramUsername||member?.telegramUsername||member?.telegram||'').replace(/^@/,'').trim();
  const id=String(canonical.id||lead.managerTelegramUserId||member?.telegramUserId||'').trim();
  return{username,id,name:String(canonical.name||lead.managerTelegramName||member?.name||managerName)}
}
function hasTelegram(contact){return Boolean(contact.username||contact.id)}
function openTelegram(contact){
  const username=String(contact?.username||'').replace(/^@/,'').trim();
  if(!/^[A-Za-z0-9_]{5,32}$/.test(username))return false;
  const selfUsername=String(currentTelegram?.username||'').replace(/^@/,'').trim().toLowerCase();
  if(selfUsername&&username.toLowerCase()===selfUsername)return false;
  const tgUrl=`https://t.me/${username}`;
  try{
    if(tg?.openTelegramLink){tg.openTelegramLink(tgUrl);return true}
    if(tg?.openLink){tg.openLink(tgUrl);return true}
  }catch(error){console.warn('AUTO SALE Telegram link open failed',error)}
  try{window.location.href=`tg://resolve?domain=${encodeURIComponent(username)}`;return true}catch{}
  try{window.location.assign(tgUrl);return true}catch{}
  return false;
}

function patchLead(id,patch){
  const rows=leads();const index=rows.findIndex(item=>item.id===id);if(index<0)return false;
  rows[index]={...rows[index],...patch};write(KEYS.leads,rows);return true;
}
function findNewestLead(match){
  return leads().filter(item=>(!match.name||item.name===match.name)&&(!match.contact||item.contact===match.contact)&&(!match.model||item.model===match.model)).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
}

function autofillClientRequest(){
  const form=document.querySelector('#requestForm');if(!form||form.elements.managerMode?.value!=='0'||form.dataset.telegramReady==='1')return;
  form.dataset.telegramReady='1';if(!currentTelegram)return;
  const name=form.elements.name,contact=form.elements.contact;
  if(name&&!name.value.trim()){name.value=currentTelegram.displayName;name.dataset.telegramAutofilled='1'}
  if(contact&&!contact.value.trim()){contact.value=currentTelegram.contact;contact.dataset.telegramAutofilled='1'}
  const note=document.createElement('div');note.className='auto-tg-hint full';note.innerHTML=`<span>Telegram</span><b>${esc(currentTelegram.displayName)}</b><small>${currentTelegram.username?`@${esc(currentTelegram.username)}`:`ID ${esc(currentTelegram.id)}`} · имя и контакт подставлены автоматически</small>`;
  const actions=form.querySelector('.auto-form-actions');actions?.before(note);
}

function enhanceManagerLead(){
  const form=document.querySelector('#leadEditForm');if(!form||form.dataset.telegramReady==='1')return;
  form.dataset.telegramReady='1';const id=form.elements.id?.value;const lead=leads().find(item=>item.id===id);if(!lead)return;
  const managerName=form.elements.manager?.value||lead.manager||'';
  const managerIdentity=managerTelegramIdentity(managerName,teamRows());
  const label=document.createElement('label');label.className='auto-tg-manager-field';label.innerHTML=`Telegram менеджера<input name="managerTelegram" readonly aria-readonly="true" value="${esc(managerIdentity.username?`@${managerIdentity.username}`:(lead.managerTelegramUsername?`@${lead.managerTelegramUsername}`:''))}"><small>Подставляется автоматически по выбранному ответственному</small>`;
  const managerLabel=form.elements.manager?.closest('label');managerLabel?.after(label);

  const contact=clientTelegram(lead);const side=document.querySelector('.auto-side-panel .auto-side-actions');
  if(side&&!side.querySelector('[data-tg-client]')){
    const button=document.createElement('button');button.type='button';button.className='auto-btn tg';button.dataset.tgClient=id;const direct=Boolean(contact.username&&String(contact.username).toLowerCase()!==String(currentTelegram?.username||'').toLowerCase());button.textContent=direct?'Открыть чат клиента':(contact.id?'Чат клиента · через бота':'Telegram клиента не указан');button.disabled=!direct;side.prepend(button);
  }
  if(side&&!side.querySelector('[data-tg-send][data-tg-target="client"]')){
    const button=document.createElement('button');button.type='button';button.className='auto-btn ghost';button.dataset.tgSend=id;button.dataset.tgTarget='client';button.textContent=botMessagingAvailable&&contact.id?'Отправить через бота':'Сообщение через бота недоступно';button.disabled=!(botMessagingAvailable&&contact.id);side.prepend(button);
  }
  const clientContact=form.elements.contact?.closest('label');
  if(clientContact&&hasTelegram(contact)&&!clientContact.querySelector('.auto-tg-inline')){
    const info=document.createElement('small');info.className='auto-tg-inline';info.textContent=contact.username?`Telegram: @${contact.username}`:`Telegram ID: ${contact.id}`;clientContact.append(info);
  }
  if(managerName)label.title=managerTelegramContact(managerName)?`Контакт ${managerTelegramContact(managerName)} привязан к менеджеру ${managerName}.`:'Для этого сотрудника Telegram-контакт не задан.';
}

function clientLeadRows(){return leads().filter(item=>item.clientCreated)}
function enhanceClientOrderCards(){
  const cards=[...document.querySelectorAll('.auto-order-card')];if(!cards.length)return;
  const rows=clientLeadRows();cards.forEach((card,index)=>{
    const lead=rows.find(item=>item.id===card.dataset.clientLead)||rows[index];if(!lead)return;
    if(!card.dataset.clientLead)card.dataset.clientLead=lead.id;
    card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',`Открыть заказ ${lead.model||lead.id}`);
    if(!card.querySelector('.auto-order-open-hint')){
      const hint=document.createElement('div');hint.className='auto-order-open-hint';hint.innerHTML='<span>Открыть подробности</span><strong>→</strong>';card.append(hint);
    }
  });
}

function syncSelectedManagerTelegram(form){
  const select=form?.elements?.manager;if(!select)return;
  const identity=managerTelegramIdentity(select.value,teamRows());
  let field=form.elements.managerTelegram;
  if(!field){
    const label=document.createElement('label');
    label.className='auto-tg-manager-field';
    label.dataset.managerTelegramAutoField='1';
    label.innerHTML='<span>Telegram менеджера</span><input name="managerTelegram" readonly aria-readonly="true"><small>Подставляется автоматически по выбранному ответственному</small>';
    select.closest('label')?.after(label);
    field=label.querySelector('input[name="managerTelegram"]');
  }
  if(field)field.value=identity.username?'@'+identity.username:'';
  let hint=form.querySelector('[data-manager-telegram-auto]');
  if(!hint){
    hint=document.createElement('small');
    hint.dataset.managerTelegramAuto='1';
    hint.className='auto-tg-inline';
    select.closest('label')?.append(hint);
  }
  if(hint)hint.textContent=identity.username?'Telegram: @'+identity.username:'Telegram не задан';
}
document.addEventListener('change',event=>{
  const select=event.target?.matches?.('select[name="manager"]')?event.target:null;
  if(!select)return;
  const form=select.closest('form');
  if(form?.id==='requestForm'||form?.id==='leadEditForm')syncSelectedManagerTelegram(form);
},true);
document.addEventListener('click',event=>{
  if(event.target?.matches?.('[data-manager-new],[data-lead]'))setTimeout(()=>{
    const form=document.querySelector('#requestForm,#leadEditForm');
    if(form)syncSelectedManagerTelegram(form);
  },0);
},true);

function quoteFor(leadId){return quotes().filter(item=>item.leadId===leadId).sort((a,b)=>(Number(b.version)||0)-(Number(a.version)||0))[0]}
function orderFor(leadId){return orders().find(item=>item.leadId===leadId)}
function stageSteps(active){
  const steps=['Запрос','Подбор','Расчёт','Согласование','Выкуп','Порт США','В море','Таможня','Доставка','Выдача'];
  const leadMap={'Новый':0,'В работе':1,'Расчёт':2,'Ожидает клиента':3,'Сделка':4,'Отказ':0};
  const idx=typeof active==='number'?active:Math.max(0,steps.indexOf(active));
  return `<div class="auto-client-track">${steps.map((step,i)=>`<span class="${i<=idx?'done':''}"><i>${i+1}</i><b>${step}</b></span>`).join('')}</div>`;
}
function clientDetail(lead){
  const quote=quoteFor(lead.id),order=orderFor(lead.id),manager=managerTelegram(lead);const stage=order?.stage||lead.status;const stageIndex=order?Math.max(0,['Запрос','Подбор','Расчёт','Согласование','Выкуп','Порт США','В море','Таможня','Доставка','Выдача'].indexOf(order.stage)):({'Новый':0,'В работе':1,'Расчёт':2,'Ожидает клиента':3,'Сделка':4,'Отказ':0}[lead.status]??0);
  return `<div class="auto-tg-modal-bg" data-client-detail-bg><div class="auto-tg-modal" role="dialog" aria-modal="true"><div class="auto-modal-head"><div><span class="auto-eyebrow">${esc(order?.id||lead.id)} · МОЙ ЗАКАЗ</span><h2>${esc(order?.model||lead.model||'Автомобиль')}</h2><p class="auto-modal-sub">Менеджер: ${esc(lead.manager||order?.manager||'назначается')} · ${esc(stage)}</p></div><button class="auto-close" type="button" data-client-detail-close>×</button></div>${stageSteps(stageIndex)}<div class="auto-client-order-grid"><div><span>Стоимость</span><b>${quote?.total?money(quote.total):lead.budget?`до ${money(lead.budget)}`:'по расчёту'}</b></div><div><span>Следующий шаг / ETA</span><b>${order?.eta?dateRu(order.eta):dateRu(lead.nextAction)}</b></div><div><span>LOT</span><b>${esc(order?.lot||'ещё не присвоен')}</b></div><div><span>VIN</span><b>${esc(order?.vin||'ещё не присвоен')}</b></div><div><span>Локация</span><b>${esc(order?.location||'—')}</b></div><div><span>Оплачено</span><b>${order?`${money(order.paid)} из ${money(order.total)}`:lead.deposit?money(lead.deposit):'—'}</b></div></div><div class="auto-client-request"><h3>Параметры заявки</h3><p>${esc(lead.yearFrom||'—')}–${esc(lead.yearTo||'—')} · пробег до ${esc(lead.mileageMax||'—')} км · ${esc(lead.engine||'Не важно')} · ${esc(lead.drive||'Не важно')}</p>${lead.note?`<small>${esc(lead.note)}</small>`:''}</div><div class="auto-actions"><button class="auto-btn tg" type="button" data-tg-manager="${esc(lead.id)}" ${hasTelegram(manager)?'':'disabled'}>${hasTelegram(manager)?'Открыть чат менеджера':'Telegram менеджера ещё не указан'}</button><button class="auto-btn ghost" type="button" data-tg-send="${esc(lead.id)}" data-tg-target="manager" ${botMessagingAvailable&&manager.id?'':'disabled'}>${botMessagingAvailable&&manager.id?'Отправить через бота':'Сообщение через бота недоступно'}</button><button class="auto-btn ghost" type="button" data-client-detail-close>Закрыть</button></div></div></div>`;
}
function showClientDetail(id){const lead=leads().find(item=>item.id===id);if(!lead)return;document.querySelector('[data-client-detail-bg]')?.remove();document.body.insertAdjacentHTML('beforeend',clientDetail(lead))}
function closeClientDetail(){document.querySelector('[data-client-detail-bg]')?.remove()}
function refreshOpenClientDetail(){
  const modal=document.querySelector('[data-client-detail-bg]');if(!modal)return;
  const id=modal.querySelector('[data-tg-manager]')?.dataset.tgManager||modal.querySelector('[data-tg-send][data-tg-target="manager"]')?.dataset.tgSend;
  if(id)showClientDetail(id);
}
window.addEventListener('auto-sale-server-synced',()=>queueMicrotask(refreshOpenClientDetail));
window.addEventListener('auto-sale-entity-synced',()=>queueMicrotask(refreshOpenClientDetail));

let pendingClient=null;let pendingManager=null;
document.addEventListener('submit',event=>{
  const form=event.target;
  if(form?.id==='requestForm'){
    const managerMode=form.elements.managerMode?.value==='1';
    if(!managerMode&&currentTelegram){
      if(!form.elements.name.value.trim())form.elements.name.value=currentTelegram.displayName;
      if(!form.elements.contact.value.trim())form.elements.contact.value=currentTelegram.contact;
      pendingClient={name:form.elements.name.value.trim(),contact:form.elements.contact.value.trim(),model:form.elements.model.value.trim(),telegram:currentTelegram};
      setTimeout(async()=>{if(!pendingClient)return;const pending=pendingClient;const lead=findNewestLead(pending);pendingClient=null;if(!lead)return;
        const identity={telegramUserId:pending.telegram.id,telegramUsername:pending.telegram.username,telegramFirstName:pending.telegram.firstName,telegramLastName:pending.telegram.lastName,telegramDisplayName:pending.telegram.displayName,contact:pending.contact};
        patchLead(lead.id,identity);
        try{
          // The lead is created by the entity API first; link-client is a second entity-level binding operation.
          let linked=null,lastError=null;
          for(let attempt=0;attempt<8;attempt++){
            if(attempt)await new Promise(resolve=>setTimeout(resolve,150+attempt*100));
            const response=await fetch('/api/auto-sale/telegram/link-client',{method:'POST',headers:{'content-type':'application/json','x-telegram-init-data':tg.initData},body:JSON.stringify({leadId:lead.id})});
            const data=await response.json().catch(()=>({}));
            if(response.ok){linked=data;break}
            lastError=Object.assign(new Error(data.error||'telegram_client_link_failed'),{status:response.status,data});
            if(![404,409].includes(response.status))break;
          }
          if(!linked)throw lastError||new Error('telegram_client_link_failed');
          patchLead(lead.id,identity);
          window.dispatchEvent(new CustomEvent('auto-sale-telegram-lead-linked',{detail:{leadId:lead.id,revision:linked.revision}}));
        }catch(error){console.warn('AUTO SALE Telegram client link failed',error)}
      },250);
    }
    if(managerMode){const selectedManager=String(form.elements.manager?.value||'').trim(),managerIdentity=managerTelegramIdentity(selectedManager,teamRows());if(managerIdentity.username)pendingManager={name:form.elements.name.value.trim(),contact:form.elements.contact.value.trim(),model:form.elements.model.value.trim(),managerTelegram:'@'+managerIdentity.username,managerName:selectedManager,managerId:managerIdentity.id};}
  }
  if(form?.id==='leadEditForm'){
    const id=form.elements.id?.value,managerName=String(form.elements.manager?.value||'').trim(),identity=managerTelegramIdentity(managerName,teamRows());pendingManager={id,managerTelegram:identity.username?'@'+identity.username:'',managerName,managerId:identity.id};
    setTimeout(()=>{if(!pendingManager?.id)return;const username=usernameFrom(pendingManager.managerTelegram)||String(pendingManager.managerTelegram||'').replace(/^@/,'').trim();patchLead(pendingManager.id,{managerTelegramUsername:username,managerTelegramUserId:String(pendingManager.managerId||''),managerTelegramName:pendingManager.managerName});pendingManager=null},0);
  }
},true);

document.addEventListener('submit',async event=>{
  const form=event.target;if(form?.id!=='telegramMessageForm')return;
  event.preventDefault();
  const status=form.querySelector('[data-tg-compose-status]'),button=form.querySelector('button[type="submit"]');
  const data=Object.fromEntries(new FormData(form).entries());
  if(status){status.textContent='Отправляю…';status.dataset.state='loading'}
  if(button)button.disabled=true;
  try{
    await sendBotMessage(data.leadId,data.target,data.message);
    if(status){status.textContent='Сообщение отправлено';status.dataset.state='success'}
    setTimeout(closeMessageComposer,650);
  }catch(error){
    if(status){status.textContent=error.message||'Не удалось отправить сообщение';status.dataset.state='error'}
    if(button)button.disabled=false;
  }
},true);

async function sendBotMessage(leadId,target,message){
  if(!botMessagingAvailable)throw new Error('Откройте приложение внутри Telegram, чтобы отправлять сообщения через бота.');
  const response=await fetch('/api/auto-sale/telegram/message',{
    method:'POST',
    headers:{'content-type':'application/json','x-telegram-init-data':tg.initData},
    body:JSON.stringify({leadId,target,text:message})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const map={
      telegram_not_configured:'Telegram-бот ещё не подключён на сервере.',
      client_telegram_not_linked:'Клиент ещё не открыл Mini App через Telegram.',
      manager_telegram_not_linked:'Telegram менеджера ещё не привязан.',
      telegram_sender_forbidden:'Этот Telegram-пользователь не привязан к данной сделке.',
      telegram_init_data_expired:'Сессия Telegram устарела. Закройте и заново откройте Mini App.'
    };
    const detail=[map[data.error]||data.error||'Не удалось отправить сообщение через Telegram.',data.telegramDescription,data.detail].filter(Boolean).join(' · ');throw new Error(detail);
  }
  return data;
}
function closeMessageComposer(){document.querySelector('[data-tg-compose-bg]')?.remove()}
function openMessageComposer(leadId,target){
  closeMessageComposer();
  const lead=leads().find(item=>item.id===leadId);if(!lead)return;
  const recipient=target==='client'?(lead.name||'клиент'):(lead.manager||'менеджер');
  document.body.insertAdjacentHTML('beforeend',`<div class="auto-tg-compose-bg" data-tg-compose-bg><form class="auto-tg-compose" id="telegramMessageForm"><div class="auto-modal-head"><div><span class="auto-eyebrow">TELEGRAM · AUTO МИР</span><h3>Сообщение: ${esc(recipient)}</h3><p>Сообщение будет отправлено через бота от имени AUTO МИР.</p></div><button class="auto-close" type="button" data-tg-compose-close>×</button></div><input type="hidden" name="leadId" value="${esc(leadId)}"><input type="hidden" name="target" value="${esc(target)}"><label>Сообщение<textarea name="message" maxlength="1500" rows="5" required placeholder="Введите сообщение клиенту или менеджеру"></textarea></label><div class="auto-tg-compose-status" data-tg-compose-status></div><div class="auto-actions"><button class="auto-btn primary" type="submit">Отправить</button><button class="auto-btn ghost" type="button" data-tg-compose-close>Отмена</button></div></form></div>`);
  queueMicrotask(()=>document.querySelector('#telegramMessageForm textarea')?.focus());
}
function enhanceManagerOrder(){
  const form=document.querySelector('#orderForm');if(!form||form.dataset.telegramMessaging==='1')return;
  form.dataset.telegramMessaging='1';
  const order=orders().find(item=>item.id===form.elements.id?.value),lead=order?leads().find(item=>item.id===order.leadId):null;
  if(!lead)return;
  const contact=clientTelegram(lead),actions=form.querySelector('.auto-actions');
  if(actions&&!actions.querySelector('[data-tg-send][data-tg-target="client"]')){
    const button=document.createElement('button');button.type='button';button.className='auto-btn ghost';button.dataset.tgSend=lead.id;button.dataset.tgTarget='client';button.textContent=botMessagingAvailable&&contact.id?'Сообщение клиенту через бота':'Telegram-бот недоступен';button.disabled=!(botMessagingAvailable&&contact.id);actions.append(button);
  }
}

document.addEventListener('click',event=>{
  const sendButton=event.target.closest('[data-tg-send]');if(sendButton){event.preventDefault();event.stopPropagation();openMessageComposer(sendButton.dataset.tgSend,sendButton.dataset.tgTarget);return}
  const composeClose=event.target.closest('[data-tg-compose-close]');if(composeClose){event.preventDefault();closeMessageComposer();return}
  if(event.target.matches('[data-tg-compose-bg]')){closeMessageComposer();return}
  const clientButton=event.target.closest('[data-tg-client]');if(clientButton){event.preventDefault();event.stopPropagation();const lead=leads().find(item=>item.id===clientButton.dataset.tgClient);if(lead)openTelegram(clientTelegram(lead));return}
  const managerButton=event.target.closest('[data-tg-manager]');if(managerButton){event.preventDefault();event.stopPropagation();const lead=leads().find(item=>item.id===managerButton.dataset.tgManager);if(lead){const contact=managerTelegram(lead);if(!openTelegram(contact)&&contact.username){const url='https://t.me/'+encodeURIComponent(contact.username);try{window.location.href=url}catch{}}}return}
  const close=event.target.closest('[data-client-detail-close]');if(close){event.preventDefault();closeClientDetail();return}
  if(event.target.matches('[data-client-detail-bg]')){closeClientDetail();return}
  const card=event.target.closest('.auto-order-card[data-client-lead]');if(card&&!event.target.closest('button,a,input,select,textarea')){showClientDetail(card.dataset.clientLead)}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&document.querySelector('[data-client-detail-bg]')){closeClientDetail();return}
  const card=event.target.closest?.('.auto-order-card[data-client-lead]');if(card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();showClientDetail(card.dataset.clientLead)}
});

function injectStyles(){if(document.getElementById('autoSaleTelegramStyles'))return;const style=document.createElement('style');style.id='autoSaleTelegramStyles';style.textContent=`
.auto-order-card[data-client-lead]{cursor:pointer;transition:transform .16s ease,border-color .16s ease}.auto-order-card[data-client-lead]:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.28)}.auto-order-card[data-client-lead]:focus-visible{outline:2px solid currentColor;outline-offset:3px}.auto-order-open-hint{display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;opacity:.75}.auto-btn.tg{background:#229ED9;color:#fff;border-color:#229ED9}.auto-btn.tg:disabled{opacity:.45;cursor:not-allowed}.auto-tg-hint{display:grid;gap:2px;padding:12px 14px;border:1px solid rgba(34,158,217,.32);border-radius:14px;background:rgba(34,158,217,.08)}.auto-tg-hint span{font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.7}.auto-tg-hint small,.auto-tg-inline,.auto-tg-manager-field small{font-size:12px;opacity:.68}.auto-tg-modal-bg{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.72);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:18px}.auto-tg-modal{width:min(760px,100%);max-height:92dvh;overflow:auto;background:#101318;border:1px solid rgba(255,255,255,.13);border-radius:24px;padding:20px;box-shadow:0 24px 80px rgba(0,0,0,.45)}.auto-client-track{display:flex;gap:7px;overflow-x:auto;padding:14px 0 18px;scrollbar-width:none}.auto-client-track span{min-width:84px;display:grid;gap:5px;opacity:.38}.auto-client-track span.done{opacity:1}.auto-client-track i{width:25px;height:25px;border-radius:50%;display:grid;place-items:center;font-style:normal;border:1px solid rgba(255,255,255,.25);font-size:11px}.auto-client-track .done i{background:#fff;color:#0b0d10}.auto-client-track b{font-size:11px;font-weight:600}.auto-client-order-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.auto-client-order-grid>div{padding:13px;border:1px solid rgba(255,255,255,.1);border-radius:14px;display:grid;gap:5px}.auto-client-order-grid span{font-size:11px;opacity:.58}.auto-client-order-grid b{font-size:14px}.auto-client-request{margin-top:14px;padding:15px;border:1px solid rgba(255,255,255,.1);border-radius:14px}.auto-client-request h3{margin:0 0 7px}.auto-client-request p{margin:0}.auto-client-request small{display:block;margin-top:8px;opacity:.68}.auto-tg-compose-bg{position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,.76);backdrop-filter:blur(8px);display:grid;place-items:center;padding:18px}.auto-tg-compose{width:min(560px,100%);display:grid;gap:14px;padding:20px;border:1px solid rgba(255,255,255,.13);border-radius:22px;background:#101318;box-shadow:0 24px 80px rgba(0,0,0,.5)}.auto-tg-compose label{display:grid;gap:7px}.auto-tg-compose textarea{width:100%;resize:vertical;min-height:120px}.auto-tg-compose-status{min-height:18px;font-size:12px;color:rgba(255,255,255,.65)}.auto-tg-compose-status[data-state="success"]{color:#2fd38a}.auto-tg-compose-status[data-state="error"]{color:#ff6b6b}
@media(max-width:720px){.auto-tg-modal-bg,.auto-tg-compose-bg{align-items:flex-end;padding:0}.auto-tg-modal,.auto-tg-compose{border-radius:22px 22px 0 0;max-height:94dvh;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}.auto-client-order-grid{grid-template-columns:1fr 1fr}}@media(max-width:390px){.auto-client-order-grid{grid-template-columns:1fr}}
`;document.head.append(style)}

let scheduled=false;function enhance(){scheduled=false;injectStyles();autofillClientRequest();enhanceManagerLead();enhanceManagerOrder();enhanceClientOrderCards()}
function scheduleEnhance(){if(scheduled)return;scheduled=true;queueMicrotask(enhance)}
const observer=new MutationObserver(scheduleEnhance);observer.observe(document.getElementById('app'),{childList:true,subtree:true});
scheduleEnhance();

if(!document.getElementById('autoSaleTelegramManagerBindStyles')){const style=document.createElement('style');style.id='autoSaleTelegramManagerBindStyles';style.textContent=`[data-telegram-manager-status][data-state="pending"]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}[data-telegram-manager-status] select{min-width:150px;max-width:220px;background:#101925;color:#eef4fb;border:1px solid #304258;border-radius:9px;padding:7px 9px;font:inherit}[data-telegram-manager-status] button{background:#1976b9;color:white;border:1px solid #3996d4;border-radius:9px;padding:7px 10px;font-weight:700}[data-telegram-manager-status][data-state="connected"]{color:#7bd8a9;margin-top:8px}`;document.head.append(style)}
