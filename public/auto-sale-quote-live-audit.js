(()=>{
  const params=new URLSearchParams(location.search);
  if(!params.has('quoteAudit'))return;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const result=(ok,details={})=>{
    const pre=document.createElement('pre');
    pre.id='quote-live-audit-result';
    pre.style.display='none';
    pre.textContent=ok?'QUOTE_LIVE_AUDIT_OK':`QUOTE_LIVE_AUDIT_FAIL::${encodeURIComponent(JSON.stringify(details))}`;
    document.body.append(pre);
    document.body.dataset.quoteLiveAudit=ok?'ok':'fail';
    document.body.dataset.quoteLiveAuditDetails=JSON.stringify(details);
  };
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
  const errors=[];
  window.addEventListener('error',event=>errors.push(`error:${event.message||event.error||'unknown'}`));
  window.addEventListener('unhandledrejection',event=>errors.push(`rejection:${event.reason?.message||event.reason||'unknown'}`));
  window.addEventListener('load',async()=>{
    const details={};
    try{
      await wait(900);
      const app=document.querySelector('#app');
      if(!app)throw new Error('app_missing');
      app.querySelector('[data-role="manager"]')?.click();
      await wait(80);
      app.querySelector('[data-go="quotes"]')?.click();
      await wait(100);
      const before=read('auto-sale-quotes-v2',[]);
      details.beforeCount=before.length;
      const newButton=app.querySelector('[data-new-quote]');
      if(!newButton)throw new Error('new_quote_button_missing');
      details.newButtonDisabled=Boolean(newButton.disabled);
      newButton.click();
      await wait(120);
      const form=app.querySelector('#quoteForm');
      if(!form)throw new Error('quote_form_missing');
      const lead=form.querySelector('select[name="leadId"]');
      details.formId=form.querySelector('input[name="id"]')?.value||'';
      details.leadId=lead?.value||'';
      details.leadDisabled=Boolean(lead?.disabled);
      details.leadSerialized=String(new FormData(form).get('leadId')||'');
      const service=form.querySelector('[name="service"]');
      const status=form.querySelector('[name="status"]');
      if(service)service.value='1600';
      if(status)status.value='Черновик';
      for(const name of ['lot','auction','inland','ocean','customs','repair']){
        const field=form.querySelector(`[name="${name}"]`);if(field)field.value='0';
      }
      form.querySelector('button[type="submit"]')?.click();
      await wait(500);
      const after=read('auto-sale-quotes-v2',[]);
      details.afterCount=after.length;
      details.formStillOpen=Boolean(document.querySelector('#quoteForm'));
      details.feedback=document.querySelector('#quoteForm .auto-save-submit-feedback')?.textContent?.trim()||'';
      details.formError=document.querySelector('#quoteForm .auto-form-error')?.textContent?.trim()||'';
      details.lastRootSubmit=window.__AUTO_SALE_LAST_ROOT_SUBMIT__||null;
      details.runtimeErrors=errors;
      const added=after.length>before.length;
      const saved=after.find(q=>!before.some(b=>b.id===q.id)&&Number(q.service)===1600&&q.status==='Черновик');
      details.savedQuote=saved?{id:saved.id,leadId:saved.leadId,status:saved.status,service:saved.service,total:saved.total}:null;
      result(Boolean(added&&saved&&!details.formStillOpen&&!errors.length),details);
    }catch(error){details.exception=String(error?.stack||error);details.runtimeErrors=errors;result(false,details)}
  });
})();
