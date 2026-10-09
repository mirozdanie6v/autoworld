import {randomUUID} from 'node:crypto';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {sanitizeClientOperations} from '../server/auto-sale-access.mjs';
import {mutateAutoSaleEntityBatch,deleteAutoSaleLeadCascade} from '../server/ydb-entity-commands.mjs';

const ONLY_STAGING='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnhujtu1t6f89tdtohs';
if(process.env.YDB_CONNECTION_STRING!==ONLY_STAGING)throw new Error('non_staging_database_forbidden');
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'');
if(!token)throw new Error('missing_staging_token');
const provider=new AccessTokenCredentialsProvider({token});
const domainStore=await createYdbDomainStore({connectionString:ONLY_STAGING,credentialsProvider:provider,ensureSchema:false});
const legacyStore=await createYdbStateStore({connectionString:ONLY_STAGING,credentialsProvider:provider,ensureSchema:false,domainDualWrite:false});
const leadId='L-VK-STAGING-SMOKE-'+randomUUID();
let created=false,verified=false;
try{
  const before=await domainStore.loadState();
  if(before.catalog?.length!==1||before.catalog[0].id!=='VK-STAGING-DEMO-CAR-001'||before.catalog[0].image!=='https://vk-test.awgcars.ru/favicon-64.webp')
    throw new Error('fixture_not_repaired_or_catalog_modified');
  const identity={provider:'vk',id:'999999890',key:'vk:999999890'};
  const user={provider:'vk',id:identity.id,first_name:'Автотест',last_name:'VK ID'};
  const request={
    id:leadId,name:'Автотест VK ID',contact:'https://vk.com/id999999890',
    model:'Toyota Camry — тест VK ID',origin:'Грузия',budget:15000,
    yearFrom:'2021',yearTo:'2026',mileageMax:'',engine:'Не важно',
    drive:'Не важно',damage:'Минимальные',note:'Только тестовая staging заявка',
    clientCreated:true,status:'Новый',source:'Mini App'
  };
  const ops=[
    {resource:'lead',operation:'create',id:leadId,input:request},
    {resource:'note',operation:'create',leadId,input:{id:'NOTE-VK-STAGING-'+randomUUID(),text:'Автотест создания заявки',at:new Date().toISOString()}}
  ];
  const safe=sanitizeClientOperations(before,ops,user,identity);
  if(!safe.ok)throw new Error('client_sanitization_failed:'+safe.error);
  const result=await mutateAutoSaleEntityBatch({legacyStore,domainStore,operations:safe.operations,prepareNotifications:null,maxAttempts:1});
  if(result.status!==200)throw new Error('test_client_create_failed:'+result.status+':'+JSON.stringify(result.data));
  created=true;
  const loaded=await domainStore.loadState();
  const lead=loaded.leads?.find(x=>x.id===leadId);
  if(!lead||lead.clientProvider!=='vk'||String(lead.clientProviderUserId)!==identity.id||
     lead.name!=='Автотест VK ID'||lead.budget!==15000||
     (loaded.notes?.[leadId]?.length||0)!==1)
    throw new Error('test_client_created_lead_readback_failed');
  verified=true;
  console.log('STAGING_VK_SYNTHETIC_LEAD_CREATE_VERIFIED',JSON.stringify({id:leadId,revision:loaded.revision,provider:lead.clientProvider,budget:lead.budget,notes:loaded.notes[leadId].length}));
}finally{
  try{
    if(created){
      const rowVersion=await domainStore.entityRowVersion('lead',leadId);
      if(!rowVersion)throw new Error('test_lead_missing_before_cleanup');
      const cleaned=await deleteAutoSaleLeadCascade({legacyStore,domainStore,id:leadId,expectedRowVersion:rowVersion,maxAttempts:1});
      if(cleaned.status!==200)throw new Error('test_lead_cleanup_failed:'+cleaned.status+':'+cleaned.data?.error);
      const finalState=await domainStore.loadState();
      if(finalState.leads.some(x=>x.id===leadId)||finalState.notes?.[leadId]?.length)throw new Error('test_lead_cleanup_readback_failed');
      console.log('STAGING_VK_SYNTHETIC_LEAD_CLEANED',JSON.stringify({id:leadId,revision:finalState.revision}));
    }
  }finally{
    await Promise.allSettled([domainStore.close(),legacyStore.close()]);
  }
}
if(!verified)throw new Error('lead_not_verified');
