const NativeFormData=window.FormData;

function normalizeFormRecordId(form){
  if(!(form instanceof HTMLFormElement))return form;
  const attrId=form.getAttribute('id')||'';
  if(!attrId)return form;
  for(const control of form.querySelectorAll('[name="id"]')){
    control.dataset.autoOriginalName='id';
    control.name='recordId';
  }
  return form;
}

function AutoSaleFormData(form,submitter){
  const fd=arguments.length>1?new NativeFormData(form,submitter):arguments.length?new NativeFormData(form):new NativeFormData();
  if(form instanceof HTMLFormElement){
    const record=form.querySelector('[data-auto-original-name="id"]');
    if(record)fd.set('id',String(record.value||''));
  }
  return fd;
}
AutoSaleFormData.prototype=NativeFormData.prototype;
Object.setPrototypeOf(AutoSaleFormData,NativeFormData);
window.FormData=AutoSaleFormData;

function normalizeAll(scope=document){
  scope.querySelectorAll?.('form').forEach(normalizeFormRecordId);
}

// Chrome exposes controls with name="id" as a named property on HTMLFormElement.
// That shadows form.id and breaks handlers that route by form.id. Rename only the
// record-id control in the DOM and restore the expected "id" key in FormData.
document.addEventListener('submit',event=>normalizeFormRecordId(event.target),true);
new MutationObserver(mutations=>{
  for(const mutation of mutations){
    for(const node of mutation.addedNodes){
      if(node?.nodeType!==1)continue;
      if(node.matches?.('form'))normalizeFormRecordId(node);
      normalizeAll(node);
    }
  }
}).observe(document.documentElement,{childList:true,subtree:true});
normalizeAll();

window.__AUTO_SALE_NORMALIZE_FORM_ID__=normalizeFormRecordId;
