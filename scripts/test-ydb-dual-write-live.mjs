import {writeFile} from 'node:fs/promises';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {compareLegacyAndDomainState} from '../server/ydb-domain-migration.mjs';

const base=String(process.env.STAGING_URL||'').replace(/\/$/,'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
const connectionString=String(process.env.YDB_CONNECTION_STRING||'');
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'');

if(!base)throw new Error('STAGING_URL is required');
if(!apiKey)throw new Error('AUTO_SALE_API_KEY is required');
if(!connectionString)throw new Error('YDB_CONNECTION_STRING is required');
if(!token)throw new Error('YDB_ACCESS_TOKEN_CREDENTIALS is required');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clone=value=>structuredClone(value);
const headers={
  'content-type':'application/json',
  'x-auto-sale-key':apiKey,
  'x-auto-sale-skip-telegram':'1'
};

async function getState(){
  const response=await fetch(base+'/api/auto-sale/state',{headers:{'x-auto-sale-key':apiKey},cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('GET state failed: '+response.status+' '+JSON.stringify(data));
  return data;
}

async function mutate(mutator){
  for(let attempt=1;attempt<=10;attempt++){
    const state=await getState();
    const next=clone(state);
    mutator(next);
    const payload={...next,baseRevision:Number(state.revision)||0};
    delete payload.revision;
    const response=await fetch(base+'/api/auto-sale/state',{method:'PUT',headers,body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(response.ok)return{before:state,after:await getState(),result:data,attempt};
    if(response.status!==409)throw new Error('PUT state failed: '+response.status+' '+JSON.stringify(data));
    await sleep(120*attempt);
  }
  throw new Error('PUT state failed after revision-conflict retries');
}

const domain=await createYdbDomainStore({
  connectionString,
  credentialsProvider:new AccessTokenCredentialsProvider({token})
});

async function stableParity(){
  for(let attempt=1;attempt<=12;attempt++){
    const before=await getState();
    const rows=await domain.loadRows();
    const meta=await domain.migrationMeta();
    const after=await getState();
    if(Number(before.revision)!==Number(after.revision)||Number(meta?.sourceRevision)!==Number(after.revision)){
      await sleep(120*attempt);
      continue;
    }
    const parity=compareLegacyAndDomainState(after,rows);
    return{
      ok:parity.ok,
      revision:Number(after.revision)||0,
      sourceRevision:Number(meta?.sourceRevision)||0,
      migrationStatus:meta?.migrationStatus||'',
      legacyHash:parity.legacyHash,
      normalizedHash:parity.domainHash,
      counts:parity.counts
    };
  }
  throw new Error('Could not obtain stable legacy/shadow revision for parity check');
}

const suffix=Date.now().toString(36).toUpperCase();
const leadId='L-DUAL-'+suffix;
const report={leadId,created:null,createdParity:null,removed:null,removedParity:null};

try{
  const health=await fetch(base+'/api/health',{cache:'no-store'}).then(r=>r.json());
  if(health.ydbDomainDualWrite!=='enabled')throw new Error('dual_write_not_enabled');

  const created=await mutate(state=>{
    if(state.leads?.some(item=>String(item.id)===leadId))return;
    const manager=(state.team||[]).find(item=>item?.active!==false)?.name||'Не назначен';
    state.leads=Array.isArray(state.leads)?state.leads:[];
    state.leads.push({
      id:leadId,
      name:'Phase 2 Dual Write',
      contact:'phase2-'+suffix.toLowerCase()+'@example.invalid',
      model:'Phase 2 transactional test',
      budget:35000,
      source:'Mini App',
      manager,
      status:'Новый',
      priority:'Средний',
      createdAt:new Date().toISOString(),
      nextAction:new Date().toISOString().slice(0,10),
      note:'Temporary transactional dual-write verification',
      clientCreated:false
    });
  });
  report.created={
    revision:created.result.revision,
    attempt:created.attempt,
    dualWrite:created.result.domainDualWrite||null
  };
  if(created.result?.domainDualWrite?.enabled!==true)throw new Error('create_response_missing_dual_write');
  if(Number(created.result?.domainDualWrite?.diff?.leads?.upserts||0)<1)throw new Error('create_response_missing_lead_upsert');

  report.createdParity=await stableParity();
  if(!report.createdParity.ok)throw new Error('parity_failed_after_create');

  const removed=await mutate(state=>{
    state.leads=(state.leads||[]).filter(item=>String(item.id)!==leadId);
    if(state.notes&&typeof state.notes==='object')delete state.notes[leadId];
  });
  report.removed={
    revision:removed.result.revision,
    attempt:removed.attempt,
    dualWrite:removed.result.domainDualWrite||null
  };
  if(removed.result?.domainDualWrite?.enabled!==true)throw new Error('remove_response_missing_dual_write');
  if(Number(removed.result?.domainDualWrite?.diff?.leads?.deletes||0)!==1)throw new Error('remove_response_missing_lead_delete');

  report.removedParity=await stableParity();
  if(!report.removedParity.ok)throw new Error('parity_failed_after_remove');

  report.ok=true;
  await writeFile('ydb-dual-write-live-report.json',JSON.stringify(report,null,2));
  console.log('AUTO_SALE_YDB_DUAL_WRITE_LIVE_OK',JSON.stringify(report));
}finally{
  try{
    const state=await getState();
    if((state.leads||[]).some(item=>String(item.id)===leadId)){
      await mutate(current=>{
        current.leads=(current.leads||[]).filter(item=>String(item.id)!==leadId);
        if(current.notes&&typeof current.notes==='object')delete current.notes[leadId];
      });
    }
  }finally{
    await domain.close();
  }
}
