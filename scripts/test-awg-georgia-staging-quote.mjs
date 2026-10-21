// Isolated remote YDB staging smoke for VII-179. Never touches production or sends notifications.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {createYdbStateStore} from '../server/ydb-state.mjs';
import {mutateAutoSaleEntityBatch,deleteAutoSaleLeadCascade} from '../server/ydb-entity-commands.mjs';
import {sanitizeClientOperations,stateForAccess} from '../server/auto-sale-access.mjs';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {AWG_GEORGIA_TARIFF_VERSION,AWG_GEORGIA_QUOTE_SCHEMA,georgiaQuoteAmounts} from '../public/auto-sale-georgia-quote.mjs';
import {calculateQuote} from '../public/auto-sale-core.mjs';

const STAGING='grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnhujtu1t6f89tdtohs';
if(process.env.YDB_CONNECTION_STRING!==STAGING)throw Error('refusing_non_isolated_staging_database');
const token=String(process.env.YDB_ACCESS_TOKEN_CREDENTIALS||'');
if(!token)throw Error('no_staging_access_token');
const credentialsProvider=new AccessTokenCredentialsProvider({token});
const domainStore=await createYdbDomainStore({connectionString:STAGING,credentialsProvider,ensureSchema:false});
const legacyStore=await createYdbStateStore({connectionString:STAGING,credentialsProvider,ensureSchema:false,domainDualWrite:false});
const random=randomUUID();
const leadId='L-AWG-GEO-STAGE-'+random,quoteId='Q-AWG-GEO-STAGE-'+random;
const identity={provider:'vk',id:'999999887',key:'vk:999999887'};
const user={provider:'vk',id:identity.id,first_name:'Грузия',last_name:'Автотест'};
const batch=operations=>mutateAutoSaleEntityBatch({legacyStore,domainStore,operations,prepareNotifications:null,maxAttempts:2});
let created=false,checks=0;
function check(condition,label){assert.ok(condition,label);checks++;}
try{
  const initial=await domainStore.loadState();
  check(initial.initialized,'staging YDB initialized');
  check(!initial.leads.some(x=>x.id===leadId),'synthetic ID unused');
  const now=new Date().toISOString();
  const leadInput={id:leadId,name:'TEST AWG Georgian quote',contact:'vk:999999887',model:'Toyota Camry test',
    origin:'Грузия',status:'Новый',budget:15000,source:'Mini App',nextAction:now.slice(0,10)};
  const sanitized=sanitizeClientOperations(initial,[{resource:'lead',operation:'create',id:leadId,input:leadInput}],user,identity);
  check(sanitized.ok,'client lead authorized via VK identity');
  const made=await batch(sanitized.operations);
  check(made.status===200,'synthetic lead created');
  created=true;
  const fields={id:quoteId,leadId,model:'Toyota Camry test',origin:'Грузия',status:'Отправлен',version:1,
    tariffVersion:AWG_GEORGIA_TARIFF_VERSION,quoteSchema:AWG_GEORGIA_QUOTE_SCHEMA,
    transportMode:'Доставка под ключ',ageCategory:'3to5',manufactureDate:'2023-02',
    engineCc:2000,powerHp:150,engineType:'petrol',importerType:'nat',
    lot:15000,turnkeyDeliveryUsd:900.50,legalization:4000,service:1000,
    customsRub:420000,recyclingRub:100000,usdRubRate:100,
    exchangeRateDate:'2026-10-21',exchangeRateSource:'cbr',internationalTransferPercent:3.5,
    comment:'STAGING_INTERNAL_ONLY'};
  const amounts=georgiaQuoteAmounts(fields);
  const quote={...fields,...amounts,total:calculateQuote(amounts),updatedAt:now};
  check(quote.total===26657.02&&quote.cryptoFee===556.52,'agreed transfer and delivery calculation');
  const invalid=await batch([{resource:'quote',operation:'create',id:quoteId,input:{...quote,cryptoFee:525}}]);
  check(invalid.status===400&&invalid.data.error==='invalid_quote','server rejects underpriced transfer');
  const before=await domainStore.loadState();
  const published=await batch([{resource:'quote',operation:'create',id:quoteId,input:quote}]);
  check(published.status===200,'manager quote persisted in staging');
  let state=await domainStore.loadState();
  let saved=state.quotes.find(x=>x.id===quoteId);
  check(saved?.total===26657.02&&saved?.turnkeyDeliveryUsd===900.50,'price survives staging readback');
  check(stateForAccess(state,{role:'client',identity}).quotes.some(x=>x.id===quoteId),'own VK user reads quote');
  check(!stateForAccess(state,{role:'client',identity:{provider:'vk',id:'999999886',key:'vk:999999886'}}).quotes.some(x=>x.id===quoteId),'foreign VK user isolated');
  const notificationService=createTelegramService({token:'123456:TEST_ONLY',fetchImpl:async()=>{throw Error('live_messaging_forbidden')},managerChatIds:''});
  const planned=await notificationService.collectStateChanges({...before,initialized:true},{...state,initialized:true},
    {telegramEnabled:false,vkEnabled:true});
  check(planned.some(x=>x.event==='quote_status'&&x.channel==='vk'&&x.vkUserId===identity.id),'VK quote notification planned, not delivered');
  const rowVersion=await domainStore.entityRowVersion('quote',quoteId);
  const forged=sanitizeClientOperations(state,[{resource:'quote',operation:'patch',id:quoteId,
    baseRowVersion:rowVersion,input:{clientDecision:'agreed',total:1,cryptoFee:0,turnkeyDeliveryUsd:0}}],user,identity);
  check(forged.ok,'VK client approval authorized');
  check(!Object.hasOwn(forged.operations[0].input,'total')&&!Object.hasOwn(forged.operations[0].input,'cryptoFee'),
    'client cannot rewrite financial fields');
  const approval=await batch(forged.operations);
  check(approval.status===200,'VK client approval saved');
  state=await domainStore.loadState();saved=state.quotes.find(x=>x.id===quoteId);
  check(saved?.status==='Согласован'&&saved?.clientDecision==='agreed','client decision persisted');
  check(saved?.total===26657.02&&saved?.cryptoFee===556.52&&saved?.turnkeyDeliveryUsd===900.50,'approved total immutable');
  const currentVersion=await domainStore.entityRowVersion('quote',quoteId);
  const tamper=await batch([{resource:'quote',operation:'patch',id:quoteId,baseRowVersion:currentVersion,
    input:{exchangeRateSource:'bank'}}]);
  check(tamper.status===400&&tamper.data.error==='locked_quote_changed','approved quote financial evidence locked');
  console.log('AWG_GEORGIA_STAGING_VERIFIED',JSON.stringify({checks,deliveryUsd:900.5,transferUsd:556.52,totalUsd:26657.02,
    vk:'identity+planned-notification-only',telegram:'no-transport-delivery',database:'isolated-ydb-staging'}));
}finally{
  try{
    if(created){
      const current=await domainStore.entityRowVersion('lead',leadId);
      if(current===null)throw Error('test_lead_missing_before_cleanup');
      const cleanup=await deleteAutoSaleLeadCascade({legacyStore,domainStore,id:leadId,expectedRowVersion:current,maxAttempts:2});
      if(cleanup.status!==200)throw Error('staging_cleanup_failed:'+cleanup.data.error);
      const state=await domainStore.loadState();
      if(state.leads.some(x=>x.id===leadId)||state.quotes.some(x=>x.id===quoteId))throw Error('staging_fixture_leaked');
      console.log('AWG_GEORGIA_STAGING_CLEANUP_OK');
    }
  }finally{await Promise.allSettled([legacyStore.close(),domainStore.close()]);}
}
