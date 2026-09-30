(()=>{
  const params=new URLSearchParams(location.search);
  if(!params.has('layoutAudit'))return;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const finish=failures=>{
    const node=document.createElement('pre');
    node.id='api-audit-result';
    node.style.display='none';
    node.textContent=failures.length?`API_AUDIT_FAIL::${encodeURIComponent(failures.join('|'))}`:'API_AUDIT_OK';
    document.body.append(node);
    document.body.dataset.apiAudit=failures.length?'fail':'ok';
    document.body.dataset.apiAuditDetails=failures.join('|');
  };
  window.addEventListener('load',async()=>{
    const failures=[];
    try{
      const healthResponse=await fetch('/api/health',{cache:'no-store'});
      const health=await healthResponse.json();
      if(!healthResponse.ok||health.ok!==true)failures.push('api-health');
      if('demoCardsPersistent' in health&&health.demoCardsPersistent!==false)failures.push('demo-cards-enabled');
    }catch{failures.push('api-health-unavailable')}
    try{
      await wait(350);
      const stateResponse=await fetch('/api/auto-sale/state',{cache:'no-store'});
      const state=await stateResponse.json();
      if(!stateResponse.ok||state.initialized!==true||Number(state.revision)<1||!Array.isArray(state.leads)||!Array.isArray(state.quotes)||!Array.isArray(state.orders)||!Array.isArray(state.team)||!Array.isArray(state.catalog))failures.push('state-shape');
      const all=[...(state.leads||[]),...(state.quotes||[]),...(state.orders||[])];
      if(all.some(x=>/^(?:L|Q|O)-DEMO-/i.test(String(x?.id||''))))failures.push('demo-record-residue');
    }catch{failures.push('state-unavailable')}
    finish(failures);
  });
})();
