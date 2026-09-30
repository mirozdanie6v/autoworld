const LEADS_KEY='auto-sale-leads-v2';
const QUOTES_KEY='auto-sale-quotes-v2';

const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};

function showError(form,message){
  let box=form.querySelector('.auto-save-submit-feedback');
  if(!box){box=document.createElement('div');box.className='auto-save-submit-feedback full';form.querySelector('.auto-form-actions')?.insertAdjacentElement('beforebegin',box)}
  box.dataset.kind='error';box.textContent=message;box.scrollIntoView?.({block:'nearest',behavior:'smooth'});
}

function validLeadId(id,leads){const value=String(id||'').trim();return value&&leads.some(x=>String(x?.id||'')===value)?value:''}
function selectLeadId(select,leads){
  if(!select)return'';
  const values=[select.value,select.dataset?.lockedValue]
    .map(x=>String(x||'').trim()).filter(Boolean);
  for(const value of values){
    if(![...select.options].some(option=>String(option.value)===value))continue;
    const valid=validLeadId(value,leads);if(valid)return valid;
  }
  return'';
}
function resolveLeadId(form){
  const leads=read(LEADS_KEY,[]);
  const select=form.querySelector('select[name="leadId"]');

  // The currently rendered form is the primary source of truth.
  const active=selectLeadId(select,leads);
  if(active)return active;

  const pending=validLeadId(window.__AUTO_SALE_PENDING_QUOTE_LEAD__,leads);
  if(pending&&(!select||[...select.options].some(option=>String(option.value)===pending)))return pending;

  const quoteId=String(form.querySelector('input[name="id"]')?.value||'').trim();
  if(quoteId){
    const quote=read(QUOTES_KEY,[]).find(x=>String(x?.id||'')===quoteId);
    const cached=validLeadId(quote?.leadId,leads);
    if(cached&&(!select||[...select.options].some(option=>String(option.value)===cached)))return cached;
  }
  return'';
}

function ensureSerializedLead(form){
  const leadId=resolveLeadId(form);

  // Never serialize two controls with the same leadId name. Mobile Chrome can
  // produce an unstable FormData result when a disabled select is re-enabled
  // while a same-name hidden fallback is also present.
  form.querySelectorAll('input[data-auto-quote-lead-serialization],input[type="hidden"][name="leadId"]').forEach(x=>x.remove());
  if(!leadId)return false;

  const select=form.querySelector('select[name="leadId"]');
  if(!select)return false;
  select.disabled=false;
  select.removeAttribute('disabled');
  if([...select.options].some(option=>String(option.value)===leadId))select.value=leadId;
  select.dataset.resolvedLeadId=leadId;
  form.dataset.resolvedLeadId=leadId;
  return String(new FormData(form).get('leadId')||'').trim()===leadId;
}

document.addEventListener('submit',event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||form.id!=='quoteForm')return;
  if(ensureSerializedLead(form))return;
  event.preventDefault();event.stopImmediatePropagation();
  const button=form.querySelector('button[type="submit"]');if(button){button.textContent=button.dataset.originalText||'Сохранить расчёт';button.removeAttribute('aria-busy')}
  showError(form,'Не удалось сохранить расчёт: выберите клиента и повторите сохранение.');
},true);

window.__AUTO_SALE_ENSURE_QUOTE_LEAD__=ensureSerializedLead;
