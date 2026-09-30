import {writeFile} from 'node:fs/promises';

const base=String(process.env.STAGING_URL||'').replace(/\/$/,'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
if(!base)throw new Error('STAGING_URL is required');
if(!apiKey)throw new Error('AUTO_SALE_API_KEY is required');

const suffix=Date.now().toString(36).toUpperCase();
const leadId='L-ENTITY-'+suffix;
const cascadeLeadId=leadId+'-CASCADE';
const cascadeQuoteId='Q-ENTITY-'+suffix;
const headers={'content-type':'application/json','x-auto-sale-key':apiKey,'x-auto-sale-skip-telegram':'1'};
const report={leadId,cascadeLeadId,create:null,read:null,patch:null,staleConflict:null,note:null,cleanup:null,cascade:null,readParity:null};

async function request(path,{method='GET',body=null}={}){
  const response=await fetch(base+path,{
    method,
    headers:method==='GET'?{'x-auto-sale-key':apiKey}:headers,
    body:body===null?undefined:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  return{status:response.status,data};
}

async function current(){
  return request('/api/auto-sale/leads/'+encodeURIComponent(leadId));
}

try{
  const created=await request('/api/auto-sale/leads',{
    method:'POST',
    body:{
      id:leadId,
      name:'Phase 4 Entity API',
      contact:'phase4-'+suffix.toLowerCase()+'@example.invalid',
      model:'Entity API validation',
      budget:42000,
      source:'Mini App',
      manager:'Не назначен',
      status:'Новый',
      priority:'Средний',
      nextAction:new Date().toISOString().slice(0,10),
      createdAt:new Date().toISOString(),
      clientCreated:false
    }
  });
  report.create=created;
  if(created.status!==201||created.data?.id!==leadId||!Number(created.data?.rowVersion))throw new Error('entity_create_failed:'+JSON.stringify(created));

  const read=await current();
  report.read=read;
  if(read.status!==200||read.data?.entity?.id!==leadId||read.data?.rowVersion!==created.data.rowVersion)throw new Error('entity_read_failed:'+JSON.stringify(read));

  const firstVersion=read.data.rowVersion;
  const patched=await request('/api/auto-sale/leads/'+encodeURIComponent(leadId),{
    method:'PATCH',
    body:{baseRowVersion:firstVersion,priority:'Высокий'}
  });
  report.patch=patched;
  if(patched.status!==200||patched.data?.rowVersion<=firstVersion||patched.data?.entity?.priority!=='Высокий')throw new Error('entity_patch_failed:'+JSON.stringify(patched));

  const stale=await request('/api/auto-sale/leads/'+encodeURIComponent(leadId),{
    method:'PATCH',
    body:{baseRowVersion:firstVersion,priority:'Низкий'}
  });
  report.staleConflict=stale;
  if(stale.status!==409||stale.data?.error!=='entity_conflict'||stale.data?.currentRowVersion!==patched.data.rowVersion){
    throw new Error('stale_entity_version_not_rejected:'+JSON.stringify(stale));
  }

  const note=await request('/api/auto-sale/leads/'+encodeURIComponent(leadId)+'/notes',{
    method:'POST',
    body:{baseRowVersion:patched.data.rowVersion,text:'Phase 4 optimistic locking live check'}
  });
  report.note=note;
  if(note.status!==201||note.data?.rowVersion<=patched.data.rowVersion||!note.data?.note?.id)throw new Error('entity_note_failed:'+JSON.stringify(note));

  const removed=await request('/api/auto-sale/leads/'+encodeURIComponent(leadId),{
    method:'DELETE',
    body:{baseRowVersion:note.data.rowVersion}
  });
  report.cleanup=removed;
  if(removed.status!==200||removed.data?.entity!==null)throw new Error('entity_cleanup_failed:'+JSON.stringify(removed));

  const gone=await current();
  if(gone.status!==404)throw new Error('entity_still_exists_after_delete:'+JSON.stringify(gone));

  const cascadeCreate=await request('/api/auto-sale/entities/batch',{
    method:'POST',
    body:{operations:[
      {resource:'lead',operation:'create',id:cascadeLeadId,input:{id:cascadeLeadId,name:'Cascade Delete Test',contact:'@cascade_test',model:'BMW X5',budget:50000,source:'Mini App',manager:'Дмитрий',status:'В работе',priority:'Средний',nextAction:new Date().toISOString().slice(0,10),createdAt:new Date().toISOString(),clientCreated:false}},
      {resource:'quote',operation:'create',id:cascadeQuoteId,input:{id:cascadeQuoteId,leadId:cascadeLeadId,model:'BMW X5',status:'Черновик',version:1,total:0}},
      {resource:'note',operation:'create',leadId:cascadeLeadId,input:{id:'N-'+suffix,text:'Cascade note'}}
    ]}
  });
  if(cascadeCreate.status!==200)throw new Error('cascade_fixture_create_failed:'+JSON.stringify(cascadeCreate));
  const cascadeLeadVersion=Number(cascadeCreate.data?.rowVersions?.['lead:'+cascadeLeadId]);
  if(!cascadeLeadVersion)throw new Error('cascade_lead_version_missing:'+JSON.stringify(cascadeCreate));
  const cascadeDelete=await request('/api/auto-sale/leads/'+encodeURIComponent(cascadeLeadId)+'?cascade=1',{
    method:'DELETE',
    body:{baseRowVersion:cascadeLeadVersion}
  });
  if(cascadeDelete.status!==200||cascadeDelete.data?.operation!=='delete-cascade')throw new Error('cascade_delete_failed:'+JSON.stringify(cascadeDelete));
  if(!cascadeDelete.data?.deleted?.quotes?.includes(cascadeQuoteId)||cascadeDelete.data?.deleted?.orders?.length!==0||cascadeDelete.data?.deleted?.notes!==1||cascadeDelete.data?.deleted?.payments!==0){
    throw new Error('cascade_delete_receipt_invalid:'+JSON.stringify(cascadeDelete));
  }
  const [cascadeLeadGone,cascadeQuoteGone]=await Promise.all([
    request('/api/auto-sale/leads/'+encodeURIComponent(cascadeLeadId)),
    request('/api/auto-sale/quotes/'+encodeURIComponent(cascadeQuoteId))
  ]);
  if(cascadeLeadGone.status!==404||cascadeQuoteGone.status!==404){
    throw new Error('cascade_entities_still_exist:'+JSON.stringify({cascadeLeadGone,cascadeQuoteGone}));
  }
  report.cascade={create:cascadeCreate,remove:cascadeDelete};

  const parity=await request('/api/auto-sale/admin/read-parity');
  report.readParity=parity;
  if(parity.status!==200||parity.data?.source!=='normalized'||parity.data?.fallback!==false||parity.data?.authoritative!==true||parity.data?.shadowVerified!==false){
    throw new Error('entity_cleanup_parity_failed:'+JSON.stringify(parity));
  }

  report.ok=true;
  await writeFile('ydb-entity-api-live-report.json',JSON.stringify(report,null,2));
  console.log('AUTO_SALE_YDB_ENTITY_API_LIVE_OK',JSON.stringify({
    leadId,
    createRowVersion:created.data.rowVersion,
    patchRowVersion:patched.data.rowVersion,
    noteRowVersion:note.data.rowVersion,
    staleConflict:stale.data.currentRowVersion,
    cleanupRevision:removed.data.revision,
    cascadeRevision:cascadeDelete.data.revision,
    cascadeDeleted:cascadeDelete.data.deleted,
    parityRevision:parity.data.revision
  }));
}finally{
  try{
    const existing=await current();
    if(existing.status===200){
      await request('/api/auto-sale/leads/'+encodeURIComponent(leadId),{
        method:'DELETE',
        body:{baseRowVersion:existing.data.rowVersion}
      });
    }
  }catch{}
  try{
    const existingCascade=await request('/api/auto-sale/leads/'+encodeURIComponent(cascadeLeadId));
    if(existingCascade.status===200){
      await request('/api/auto-sale/leads/'+encodeURIComponent(cascadeLeadId)+'?cascade=1',{
        method:'DELETE',
        body:{baseRowVersion:existingCascade.data.rowVersion}
      });
    }
  }catch{}
}
