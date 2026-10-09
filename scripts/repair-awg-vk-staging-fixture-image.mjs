import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {mutateAutoSaleEntity} from '../server/ydb-entity-commands.mjs';

const ONLY_STAGING='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnhujtu1t6f89tdtohs';
const OLD_IMAGE='/favicon-64.webp';
const NEW_IMAGE='https://vk-test.awgcars.ru/favicon-64.webp';
const CAR_ID='VK-STAGING-DEMO-CAR-001';

if(process.env.YDB_CONNECTION_STRING!==ONLY_STAGING)throw new Error('refusing_non_staging_ydb');
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'');
if(!token)throw new Error('staging_ydb_token_missing');
const credentialsProvider=new AccessTokenCredentialsProvider({token});
const domainStore=await createYdbDomainStore({connectionString:ONLY_STAGING,credentialsProvider,ensureSchema:false});
const legacyStore=await createYdbStateStore({connectionString:ONLY_STAGING,credentialsProvider,ensureSchema:false,domainDualWrite:false});
try{
  const before=await domainStore.loadState();
  const cars=before.catalog||[];
  if(cars.length!==1||cars[0].id!==CAR_ID||cars[0].source!=='isolated-staging-fixture'||cars[0].brand!=='Toyota'||!String(cars[0].model||'').includes('тест VK ID'))
    throw new Error('unexpected_staging_catalog_abort');
  if(cars[0].image===NEW_IMAGE){
    console.log('STAGING_FIXTURE_IMAGE_ALREADY_VALID',JSON.stringify({id:CAR_ID,revision:before.revision}));
    process.exitCode=0;
  }else{
    if(cars[0].image!==OLD_IMAGE)throw new Error('unexpected_old_image_abort');
    const version=await domainStore.entityRowVersion('catalog',CAR_ID);
    if(!Number.isInteger(version)||version<=0)throw new Error('invalid_fixture_row_version');
    // Edit the single existing staging record through the same revision-checked
    // normalized writer as production. Never reset/reseed the database.
    const result=await mutateAutoSaleEntity({
      legacyStore,domainStore,resource:'catalog',operation:'patch',
      id:CAR_ID,input:{image:NEW_IMAGE},
      expectedRowVersion:version,prepareNotifications:null,maxAttempts:1
    });
    if(result.status!==200)throw new Error('fixture_update_rejected:'+result.status+':'+result.data?.error);
    const after=await domainStore.loadState();
    if(after.catalog?.length!==1||after.catalog[0].id!==CAR_ID||after.catalog[0].image!==NEW_IMAGE)
      throw new Error('staging_fixture_readback_mismatch');
    if(after.leads?.length!==before.leads?.length||after.orders?.length!==before.orders?.length||
       after.quotes?.length!==before.quotes?.length||after.team?.length!==before.team?.length)
      throw new Error('unexpected_staging_entity_count_change');
    console.log('STAGING_FIXTURE_IMAGE_REPAIRED',JSON.stringify({id:CAR_ID,revisionBefore:before.revision,revisionAfter:after.revision,leads:after.leads?.length||0,image:after.catalog[0].image}));
  }
}finally{
  await Promise.allSettled([legacyStore.close(),domainStore.close()]);
}
