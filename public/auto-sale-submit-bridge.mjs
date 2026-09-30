const originalAddEventListener=EventTarget.prototype.addEventListener;
const NativeFormData=window.FormData;
let rootSubmitHandler=null;

const formKey=form=>String(form?.getAttribute?.('id')||'');

function AutoSaleFormData(form,submitter){
  const fd=arguments.length>1?new NativeFormData(form,submitter):arguments.length?new NativeFormData(form):new NativeFormData();
  if(form instanceof HTMLFormElement){
    const record=form.querySelector('[data-auto-record-id="1"]');
    if(record)fd.set('id',String(record.value||''));
  }
  return fd;
}
AutoSaleFormData.prototype=NativeFormData.prototype;
Object.setPrototypeOf(AutoSaleFormData,NativeFormData);
window.FormData=AutoSaleFormData;
globalThis.FormData=AutoSaleFormData;

EventTarget.prototype.addEventListener=function(type,listener,options){
  if(type==='submit'&&this instanceof Element&&this.getAttribute?.('id')==='app'&&typeof listener==='function'){
    rootSubmitHandler=listener;
    window.__AUTO_SALE_ROOT_SUBMIT__=listener;
  }
  return originalAddEventListener.call(this,type,listener,options);
};

function copySubmitError(source,target){
  const error=source.querySelector('.auto-form-error');
  if(!error?.textContent?.trim()||!target?.isConnected)return;
  let box=target.querySelector('.auto-form-error');
  if(!box){box=document.createElement('div');box.className='auto-form-error full';target.prepend(box)}
  box.innerHTML=error.innerHTML;
}

function invokeCore(form){
  if(!(form instanceof HTMLFormElement)||typeof rootSubmitHandler!=='function')return false;
  const key=formKey(form);
  if(key==='quoteForm')window.__AUTO_SALE_ENSURE_QUOTE_LEAD__?.(form);
  const beforeQuotes=key==='quoteForm'?localStorage.getItem('auto-sale-quotes-v2'):null;
  rootSubmitHandler.call(document.querySelector('#app'),{target:form,preventDefault(){}});
  copySubmitError(form,form);
  const saved=!form.isConnected||(key==='quoteForm'&&localStorage.getItem('auto-sale-quotes-v2')!==beforeQuotes);
  window.__AUTO_SALE_LAST_ROOT_SUBMIT__={formId:key,saved,at:Date.now()};
  return saved;
}

// Route record forms through the captured app handler without cloning them.
// The live form must be preserved so current select/input values reach FormData.
const root=document.querySelector('#app');
if(root){
  originalAddEventListener.call(root,'submit',event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement)||!form.querySelector('[name="id"]'))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    invokeCore(form);
  },false);
}

window.__AUTO_SALE_INVOKE_ROOT_SUBMIT__=invokeCore;
