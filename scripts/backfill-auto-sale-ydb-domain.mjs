import {writeFile} from 'node:fs/promises';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {canonicalAutoSaleState,compareLegacyAndDomainState,legacyStateToDomainRows} from '../server/ydb-domain-migration.mjs';

const connectionString=String(process.env.YDB_CONNECTION_STRING||'').trim();
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'').trim();
const maxAttempts=Math.max(2,Number(process.env.AUTO_SALE_BACKFILL_ATTEMPTS||6));

if(!connectionString)throw new Error('YDB_CONNECTION_STRING is required');
if(!token)throw new Error('YDB_ACCESS_TOKEN_CREDENTIALS is required');

const credentialsProvider=new AccessTokenCredentialsProvider({token});
const legacy=await createYdbStateStore({connectionString,credentialsProvider});
const domain=await createYdbDomainStore({connectionString,credentialsProvider});

const ids=state=>({
  leads:(state.leads||[]).map(x=>String(x.id||'')),
  quotes:(state.quotes||[]).map(x=>String(x.id||'')),
  orders:(state.orders||[]).map(x=>String(x.id||'')),
  team:(state.team||[]).map(x=>String(x.id||'')),
  catalog:(state.catalog||[]).map(x=>String(x.id||''))
});
const sameIds=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const kind=value=>Array.isArray(value)?'array':value===null?'null':typeof value;

function diffPaths(left,right,path='$',out=[]){
  if(out.length>=80)return out;
  if(Object.is(left,right))return out;
  if(kind(left)!==kind(right)){
    out.push({path,left:kind(left),right:kind(right)});
    return out;
  }
  if(Array.isArray(left)){
    if(left.length!==right.length)out.push({path:path+'.length',left:left.length,right:right.length});
    const n=Math.min(left.length,right.length);
    for(let i=0;i<n&&out.length<80;i++)diffPaths(left[i],right[i],path+'['+i+']',out);
    return out;
  }
  if(left&&typeof left==='object'){
    const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort();
    for(const key of keys){
      if(out.length>=80)break;
      if(!Object.prototype.hasOwnProperty.call(left,key)){
        out.push({path:path+'.'+key,left:'missing',right:kind(right[key])});
        continue;
      }
      if(!Object.prototype.hasOwnProperty.call(right,key)){
        out.push({path:path+'.'+key,left:kind(left[key]),right:'missing'});
        continue;
      }
      diffPaths(left[key],right[key],path+'.'+key,out);
    }
    return out;
  }
  out.push({path,left:kind(left),right:kind(right)});
  return out;
}

let report=null;
try{
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const source=await legacy.loadState();
    const sourceRevision=Number(source.revision)||0;
    const mapped=legacyStateToDomainRows(source);

    await domain.replaceSnapshot(mapped,{sourceRevision,status:'backfilled'});

    const afterWrite=await legacy.loadState();
    if(Number(afterWrite.revision)!==sourceRevision){
      console.log('AUTO_SALE_YDB_BACKFILL_RETRY',JSON.stringify({
        attempt,
        reason:'source_revision_changed_during_backfill',
        from:sourceRevision,
        to:Number(afterWrite.revision)||0
      }));
      await sleep(150*attempt);
      continue;
    }

    const normalized=await domain.loadRows();
    const parity=compareLegacyAndDomainState(afterWrite,normalized);
    const reconstructedIds=ids(parity.reconstructed);
    const sourceIds=ids(afterWrite);
    const idParity=sameIds(sourceIds,reconstructedIds);
    const meta=await domain.migrationMeta();

    const finalSource=await legacy.loadState();
    if(Number(finalSource.revision)!==sourceRevision){
      console.log('AUTO_SALE_YDB_BACKFILL_RETRY',JSON.stringify({
        attempt,
        reason:'source_revision_changed_during_parity',
        from:sourceRevision,
        to:Number(finalSource.revision)||0
      }));
      await sleep(150*attempt);
      continue;
    }

    report={
      ok:Boolean(parity.ok&&idParity&&meta?.sourceRevision===sourceRevision&&meta?.schemaVersion===1),
      attempt,
      sourceRevision,
      schemaVersion:meta?.schemaVersion||0,
      migrationStatus:meta?.migrationStatus||'',
      legacyHash:parity.legacyHash,
      normalizedHash:parity.domainHash,
      hashParity:parity.ok,
      idParity,
      sourceIds,
      reconstructedIds,
      counts:parity.counts,
      diffPaths:diffPaths(canonicalAutoSaleState(afterWrite),canonicalAutoSaleState(parity.reconstructed)),
      telegramBindings:(normalized.telegramBindings||[]).map(x=>({
        subjectType:x.subjectType,
        subjectId:x.subjectId,
        linked:Boolean(x.telegramUserId)
      }))
    };
    await writeFile('ydb-domain-backfill-report.json',JSON.stringify(report,null,2));
    if(!report.ok){
      throw new Error('Normalized YDB parity check failed: '+JSON.stringify({
        sourceRevision,
        hashParity:report.hashParity,
        idParity:report.idParity,
        diffPaths:report.diffPaths
      }));
    }
    console.log('AUTO_SALE_YDB_DOMAIN_BACKFILL_OK',JSON.stringify(report));
    break;
  }

  if(!report?.ok)throw new Error(`Could not obtain a stable source revision after ${maxAttempts} attempts`);
}finally{
  await Promise.allSettled([legacy.close(),domain.close()]);
}
