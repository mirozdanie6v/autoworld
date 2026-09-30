import {ACTIVE_LEAD_STATUSES,orderRequiredFields} from './auto-sale-business-rules.mjs';

const FORM_SELECTOR='#requestForm,#leadEditForm,#quoteForm,#orderForm,#clientEditForm';
const REQUIRED_TAG='Обязательно';

const style=document.createElement('style');
style.id='auto-required-fields-style';
style.textContent=`
.auto-form label.auto-required-label{position:relative}
.auto-required-tag{display:inline-flex;align-items:center;min-height:18px;margin-left:7px;padding:1px 6px;border:1px solid rgba(255,179,71,.42);border-radius:999px;background:rgba(255,179,71,.08);color:#ffbd63;font-size:8px;font-weight:900;line-height:1.2;letter-spacing:.04em;text-transform:uppercase;vertical-align:1px}
.auto-required-field:not(.auto-field-blocked){border-color:rgba(255,179,71,.48)!important;box-shadow:0 0 0 1px rgba(255,179,71,.08)!important}
.auto-field-blocked{border-color:#ff6b72!important;background:rgba(255,84,95,.08)!important;box-shadow:0 0 0 3px rgba(255,84,95,.12)!important}
.auto-blocked-label{color:#ff8b91!important}
.auto-field-blocker{display:block;margin-top:5px;color:#ff8b91;font-size:9px;font-weight:750;line-height:1.35}
.auto-inline-fields .auto-field-blocked{border-color:#ff6b72!important}
`;
if(!document.getElementById(style.id))document.head.append(style);

const fields=form=>[...form.querySelectorAll('input[name],select[name],textarea[name]')].filter(el=>el.type!=='hidden'&&!el.disabled&&!el.closest('.auto-conditional-hidden'));
const get=(form,name)=>form.elements?.namedItem?.(name)||null;
const text=el=>String(el?.value??'').trim();
const num=el=>Number(el?.value)||0;
const labelOf=el=>el?.closest?.('label')||null;
const today=()=>new Date().toISOString().slice(0,10);
const readLocal=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};

function ensureTag(el,on){
  const label=labelOf(el);if(!label)return;
  if(on){
    label.classList.add('auto-required-label');
    if(!label.querySelector('.auto-required-tag')){
      const tag=document.createElement('span');tag.className='auto-required-tag';tag.textContent=REQUIRED_TAG;
      const anchor=[...label.children].find(x=>x.matches?.('input,select,textarea,.auto-inline-fields'))||label.firstElementChild;
      if(anchor)label.insertBefore(tag,anchor);else label.append(tag);
    }
    el.classList.add('auto-required-field');
  }else{
    el.classList.remove('auto-required-field');
    const related=[...label.querySelectorAll('input[name],select[name],textarea[name]')].some(x=>x!==el&&x.classList.contains('auto-required-field'));
    if(!related){label.classList.remove('auto-required-label');label.querySelector('.auto-required-tag')?.remove()}
  }
}
function clearBlockers(form){
  form.querySelectorAll('.auto-field-blocker').forEach(x=>x.remove());
  form.querySelectorAll('.auto-field-blocked').forEach(x=>x.classList.remove('auto-field-blocked'));
  form.querySelectorAll('.auto-blocked-label').forEach(x=>x.classList.remove('auto-blocked-label'));
}
function addBlocker(el,message,withMessage=true){
  if(!el||el.disabled||el.type==='hidden'||el.closest?.('.auto-conditional-hidden'))return;
  el.classList.add('auto-field-blocked');
  const label=labelOf(el);label?.classList.add('auto-blocked-label');
  if(withMessage&&label&&!label.querySelector(`.auto-field-blocker[data-for="${el.name}"]`)){
    const msg=document.createElement('small');msg.className='auto-field-blocker';msg.dataset.for=el.name;msg.textContent=message;label.append(msg);
  }
}
function blockMany(list,message){list.filter(Boolean).forEach((el,i)=>addBlocker(el,message,i===0))}
function nativeMessage(el){
  const v=el.validity;if(!v||v.valid)return'';
  if(v.valueMissing)return'Это поле обязательно для сохранения.';
  if(v.rangeUnderflow)return`Минимальное значение: ${el.min}.`;
  if(v.rangeOverflow)return`Максимальное значение: ${el.max}.`;
  if(v.stepMismatch)return'Проверьте допустимый шаг значения.';
  if(v.typeMismatch)return'Проверьте формат значения.';
  if(v.patternMismatch)return'Проверьте формат поля.';
  return'Проверьте значение этого поля.';
}
function requireField(form,name,{message='Это поле обязательно для сохранения.',positive=false}={}){
  const el=get(form,name);if(!el)return;
  ensureTag(el,true);
  const missing=positive?num(el)<=0:!text(el);
  if(missing)addBlocker(el,message);
}
function markNative(form){
  for(const el of fields(form)){
    ensureTag(el,Boolean(el.required));
    const msg=nativeMessage(el);if(msg)addBlocker(el,msg);
  }
}
function validateYearRange(form){
  const a=get(form,'yearFrom'),b=get(form,'yearTo');
  if(a&&b&&num(a)&&num(b)&&num(a)>num(b))blockMany([a,b],'Начальный год не может быть больше конечного.');
}
function requestRules(form){
  const managerMode=get(form,'managerMode')?.value==='1';
  if(managerMode){['name','contact','model','manager','source','nextAction'].forEach(name=>requireField(form,name));}
  else{
    ['name','contact','model'].forEach(name=>requireField(form,name));
    const budget=get(form,'budget');if(budget){ensureTag(budget,true);if(num(budget)<10000)addBlocker(budget,'Бюджет должен быть не меньше $10 000.');}
    validateYearRange(form);
  }
}
function leadRules(form){
  ['name','contact','model','manager','source'].forEach(name=>requireField(form,name));
  const status=get(form,'status')?.value||'';
  const next=get(form,'nextAction');if(next){ensureTag(next,ACTIVE_LEAD_STATUSES.includes(status));if(ACTIVE_LEAD_STATUSES.includes(status)&&!text(next))addBlocker(next,'Для активного лида укажите дату следующего действия.');}
  const lost=get(form,'lostReason');if(lost){ensureTag(lost,status==='Отказ');if(status==='Отказ'&&!text(lost))addBlocker(lost,'Для отказа обязательна причина.');}
  const deposit=get(form,'deposit');if(deposit&&num(deposit)>0){
    const date=get(form,'depositDate'),method=get(form,'paymentMethod');
    if(date&&!text(date))date.value=today();
    if(method&&!text(method))method.value='Банк';
    requireField(form,'depositDate',{message:'Для депозита укажите дату.'});
    requireField(form,'paymentMethod',{message:'Для депозита укажите способ оплаты.'});
  }else{const d=get(form,'depositDate'),m=get(form,'paymentMethod');if(d)ensureTag(d,false);if(m)ensureTag(m,false)}
  validateYearRange(form);
}
function quoteRules(form){
  ['leadId','model'].forEach(name=>requireField(form,name));
  const status=get(form,'status')?.value||'Черновик';
  const required=status!=='Черновик';
  for(const name of ['lot','auction','inland','ocean','customs','service']){
    const el=get(form,name);if(!el)continue;ensureTag(el,required);if(required&&num(el)<=0)addBlocker(el,'Для отправки расчёта сумма должна быть больше 0.');
  }
  const validUntil=get(form,'validUntil');if(validUntil){ensureTag(validUntil,required);if(required&&!text(validUntil))addBlocker(validUntil,'Укажите срок действия расчёта.');}
}
function normalizeOrderPayment(form){
  if(form.getAttribute?.('id')!=='orderForm')return;
  const amount=get(form,'paymentAmount');if(!amount)return;
  const id=text(get(form,'id')),order=readLocal('auto-sale-orders-v2',[]).find(x=>x.id===id);if(!order)return;
  const remaining=Math.max(0,(Number(order.total)||0)-(Number(order.paid)||0));
  if(remaining<=0){
    amount.value='0';
    amount.removeAttribute('max');
    amount.disabled=true;
    amount.setAttribute('aria-disabled','true');
    amount.dataset.paymentSettled='1';
    return;
  }
  amount.disabled=false;
  amount.removeAttribute('aria-disabled');
  delete amount.dataset.paymentSettled;
  amount.max=String(remaining);
}
function orderRules(form){
  const stage=get(form,'stage')?.value||'';
  const required=new Set(orderRequiredFields(stage));
  for(const name of ['lot','vin','eta','location']){
    const el=get(form,name);if(!el)continue;ensureTag(el,required.has(name));if(required.has(name)&&!text(el))addBlocker(el,`Поле обязательно для этапа «${stage}».`);
  }
  const riskType=get(form,'riskType')?.value||'Нет',riskNote=get(form,'riskNote');
  if(riskNote){ensureTag(riskNote,riskType!=='Нет');if(riskType!=='Нет'&&!text(riskNote))addBlocker(riskNote,'Опишите риск или блокер.');}
  const amount=get(form,'paymentAmount'),date=get(form,'paymentDate');
  if(amount&&!amount.disabled&&num(amount)>0){requireField(form,'paymentDate',{message:'Для платежа укажите дату.'});}
  else if(date)ensureTag(date,false);
  if(stage==='Выдача'&&amount&&!amount.disabled){
    const id=get(form,'id')?.value||'';
    let order=null;try{order=(JSON.parse(localStorage.getItem('auto-sale-orders-v2')||'[]')||[]).find(x=>x.id===id)}catch{}
    if(order){const remaining=Math.max(0,(Number(order.total)||0)-(Number(order.paid)||0)-num(amount));if(remaining>0){ensureTag(amount,true);addBlocker(amount,`Для выдачи внесите оставшуюся оплату $${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(remaining)}.`)}}
  }
}
function clientEditRules(form){
  requireField(form,'model');
  const budget=get(form,'budget');if(budget){ensureTag(budget,true);if(num(budget)<10000)addBlocker(budget,'Бюджет должен быть не меньше $10 000.');}
  validateYearRange(form);
}
function syncConvertOrder(form){
  if(form.getAttribute?.('id')!=='leadEditForm')return;
  const modal=form.closest('.auto-modal'),button=modal?.querySelector('[data-convert-order]');if(!button)return;
  const leadId=text(get(form,'id')),quote=readLocal('auto-sale-quotes-v2',[]).filter(x=>x.leadId===leadId).sort((a,b)=>(Number(b.version)||0)-(Number(a.version)||0))[0];
  const deposit=num(get(form,'deposit')),date=text(get(form,'depositDate')),method=text(get(form,'paymentMethod'));
  const ready=quote?.status==='Согласован'&&deposit>0&&Boolean(date)&&Boolean(method);
  button.disabled=!ready;button.setAttribute('aria-disabled',String(!ready));
  const hint=button.parentElement?.querySelector('.auto-rule-hint');
  if(hint){hint.classList.toggle('good',ready);hint.textContent=ready?'Расчёт согласован и депозит зафиксирован.':quote?.status!=='Согласован'?'Заказ можно создать только после согласования расчёта.':'Перед созданием заказа зафиксируйте полученный депозит.'}
}
function depositDraft(form){return{id:text(get(form,'id')),deposit:num(get(form,'deposit')),depositDate:text(get(form,'depositDate')),paymentMethod:text(get(form,'paymentMethod'))}}
function depositSaved(draft){const lead=readLocal('auto-sale-leads-v2',[]).find(x=>x.id===draft.id);return Boolean(lead&&Number(lead.deposit)===draft.deposit&&String(lead.depositDate||'')===draft.depositDate&&String(lead.paymentMethod||'')===draft.paymentMethod)}

function refresh(form){
  if(!form?.matches?.(FORM_SELECTOR))return;
  normalizeOrderPayment(form);
  clearBlockers(form);
  for(const el of fields(form))if(!el.required)ensureTag(el,false);
  markNative(form);
  if(form.getAttribute?.('id')==='requestForm')requestRules(form);
  else if(form.getAttribute?.('id')==='leadEditForm')leadRules(form);
  else if(form.getAttribute?.('id')==='quoteForm')quoteRules(form);
  else if(form.getAttribute?.('id')==='orderForm')orderRules(form);
  else if(form.getAttribute?.('id')==='clientEditForm')clientEditRules(form);
  syncConvertOrder(form);
  form.dataset.requiredHighlight='1';
}
function refreshAll(scope=document){scope.querySelectorAll?.(FORM_SELECTOR).forEach(refresh)}
function containsTrackedForm(node){
  if(node?.nodeType!==1)return false;
  if(node.matches?.('.auto-required-tag,.auto-field-blocker,#auto-required-fields-style'))return false;
  return Boolean(node.matches?.(FORM_SELECTOR)||node.querySelector?.(FORM_SELECTOR));
}

refreshAll();
let queued=false;
new MutationObserver(mutations=>{
  const relevant=mutations.some(m=>[...m.addedNodes,...m.removedNodes].some(containsTrackedForm));
  if(!relevant||queued)return;
  queued=true;queueMicrotask(()=>{queued=false;refreshAll()});
}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('input',event=>{const form=event.target?.closest?.(FORM_SELECTOR);if(form)refresh(form)},true);
document.addEventListener('change',event=>{const form=event.target?.closest?.(FORM_SELECTOR);if(form)refresh(form)},true);
document.addEventListener('submit',event=>{const form=event.target?.matches?.(FORM_SELECTOR)?event.target:null;if(form)refresh(form)},true);
document.addEventListener('invalid',event=>{const form=event.target?.closest?.(FORM_SELECTOR);if(form){refresh(form);addBlocker(event.target,nativeMessage(event.target)||'Проверьте это поле.')}},true);
document.addEventListener('click',event=>{
  const button=event.target?.closest?.('[data-convert-order]');if(!button||button.disabled)return;
  const form=button.closest('.auto-modal')?.querySelector('#leadEditForm');if(!form)return;
  refresh(form);const draft=depositDraft(form);if(depositSaved(draft))return;
  event.preventDefault();event.stopPropagation();
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  queueMicrotask(()=>{if(!depositSaved(draft))return;const next=document.querySelector(`[data-convert-order="${draft.id}"]`);if(next&&!next.disabled)next.click()});
},true);

window.__AUTO_SALE_REFRESH_REQUIRED_FIELDS__=()=>refreshAll();