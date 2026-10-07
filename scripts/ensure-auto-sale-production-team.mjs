import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {mutateAutoSaleEntityBatch} from '../server/ydb-entity-commands.mjs';
import {canonicalAutoSaleTeam} from '../shared/auto-sale-manager-directory.mjs';

const connectionString=String(process.env.YDB_CONNECTION_STRING||'').trim();
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'').trim();
if(!connectionString)throw new Error('YDB_CONNECTION_STRING is required');
if(!token)throw new Error('YDB_ACCESS_TOKEN_CREDENTIALS is required');

const credentialsProvider=new AccessTokenCredentialsProvider({token});
const legacyStore=await createYdbStateStore({
  connectionString,
  credentialsProvider,
  domainDualWrite:false,
  ensureSchema:true
});
const domainStore=await createYdbDomainStore({
  connectionString,
  credentialsProvider,
  ensureSchema:true
});

try{
  const state=await domainStore.loadState();
  const current=Array.isArray(state.team)?state.team:[];
  if(current.length){
    console.log('AUTO_SALE_PRODUCTION_TEAM_PRESENT',JSON.stringify({
      count:current.length,
      names:current.map(item=>String(item?.name||'')).filter(Boolean)
    }));
  }else{
    const team=canonicalAutoSaleTeam();
    const result=await mutateAutoSaleEntityBatch({
      legacyStore,
      domainStore,
      operations:team.map(member=>({
        resource:'team',
        operation:'create',
        id:member.id,
        input:member
      })),
      prepareNotifications:null
    });
    if(result.status<200||result.status>=300){
      throw new Error('AUTO_SALE_PRODUCTION_TEAM_SEED_FAILED '+JSON.stringify(result.data||{}));
    }
    const after=await domainStore.loadState();
    const actual=Array.isArray(after.team)?after.team:[];
    const expectedNames=team.map(item=>item.name);
    const actualNames=actual.map(item=>String(item?.name||''));
    if(!expectedNames.every(name=>actualNames.includes(name))){
      throw new Error('AUTO_SALE_PRODUCTION_TEAM_VERIFY_FAILED '+JSON.stringify({expectedNames,actualNames}));
    }
    console.log('AUTO_SALE_PRODUCTION_TEAM_SEEDED',JSON.stringify({
      revision:Number(result.data?.revision)||0,
      count:actual.length,
      names:actualNames
    }));
  }
}finally{
  await Promise.allSettled([legacyStore.close(),domainStore.close()]);
}
