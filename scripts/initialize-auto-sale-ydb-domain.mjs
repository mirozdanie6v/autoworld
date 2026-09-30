import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {legacyStateToDomainRows} from '../server/ydb-domain-migration.mjs';

const connectionString=String(process.env.YDB_CONNECTION_STRING||'').trim();
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'').trim();

if(!connectionString)throw new Error('YDB_CONNECTION_STRING is required');
if(!token)throw new Error('YDB_ACCESS_TOKEN_CREDENTIALS is required');

const credentialsProvider=new AccessTokenCredentialsProvider({token});
const legacy=await createYdbStateStore({connectionString,credentialsProvider,ensureSchema:true,domainDualWrite:false});
const domain=await createYdbDomainStore({connectionString,credentialsProvider,ensureSchema:true});

try{
  const existingMeta=await domain.migrationMeta();
  if(existingMeta){
    console.log('AUTO_SALE_YDB_DOMAIN_ALREADY_INITIALIZED',JSON.stringify({
      sourceRevision:Number(existingMeta.sourceRevision)||0,
      schemaVersion:Number(existingMeta.schemaVersion)||0,
      migrationStatus:String(existingMeta.migrationStatus||'')
    }));
    process.exitCode=0;
  }else{
    const counts=await domain.counts();
    const nonEmpty=Object.entries(counts||{}).filter(([,value])=>Number(value)>0);
    if(nonEmpty.length){
      throw new Error('normalized_domain_has_rows_without_meta:'+JSON.stringify(nonEmpty));
    }
    const source=await legacy.loadState();
    const sourceRevision=Number(source.revision)||0;
    const mapped=legacyStateToDomainRows(source);
    await domain.replaceSnapshot(mapped,{sourceRevision,status:'initialized'});
    const meta=await domain.migrationMeta();
    if(!meta)throw new Error('normalized_state_meta_initialization_failed');
    console.log('AUTO_SALE_YDB_DOMAIN_INITIALIZED',JSON.stringify({
      sourceRevision:Number(meta.sourceRevision)||sourceRevision,
      schemaVersion:Number(meta.schemaVersion)||0,
      migrationStatus:String(meta.migrationStatus||'initialized'),
      counts:await domain.counts()
    }));
  }
}finally{
  await Promise.allSettled([legacy.close(),domain.close()]);
}
