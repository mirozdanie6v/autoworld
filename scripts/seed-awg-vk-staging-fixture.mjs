import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {legacyStateToDomainRows} from '../server/ydb-domain-migration.mjs';

const STAGING_CONNECTION='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnhujtu1t6f89tdtohs';
const connection=String(process.env.YDB_CONNECTION_STRING||'');
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'');
if(connection!==STAGING_CONNECTION)throw new Error('refusing_non_staging_ydb_target');
if(!token)throw new Error('staging_ydb_auth_missing');
const store=await createYdbDomainStore({
  connectionString:connection,
  credentialsProvider:new AccessTokenCredentialsProvider({token}),
  ensureSchema:false
});
try{
  const meta=await store.migrationMeta();
  if(!meta||meta.migrationStatus!=='initialized'||Number(meta.sourceRevision)!==0)
    throw new Error('staging_meta_not_fresh_initialized');
  const before=await store.counts();
  if(Object.values(before).some(value=>Number(value)!==0))throw new Error('staging_ydb_not_empty_refusing_fixture_reset');

  const car={
    id:'VK-STAGING-DEMO-CAR-001',
    brand:'Toyota',
    model:'Camry — тест VK ID',
    year:2021,
    price:12000,
    origin:'Грузия',
    mileage:45000,
    engine:'2.5',
    active:true,
    tag:'ТЕСТ · Не продаётся',
    image:'/favicon-64.webp',
    description:'Тестовый автомобиль для проверки авторизации VK ID и оформления заявки. Не является предложением о продаже.',
    source:'isolated-staging-fixture'
  };
  const rows=legacyStateToDomainRows({
    initialized:true, leads:[],quotes:[],orders:[],notes:{},team:[],catalog:[car]
  });
  await store.replaceSnapshot(rows,{sourceRevision:0,status:'staging-fixture'});
  const after=await store.counts();
  const snapshot=await store.loadState();
  if(after.auto_sale_catalog!==1||Object.entries(after).some(([key,value])=>key!=='auto_sale_catalog'&&value!==0))
    throw new Error('unexpected_staging_fixture_counts');
  if(!snapshot.initialized||snapshot.catalog?.[0]?.id!==car.id)throw new Error('staging_fixture_readback_failed');
  console.log('STAGING_VK_FIXTURE_READY',JSON.stringify({database:'etnhujtu1t6f89tdtohs',catalog:after.auto_sale_catalog,leads:after.auto_sale_leads,initialized:snapshot.initialized,id:car.id}));
}finally{
  await store.close();
}
