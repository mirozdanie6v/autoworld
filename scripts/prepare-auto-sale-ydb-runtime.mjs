import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbStateStore} from '../server/ydb-state.mjs';

const connectionString=String(process.env.YDB_CONNECTION_STRING||'').trim();
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'').trim();
if(!connectionString)throw new Error('YDB_CONNECTION_STRING is required');
if(!token)throw new Error('YDB_ACCESS_TOKEN_CREDENTIALS is required');

const store=await createYdbStateStore({
  connectionString,
  credentialsProvider:new AccessTokenCredentialsProvider({token}),
  domainDualWrite:false,
  ensureSchema:true
});
try{
  await store.ping();
  const state=await store.loadState();
  console.log('AUTO_SALE_YDB_RUNTIME_SCHEMA_OK',JSON.stringify({revision:Number(state.revision)||0,initialized:Boolean(state.initialized)}));
}finally{
  await store.close();
}
