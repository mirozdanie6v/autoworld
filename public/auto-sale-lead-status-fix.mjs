const KEYS={leads:'auto-sale-leads-v2',quotes:'auto-sale-quotes-v2'};
const read=(key,fallback=[])=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
const leadById=id=>read(KEYS.leads,[]).find(x=>x.id===id);
const latestQuote=id=>read(KEYS.quotes,[]).filter(x=>x.leadId===id).sort((a,b)=>(Number(b.version)||0)-(Number(a.version)||0))[0];

function quoteButtonFor(id){return [...document.querySelectorAll('[data-create-quote]')].find(x=>x.dataset.createQuote===id)||null}
function setText(node,text){if(node&&node.textContent!==text)node.textContent=text}
function setHint(button,text){const hint=button?.nextElementSibling;if(hint?.classList?.contains('auto-why'))setText(hint,text)}

function refreshLeadActions(){
  const form=document.querySelector('#leadEditForm');
  if(!form)return;
  const id=form.elements?.id?.value||'';
  const lead=leadById(id);
  if(!lead)return;
  const save=form.querySelector('button[type="submit"]');
  if(save){save.disabled=false;save.removeAttribute('aria-disabled')}
  const create=quoteButtonFor(id);
  if(!create)return;
  const q=latestQuote(id),selected=form.elements?.status?.value||lead.status;
  if(q){create.disabled=false;create.removeAttribute('aria-disabled');return}
  if(['Сделка','Отказ'].includes(lead.status)){
    create.disabled=true;create.setAttribute('aria-disabled','true');return;
  }
  if(lead.status==='Новый'){
    const ready=selected==='В работе';
    create.disabled=!ready;
    if(ready){
      create.removeAttribute('aria-disabled');
      setText(create,'Сохранить и создать расчёт');
      setHint(create,'Статус «В работе» будет сохранён, затем сразу откроется новый расчёт.');
    }else{
      create.setAttribute('aria-disabled','true');
      setText(create,'Создать расчёт');
      setHint(create,'Сначала выберите статус «В работе».');
    }
    return;
  }
  create.disabled=false;create.removeAttribute('aria-disabled');setText(create,'Создать расчёт');
}

const observer=new MutationObserver(refreshLeadActions);
observer.observe(document.documentElement,{childList:true,subtree:true});
refreshLeadActions();

document.addEventListener('change',event=>{
  if(event.target?.id==='leadStatus')queueMicrotask(refreshLeadActions);
},true);

document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-create-quote]');
  if(!button)return;
  const id=button.dataset.createQuote||'';
  const form=document.querySelector('#leadEditForm');
  if(!form||form.elements?.id?.value!==id)return;
  const lead=leadById(id);
  if(!lead||latestQuote(id)||lead.status!=='Новый'||form.elements?.status?.value!=='В работе')return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const save=form.querySelector('button[type="submit"]');
  if(save){save.disabled=false;save.removeAttribute('aria-disabled')}
  if(typeof form.checkValidity==='function'&&!form.checkValidity()){
    form.reportValidity?.();
    return;
  }
  form.requestSubmit(save||undefined);
  queueMicrotask(()=>{
    if(leadById(id)?.status!=='В работе')return;
    const fresh=quoteButtonFor(id);
    if(!fresh)return;
    fresh.disabled=false;fresh.removeAttribute('aria-disabled');
    fresh.click();
  });
},true);
