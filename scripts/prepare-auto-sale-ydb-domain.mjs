import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {AUTO_SALE_DOMAIN_SCHEMA_VERSION,AUTO_SALE_DOMAIN_TABLES,createYdbDomainStore} from '../server/ydb-domain-store.mjs';

const connectionString=String(process.env.YDB_CONNECTION_STRING||'').trim();
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'').trim();

if(!connectionString)throw new Error('YDB_CONNECTION_STRING is required');
if(!token)throw new Error('YDB_ACCESS_TOKEN_CREDENTIALS is required');

const store=await createYdbDomainStore({
  connectionString,
  credentialsProvider:new AccessTokenCredentialsProvider({token})
});

try{
  const version=await store.schemaVersion();
  if(version!==AUTO_SALE_DOMAIN_SCHEMA_VERSION){
    throw new Error(`Unexpected domain schema version: expected=${AUTO_SALE_DOMAIN_SCHEMA_VERSION} actual=${version}`);
  }
  const counts=await store.counts();
  console.log('AUTO_SALE_YDB_DOMAIN_SCHEMA_OK',JSON.stringify({
    version,
    tables:AUTO_SALE_DOMAIN_TABLES,
    counts
  }));
}finally{
  await store.close();
}
