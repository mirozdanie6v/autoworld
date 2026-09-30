import {validateLeadUpdate} from './auto-sale-business-rules.mjs';

const K={leads:'auto-sale-leads-v2',quotes:'auto-sale-quotes-v2',notes:'auto-sale-notes-v2'};
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};

function fieldLabel(control){
  const label=control?.closest?.('label');
  if(!label)return control?.name||'обязательное поле';
  const text=[...label.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim();
  return text||control.name||'обязательное поле';
}
function markField(control){
  if(!control)return;
  control.classList.add('auto-field-error');
  control.setAttribute('aria-invalid','true');
  control.scrollIntoView?.({block:'center',behavior:'smooth'});
  setTimeout(()=>control.focus?.({preventScroll:true}),180);
}
function clearFieldMarks(form){
  for(const el of form?.querySelectorAll?.('.auto-field-error')||[]){el.classList.remove('auto-field-error');el.removeAttribute('aria-invalid')}
}
function feedback(form,message,kind='warn'){
  if(!form?.isConnected)return;
  let box=form.querySelector('.auto-save-submit-feedback');
  if(!box){box=document.createElement('div');box.className='auto-save-submit-feedback full';form.querySelector('.auto-form-actions')?.insertAdjacentElement('beforebegin',box)}
  box.dataset.kind=kind;box.textContent=message;box.scrollIntoView?.({block:'nearest',behavior:'smooth'});
}
function buttonFor(form){return form?.querySelector?.('button[type="submit"]')||null}
function startSaving(form){const button=buttonFor(form);if(!button)return null;button.dataset.originalText=button.dataset.originalText||button.textContent||'';button.textContent='Сохраняем…';button.setAttribute('aria-busy','true');return button}
function resetButton(button,text=''){if(!button)return;button.textContent=text||button.dataset.originalText||button.textContent||'';button.removeAttribute('aria-busy')}
function showSaved(form,label){if(!form?.isConnected)return;const button=buttonFor(form);if(button){button.dataset.originalText=button.dataset.originalText||label;button.textContent='Сохранено ✓';button.removeAttribute('aria-busy');setTimeout(()=>{if(button.isConnected)resetButton(button,label)},1200)}feedback(form,'Изменения сохранены.','success')}

function leadErrors(form,data,current){
  const q=read(K.quotes,[]).filter(x=>x.leadId===current.id).sort((a,b)=>(Number(b.version)||0)-(Number(a.version)||0))[0];
  const errors=validateLeadUpdate(data,current,{hasAgreedQuote:q?.status==='Согласован',deposit:Number(data.deposit)||0});
  if(Number(data.deposit)>0&&(!data.depositDate||!data.paymentMethod))errors.push('Для депозита укажите дату и способ оплаты.');
  if(Number(data.yearFrom)&&Number(data.yearTo)&&Number(data.yearFrom)>Number(data.yearTo))errors.push('Проверьте диапазон годов.');
  return[...new Set(errors)];
}
function focusLeadProblem(form,data,errors){
  const map=[
    [/имя клиента/i,'name'],[/контакт клиента/i,'contact'],[/интересующий автомобиль/i,'model'],[/ответственного|менеджер/i,'manager'],[/источник/i,'source'],[/следующее действие|дата следующего действия/i,'nextAction'],[/причина/i,'lostReason'],[/депозит.*дат|дата.*депозит/i,'depositDate'],[/способ оплаты/i,'paymentMethod'],[/диапазон годов/i,'yearFrom']
  ];
  for(const [rx,name] of map){if(errors.some(x=>rx.test(x))){const el=form.elements?.[name];if(el){markField(el);return}}}
  const invalid=[...form.elements].find(el=>typeof el.checkValidity==='function'&&!el.checkValidity());if(invalid)markField(invalid);
}
function fallbackSaveLead(form,button){
  const data=Object.fromEntries(new FormData(form).entries()),rows=read(K.leads,[]),i=rows.findIndex(x=>x.id===data.id);
  if(i<0){resetButton(button);feedback(form,'Карточка больше недоступна. Закройте её, откройте заново и повторите действие.','error');return}
  const current=rows[i],errors=leadErrors(form,data,current);
  if(errors.length){resetButton(button);focusLeadProblem(form,data,errors);feedback(form,`Не удалось сохранить карточку: ${errors.join(' ')}`,'error');return}
  rows[i]={...current,status:data.status,manager:data.manager,name:String(data.name||'').trim(),contact:String(data.contact||'').trim(),model:String(data.model||'').trim(),budget:Number(data.budget)||0,source:data.source,priority:data.priority,nextAction:data.nextAction||'',yearFrom:data.yearFrom||'',yearTo:data.yearTo||'',mileageMax:data.mileageMax||'',engine:data.engine||'Не важно',drive:data.drive||'Не важно',damage:data.damage||'Минимальные',deliveryCity:data.deliveryCity||'',deposit:Number(data.deposit)||0,depositDate:data.depositDate||'',paymentMethod:data.paymentMethod||'',note:data.note||'',lostReason:data.status==='Отказ'?(data.lostReason||''):''};
  const history=read(K.notes,{});history[data.id]=history[data.id]||[];history[data.id].push({at:new Date().toISOString(),text:`Карточка сохранена: ${rows[i].status}, менеджер ${rows[i].manager}.`});
  localStorage.setItem(K.leads,JSON.stringify(rows));localStorage.setItem(K.notes,JSON.stringify(history));
  form.dataset.fallbackSaved='1';showSaved(form,'Сохранить карточку');
}
function retryQuoteSubmit(form,button){
  if(form.dataset.quoteSubmitRetried==='1'){
    const leadSelect=form.querySelector('select[name="leadId"]');
    if(!String(leadSelect?.value||'').trim()){
      resetButton(button);markField(leadSelect);feedback(form,'Не удалось сохранить расчёт: выберите клиента.','error');return;
    }
    const invoked=window.__AUTO_SALE_INVOKE_ROOT_SUBMIT__?.(form);
    queueMicrotask(()=>{
      if(!form.isConnected)return;
      const error=form.querySelector('.auto-form-error');
      if(error?.textContent?.trim()){resetButton(button);feedback(form,`Не удалось сохранить: ${error.textContent.trim()}`,'error');return}
      resetButton(button);feedback(form,invoked?'Не удалось сохранить расчёт. Повторите сохранение.':'Не удалось сохранить расчёт. Закройте его, откройте заново и повторите.','error');
    });
    return;
  }
  form.dataset.quoteSubmitRetried='1';
  const retry=new Event('submit',{bubbles:true,cancelable:true});
  retry.autoSaleQuoteRetry=true;
  form.dispatchEvent(retry);
  queueMicrotask(()=>{
    if(!form.isConnected)return;
    const error=form.querySelector('.auto-form-error');
    if(error?.textContent?.trim()){resetButton(button);feedback(form,`Не удалось сохранить: ${error.textContent.trim()}`,'error');return}
    retryQuoteSubmit(form,button);
  });
}
function settleLocal(form,button,type){
  if(window.__AUTO_SALE_ENTITY_BATCH__)return;
  queueMicrotask(()=>{
    if(!form.isConnected){if(type==='lead')showSaved(document.querySelector('#leadEditForm'),'Сохранить карточку');return}
    const error=form.querySelector('.auto-form-error');
    if(error?.textContent?.trim()){resetButton(button);feedback(form,`Не удалось сохранить: ${error.textContent.trim()}`,'error');return}
    if(type==='lead'){fallbackSaveLead(form,button);return}
    retryQuoteSubmit(form,button);
  });
}

function patchQuoteForm(){
  const form=document.querySelector('#quoteForm');if(!form||form.dataset.quoteSaveFix==='1')return;form.dataset.quoteSaveFix='1';
  const id=form.querySelector('input[name="id"]')?.value||'',leadSelect=form.querySelector('select[name="leadId"]');
  if(leadSelect){
    const hidden=[...form.querySelectorAll('input[type="hidden"][name="leadId"]')];
    const hiddenValue=hidden.find(x=>x.value)?.value||'';
    hidden.forEach(x=>x.remove());
    const pending=!id?String(window.__AUTO_SALE_PENDING_QUOTE_LEAD__||''):'';
    const target=id?(hiddenValue||leadSelect.value):(pending||leadSelect.value);
    if(target&&[...leadSelect.options].some(option=>option.value===target))leadSelect.value=target;
    if(id){
      const lockedValue=leadSelect.value;
      leadSelect.disabled=false;
      leadSelect.dataset.lockedValue=lockedValue;
      leadSelect.setAttribute('aria-readonly','true');
      leadSelect.classList.add('auto-field-locked');
      leadSelect.tabIndex=-1;
      leadSelect.addEventListener('pointerdown',event=>event.preventDefault());
      leadSelect.addEventListener('keydown',event=>event.preventDefault());
      leadSelect.addEventListener('change',()=>{leadSelect.value=leadSelect.dataset.lockedValue||lockedValue});
    }
    if(!id&&pending&&leadSelect.value===pending)window.__AUTO_SALE_PENDING_QUOTE_LEAD__='';
  }
  form.addEventListener('invalid',event=>{resetButton(buttonFor(form));const control=event.target;markField(control);feedback(form,`Не удалось сохранить расчёт: проверьте поле «${fieldLabel(control)}».`,'error')},true);
  form.addEventListener('submit',event=>{clearFieldMarks(form);const button=startSaving(form);if(!event.autoSaleQuoteRetry)settleLocal(form,button,'quote')},true);
}
function patchLeadForm(){
  const form=document.querySelector('#leadEditForm');if(!form||form.dataset.leadSaveFix==='1')return;form.dataset.leadSaveFix='1';
  form.addEventListener('invalid',event=>{resetButton(buttonFor(form));const control=event.target;markField(control);feedback(form,`Не удалось сохранить карточку: заполните поле «${fieldLabel(control)}».`,'error')},true);
  form.addEventListener('submit',()=>{clearFieldMarks(form);const button=startSaving(form);settleLocal(form,button,'lead')},true);
}
function patchForms(){patchQuoteForm();patchLeadForm()}

// Remember the exact client before the modal is rendered. This keeps a new
// calculation attached to the lead even when another module updates the card
// immediately before opening the calculation.
document.addEventListener('click',event=>{
  const create=event.target.closest?.('[data-create-quote]');
  if(create?.dataset.createQuote)window.__AUTO_SALE_PENDING_QUOTE_LEAD__=create.dataset.createQuote;
  else if(event.target.closest?.('[data-new-quote]'))window.__AUTO_SALE_PENDING_QUOTE_LEAD__='';
},true);

const observer=new MutationObserver(patchForms);observer.observe(document.documentElement,{childList:true,subtree:true});patchForms();

window.addEventListener('auto-sale-entity-synced',()=>{
  const form=document.querySelector('#leadEditForm,#quoteForm,#orderForm');if(!form)return;
  form.dataset.fallbackSaved='0';
  showSaved(form,form.id==='leadEditForm'?'Сохранить карточку':form.id==='quoteForm'?'Сохранить расчёт':'Сохранить заказ');
});
window.addEventListener('auto-sale-entity-rejected',()=>{
  const form=document.querySelector('#leadEditForm,#quoteForm,#orderForm');if(!form)return;
  resetButton(buttonFor(form));feedback(form,'Не удалось сохранить изменения. Проверьте данные и повторите.','error');
});
window.addEventListener('auto-sale-entity-conflict',()=>{
  const form=document.querySelector('#leadEditForm,#quoteForm,#orderForm');if(form){resetButton(buttonFor(form));feedback(form,'Карточка была изменена в другом окне или другим пользователем. Данные обновлены — повторите изменения.','warn')}
});
window.addEventListener('auto-sale-server-synced',()=>{
  const form=document.querySelector('#leadEditForm,#quoteForm,#orderForm');if(!form)return;
  form.dataset.fallbackSaved='0';
  feedback(form,'Изменения сохранены.','success');
});
window.addEventListener('auto-sale-server-rejected',()=>{const form=document.querySelector('#leadEditForm,#quoteForm,#orderForm');if(!form)return;resetButton(buttonFor(form));feedback(form,'Не удалось сохранить изменения. Проверьте выделенные поля и повторите.','error')});
window.addEventListener('auto-sale-server-conflict',()=>{const form=document.querySelector('#leadEditForm,#quoteForm,#orderForm');if(form){resetButton(buttonFor(form));feedback(form,'Карточка была изменена в другом окне или другим пользователем. Закройте её, откройте заново и повторите изменения.','warn')}});
window.addEventListener('auto-sale-server-deferred',()=>{const form=document.querySelector('#leadEditForm,#quoteForm,#orderForm');if(form){resetButton(buttonFor(form));feedback(form,'Сейчас нет связи. Проверьте интернет-соединение и повторите сохранение.','warn')}});

if(!document.getElementById('autoSaleQuoteSaveFixStyles')){const style=document.createElement('style');style.id='autoSaleQuoteSaveFixStyles';style.textContent='.auto-field-locked{pointer-events:none;opacity:.78;background:rgba(255,255,255,.035)}.auto-field-error{border-color:#ef6b6b!important;box-shadow:0 0 0 2px rgba(239,107,107,.16)!important}.auto-save-submit-feedback{padding:10px 12px;margin:8px 0;border:1px solid rgba(230,177,71,.35);border-radius:12px;background:rgba(230,177,71,.08);font-size:12px;line-height:1.45;color:#f1d28f}.auto-save-submit-feedback[data-kind="success"]{border-color:rgba(74,190,130,.38);background:rgba(74,190,130,.09);color:#bdebd2}.auto-save-submit-feedback[data-kind="error"]{border-color:rgba(235,102,102,.4);background:rgba(235,102,102,.09);color:#ffc7c7}';document.head.append(style)}