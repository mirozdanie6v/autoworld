import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbStateStore} from '../server/ydb-state.mjs';

const sourceUrl=String(process.env.SOURCE_STATE_URL||'https://auto-sale.viiversion.com/api/auto-sale/state').trim();
const connectionString=String(process.env.YDB_CONNECTION_STRING||'').trim();
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'').trim();

if(!connectionString)throw new Error('YDB_CONNECTION_STRING is required');
if(!token)throw new Error('YDB_ACCESS_TOKEN_CREDENTIALS is required');

const response=await fetch(sourceUrl,{headers:{accept:'application/json'},cache:'no-store'});
if(!response.ok)throw new Error(`Source state request failed: ${response.status}`);
const state=await response.json();

const counts={
  leads:Array.isArray(state.leads)?state.leads.length:0,
  quotes:Array.isArray(state.quotes)?state.quotes.length:0,
  orders:Array.isArray(state.orders)?state.orders.length:0,
  notes:Object.values(state.notes||{}).reduce((n,list)=>n+(Array.isArray(list)?list.length:0),0),
  team:Array.isArray(state.team)?state.team.length:0,
  catalog:Array.isArray(state.catalog)?state.catalog.length:0
};

const store=await createYdbStateStore({
  connectionString,
  credentialsProvider:new AccessTokenCredentialsProvider({token})
});

try{
  const result=await store.replaceState(state);
  if(result.status!==200)throw new Error(`YDB import failed: ${JSON.stringify(result.data)}`);
  const imported=await store.loadState();
  const importedCounts={
    leads:imported.leads.length,
    quotes:imported.quotes.length,
    orders:imported.orders.length,
    notes:Object.values(imported.notes||{}).reduce((n,list)=>n+(Array.isArray(list)?list.length:0),0),
    team:imported.team.length,
    catalog:imported.catalog.length
  };
  for(const key of Object.keys(counts)){
    if(counts[key]!==importedCounts[key])throw new Error(`Count mismatch for ${key}: source=${counts[key]} ydb=${importedCounts[key]}`);
  }
  console.log('AUTO_SALE_YDB_MIGRATION_OK',JSON.stringify({sourceRevision:state.revision||0,ydbRevision:imported.revision,counts:importedCounts}));
}finally{
  await store.close();
}
