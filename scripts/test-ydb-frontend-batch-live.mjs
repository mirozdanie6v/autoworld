import {writeFile} from 'node:fs/promises';

const base=String(process.env.STAGING_URL||'').replace(/\/$/,'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
if(!base)throw new Error('STAGING_URL is required');
if(!apiKey)throw new Error('AUTO_SALE_API_KEY is required');

const suffix=Date.now().toString(36).toUpperCase();
const leadId='L-FRONTEND-'+suffix;
const headers={'content-type':'application/json','x-auto-sale-key':apiKey,'x-auto-sale-skip-telegram':'1'};
const report={leadId,baseline:null,created:null,patched:null,stale:null,cleanup:null,parity:null};

async function request(path,{method='GET',body=null,admin=false}={}){
  const response=await fetch(base+path,{
    method,
    headers:method==='GET'?{'x-auto-sale-key':apiKey}:headers,
    body:body===null?undefined:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  return{status:response.status,data};
}
async function state(){
  let last=null;
  for(let attempt=1;attempt<=4;attempt++){
    const result=await request('/api/auto-sale/state');
    last=result;
    if(result.status===200)return result.data;
    if(![500,502,503,504].includes(result.status)||attempt===4)break;
    await new Promise(resolve=>setTimeout(resolve,750*attempt));
  }
  throw new Error('state_read_failed:'+JSON.stringify(last));
}
async function batch(operations){
  return request('/api/auto-sale/entities/batch',{method:'POST',body:{operations}});
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const transient=status=>[500,502,503,504].includes(Number(status));
const rowVersion=(snapshot,resource,id)=>Number(snapshot?._rowVersions?.[resource]?.[id]||0);

async function batchWithRecovery(operations,isApplied){
  let prepared=operations.map(item=>structuredClone(item));
  let last=null;
  for(let attempt=1;attempt<=3;attempt++){
    const result=await batch(prepared);
    last=result;
    if(result.status===200)return result;
    if(!transient(result.status))return result;
    await sleep(900*attempt);
    const snapshot=await state();
    if(isApplied(snapshot)){
      return{
        status:200,
        data:{
          ok:true,
          timeoutRecovered:true,
          revision:Number(snapshot.revision)||0,
          rowVersions:{['lead:'+leadId]:rowVersion(snapshot,'lead',leadId)}
        }
      };
    }
    const current=rowVersion(snapshot,'lead',leadId);
    if(current){
      prepared=prepared.map(operation=>{
        if(operation.operation==='create'&&!['note','payment'].includes(String(operation.resource||'')))return operation;
        const target=operation.resource==='note'?String(operation.leadId||operation.id||''):String(operation.id||operation.input?.id||'');
        return target===leadId?{...operation,baseRowVersion:current}:operation;
      });
    }
  }
  return last;
}

async function batchRetryTransient(operations){
  let last=null;
  for(let attempt=1;attempt<=3;attempt++){
    last=await batch(operations);
    if(!transient(last.status))return last;
    await sleep(700*attempt);
  }
  return last;
}

async function cleanupLead(version){
  let currentVersion=Number(version)||0;
  for(let attempt=0;attempt<3;attempt++){
    const result=await batch([{resource:'lead',operation:'delete',id:leadId,baseRowVersion:currentVersion}]);
    if(result.status===200)return result;
    if(result.status!==504)return result;
    await new Promise(resolve=>setTimeout(resolve,1200*(attempt+1)));
    const snapshot=await state();
    const stillThere=(snapshot.leads||[]).some(item=>String(item.id)===leadId);
    if(!stillThere)return{status:200,data:{ok:true,timeoutRecovered:true,rowVersions:{['lead:'+leadId]:null},revision:Number(snapshot.revision)||0}};
    currentVersion=rowVersion(snapshot,'lead',leadId);
  }
  return{status:504,data:{error:'cleanup_timeout_after_retries'}};
}

try{
  const before=await state();
  report.baseline={revision:Number(before.revision)||0,leadCount:(before.leads||[]).length};

  const note1={id:'NOTE-'+suffix+'-1',text:'Phase 5 frontend batch create',at:new Date().toISOString()};
  const create=await batchWithRecovery([
    {resource:'lead',operation:'create',id:leadId,input:{
      id:leadId,name:'Phase 5 Frontend',contact:'phase5-'+suffix.toLowerCase()+'@example.invalid',
      model:'Frontend entity validation',budget:41000,source:'Mini App',manager:'Не назначен',
      status:'Новый',priority:'Средний',nextAction:new Date().toISOString().slice(0,10),
      createdAt:new Date().toISOString(),clientCreated:false
    }},
    {resource:'note',operation:'create',leadId,input:note1}
  ],snapshot=>
    (snapshot.leads||[]).some(item=>String(item.id)===leadId)&&
    (snapshot.notes?.[leadId]||[]).some(item=>String(item.id)===note1.id)
  );
  report.created=create;
  if(create.status!==200||!Number(create.data?.rowVersions?.['lead:'+leadId])){
    throw new Error('frontend_batch_create_failed:'+JSON.stringify(create));
  }

  const afterCreate=await state();
  const v1=rowVersion(afterCreate,'lead',leadId);
  if(!v1||!(afterCreate.leads||[]).some(item=>String(item.id)===leadId)){
    throw new Error('frontend_batch_create_not_visible');
  }
  if(!(afterCreate.notes?.[leadId]||[]).some(item=>String(item.id)===note1.id)){
    throw new Error('frontend_batch_note_not_visible');
  }

  const note2={id:'NOTE-'+suffix+'-2',text:'Phase 5 frontend batch patch',at:new Date().toISOString()};
  const patch=await batchWithRecovery([
    {resource:'lead',operation:'patch',id:leadId,baseRowVersion:v1,input:{priority:'Высокий'}},
    {resource:'note',operation:'create',leadId,baseRowVersion:v1,input:note2}
  ],snapshot=>{
    const lead=(snapshot.leads||[]).find(item=>String(item.id)===leadId);
    return lead?.priority==='Высокий'&&(snapshot.notes?.[leadId]||[]).some(item=>String(item.id)===note2.id);
  });
  report.patched=patch;
  if(patch.status!==200)throw new Error('frontend_batch_patch_failed:'+JSON.stringify(patch));

  const afterPatch=await state();
  const v2=rowVersion(afterPatch,'lead',leadId);
  const patchedLead=(afterPatch.leads||[]).find(item=>String(item.id)===leadId);
  if(!(v2>v1)||patchedLead?.priority!=='Высокий')throw new Error('frontend_batch_version_not_advanced');

  const stale=await batchRetryTransient([
    {resource:'lead',operation:'patch',id:leadId,baseRowVersion:v1,input:{priority:'Низкий'}}
  ]);
  report.stale=stale;
  if(stale.status!==409||stale.data?.error!=='entity_conflict'||Number(stale.data?.currentRowVersion)!==v2){
    throw new Error('frontend_batch_stale_not_rejected:'+JSON.stringify(stale));
  }

  const cleanup=await cleanupLead(v2);
  report.cleanup=cleanup;
  if(cleanup.status!==200||cleanup.data?.rowVersions?.['lead:'+leadId]!==null){
    throw new Error('frontend_batch_cleanup_failed:'+JSON.stringify(cleanup));
  }

  const finalState=await state();
  if((finalState.leads||[]).some(item=>String(item.id)===leadId))throw new Error('frontend_batch_cleanup_lead_still_present');
  if(Object.prototype.hasOwnProperty.call(finalState.notes||{},leadId)&&(finalState.notes[leadId]||[]).length){
    throw new Error('frontend_batch_cleanup_notes_still_present');
  }

  const parity=await request('/api/auto-sale/admin/read-parity');
  report.parity=parity;
  if(parity.status!==200||parity.data?.source!=='normalized'||parity.data?.fallback!==false||parity.data?.authoritative!==true||parity.data?.shadowVerified!==false){
    throw new Error('frontend_batch_parity_failed:'+JSON.stringify(parity));
  }

  report.ok=true;
  report.versions={created:v1,patched:v2};
  report.finalRevision=Number(finalState.revision)||0;
  await writeFile('ydb-frontend-batch-live-report.json',JSON.stringify(report,null,2));
  console.log('AUTO_SALE_PHASE5_FRONTEND_BATCH_LIVE_OK',JSON.stringify({
    leadId,createdRowVersion:v1,patchedRowVersion:v2,
    staleCurrentRowVersion:stale.data.currentRowVersion,
    cleanupRevision:cleanup.data.revision,parityRevision:parity.data.revision
  }));
}finally{
  try{
    const current=await state();
    const version=rowVersion(current,'lead',leadId);
    if(version){
      await cleanupLead(version);
    }
  }catch{}
}
