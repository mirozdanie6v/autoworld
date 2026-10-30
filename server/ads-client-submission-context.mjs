// A signed staff account can also submit its own customer form.
// Downgrade only this strictly bounded command batch; never grant privileges
// or accept campaign/identity fields supplied by the browser.
export function clientSubmissionAccess(operations,access){
  if(access?.authenticated!==true||access?.authType!=='telegram'
    ||access?.role!=='admin'||access?.apiKey===true
    ||!/^[1-9][0-9]{0,19}$/.test(String(access?.user?.id||'')))return access;
  if(!Array.isArray(operations))return access;
  const leads=operations.filter(op=>op?.resource==='lead'&&op?.operation==='create');
  if(leads.length!==1)return access;
  const lead=leads[0],id=String(lead.id||'');
  if(!id||lead.input?.clientCreated!==true)return access;
  if(operations.some(op=>op!==lead&&!(op?.resource==='note'
    &&op?.operation==='create'&&String(op.leadId||op.id||'')===id)))return access;
  return {...access,role:'client',submissionMode:'self-service'};
}
