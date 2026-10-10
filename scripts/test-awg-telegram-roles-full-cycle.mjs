import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';

const base=String(process.env.STAGING_URL||'').replace(/\/$/,'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
if(!base)throw new Error('STAGING_URL required');
if(!apiKey)throw new Error('AUTO_SALE_API_KEY required');
const botToken=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'').trim();
assert.ok(botToken,'bot token required for QA Telegram signatures');
const actors={
  client:JSON.parse(process.env.AUDIT_CLIENT_USER||'null'),
  manager:JSON.parse(process.env.AUDIT_MANAGER_USER||'null')
};
assert.ok(actors.client?.id&&actors.manager?.id,'verified physical identities required');
function signInitData(user){
  const p=new URLSearchParams({
    auth_date:String(Math.floor(Date.now()/1000)),
    query_id:'autoworld-qa-'+randomUUID(),
    user:JSON.stringify(user)
  });
  const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
  const secret=createHmac('sha256','WebAppData').update(botToken).digest();
  p.set('hash',createHmac('sha256',secret).update(check).digest('hex'));
  return p.toString();
}
function authHeaders(actor){
  return actor==='admin'
    ?{'x-auto-sale-key':apiKey}
    :{'x-telegram-init-data':signInitData(actors[actor])};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const receipts=[];
const rowVersions={lead:{},quote:{},order:{},team:{},catalog:{}};
const aggregateRef=operation=>{
  const resource=String(operation?.resource||'');
  if(resource==='note')return{resource:'lead',id:String(operation.leadId||operation.id||'')};
  if(resource==='payment')return{resource:'order',id:String(operation.orderId||operation.id||'')};
  return{resource,id:String(operation?.id||operation?.input?.id||'')};
};
const knownVersion=(resource,id)=>Number(rowVersions?.[resource]?.[id]||0);
const applyVersions=map=>{
  for(const [key,value] of Object.entries(map||{})){
    const split=key.indexOf(':');if(split<1)continue;
    const resource=key.slice(0,split),id=key.slice(split+1);
    if(!rowVersions[resource])rowVersions[resource]={};
    if(value===null)delete rowVersions[resource][id];
    else rowVersions[resource][id]=Number(value)||0;
  }
};

async function req(path,options={}){
  const {actor:explicitActor,...requestOptions}=options;
  const actor=explicitActor||((path==='/api/auto-sale/state'||/\/notifications\/|\/admin\//.test(path))?'admin':'manager');
  const body=requestOptions.body&&typeof requestOptions.body!=='string'?JSON.stringify(requestOptions.body):requestOptions.body;
  const response=await fetch(base+path,{
    ...requestOptions,
    body,
    headers:{'content-type':'application/json',...authHeaders(actor),...requestOptions.headers},
    signal:AbortSignal.timeout(45000)
  });
  return{response,data:await response.json().catch(()=>({}))};
}

async function state(){
  let lastError=null;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const {response,data}=await req('/api/auto-sale/state');
      if(response.ok)return data;
      lastError=new Error('state read HTTP '+response.status+': '+JSON.stringify(data));
    }catch(error){lastError=error}
    if(attempt<4)await sleep(600*attempt);
  }
  throw lastError||new Error('state read failed');
}

async function delivered(notifications,expected,label,revision=0){
  assert.equal(notifications?.queued,expected,label+' queued count');
  const ids=notifications?.ids||[];
  assert.equal(ids.length,expected,label+' notification ids');
  let rows=notifications.deliveries||[];
  for(let attempt=0;rows.length!==expected||!rows.every(x=>x.status==='sent'&&x.messageId);attempt++){
    if(attempt>=30)throw new Error(label+' deliveries not confirmed: '+JSON.stringify(rows));
    const query=new URLSearchParams();for(const id of ids)query.append('id',id);
    let checked;
    try{
      checked=await req('/api/auto-sale/notifications/status?'+query);
    }catch(error){
      if(error?.name==='TimeoutError'||/timeout|aborted/i.test(String(error?.message||''))){
        await sleep(900+attempt*250);
        continue;
      }
      throw error;
    }
    if(!checked.response.ok){
      if([500,502,503,504].includes(checked.response.status)){
        if(revision){
          try{
            const fallback=await req('/api/auto-sale/notifications/revision?revision='+revision);
            if(fallback.response.ok){
              const wanted=new Set(ids);
              rows=(fallback.data.deliveries||[]).filter(item=>wanted.has(item.id));
              if(rows.length===expected&&rows.every(x=>x.status==='sent'&&x.messageId))break;
            }
          }catch{}
        }
        await sleep(900+attempt*250);
        continue;
      }
      throw new Error(label+' delivery receipts HTTP '+checked.response.status+': '+JSON.stringify(checked.data));
    }
    rows=checked.data.deliveries||[];
    if(rows.length===expected&&rows.every(x=>x.status==='sent'&&x.messageId))break;
    if(rows.some(x=>x.status==='pending'||x.status==='retry'||x.status==='processing')){
      const processQuery=new URLSearchParams();for(const id of ids)processQuery.append('id',id);
      let processed;
      try{
        processed=await req('/api/auto-sale/notifications/process?'+processQuery,{method:'POST'});
      }catch(error){
        if(error?.name==='TimeoutError'||/timeout|aborted/i.test(String(error?.message||''))){
          await sleep(900+attempt*250);
          continue;
        }
        throw error;
      }
      if(!processed.response.ok){
        if([500,502,503,504].includes(processed.response.status)){
          await sleep(900+attempt*250);
          continue;
        }
        throw new Error(label+' outbox processor HTTP '+processed.response.status+': '+JSON.stringify(processed.data));
      }
    }
    await sleep(1800);
  }
  const expectedClients=label==='Новый'?1:expected/2;
  const expectedManagers=label==='Новый'?3:expected/2;
  assert.equal(rows.filter(x=>x.target==='client').length,expectedClients,label+' client');
  assert.equal(rows.filter(x=>x.target==='manager').length,expectedManagers,label+' manager');
  receipts.push(...rows.map(x=>({id:x.id,target:x.target,event:x.event,messageId:x.messageId,status:x.status,step:label})));
  console.log('TELEGRAM_STEP_OK',JSON.stringify({step:label,deliveries:rows.map(({target,event,messageId})=>({target,event,messageId}))}));
}

const matchesInput=(actual,expected)=>{
  if(Array.isArray(expected))return JSON.stringify(actual)===JSON.stringify(expected);
  if(expected&&typeof expected==='object'){
    if(!actual||typeof actual!=='object')return false;
    return Object.entries(expected).every(([key,value])=>matchesInput(actual[key],value));
  }
  return actual===expected;
};
const operationApplied=(snapshot,operation)=>{
  const resource=String(operation?.resource||'');
  if(resource==='note'){
    const leadId=String(operation.leadId||operation.id||'');
    const id=String(operation.input?.id||'');
    return (snapshot.notes?.[leadId]||[]).some(item=>String(item.id||'')===id&&matchesInput(item,operation.input||{}));
  }
  if(resource==='payment'){
    const orderId=String(operation.orderId||operation.id||'');
    const id=String(operation.input?.id||'');
    const order=(snapshot.orders||[]).find(item=>String(item.id||'')===orderId);
    return (order?.payments||[]).some(item=>String(item.id||'')===id&&matchesInput(item,operation.input||{}));
  }
  const collection=({lead:'leads',quote:'quotes',order:'orders',team:'team',catalog:'catalog'})[resource];
  if(!collection)return false;
  const id=String(operation.id||operation.input?.id||'');
  const entity=(snapshot[collection]||[]).find(item=>String(item.id||'')===id);
  if(operation.operation==='delete')return !entity;
  return Boolean(entity&&matchesInput(entity,operation.input||{}));
};
const syncVersionsFromState=(snapshot,operations)=>{
  for(const operation of operations){
    const ref=aggregateRef(operation);
    if(!ref.resource||!ref.id)continue;
    if(!rowVersions[ref.resource])rowVersions[ref.resource]={};
    const version=Number(snapshot?._rowVersions?.[ref.resource]?.[ref.id]||0);
    if(operation.operation==='delete')delete rowVersions[ref.resource][ref.id];
    else if(version)rowVersions[ref.resource][ref.id]=version;
  }
};
async function recoverCommittedBatch(label,expected,prepared,beforeRevision){
  for(let attempt=1;attempt<=8;attempt++){
    await sleep(900*attempt);
    let snapshot;
    try{snapshot=await state()}catch{continue}
    const revision=Number(snapshot.revision)||0;
    if(revision<=beforeRevision||!prepared.every(operation=>operationApplied(snapshot,operation)))continue;
    syncVersionsFromState(snapshot,prepared);
    const recovered=await req('/api/auto-sale/notifications/revision?revision='+revision);
    if(!recovered.response.ok)continue;
    const rows=recovered.data?.deliveries||[];
    if(rows.length!==expected)continue;
    await delivered({queued:rows.length,ids:rows.map(item=>item.id),deliveries:rows},expected,label,revision);
    console.log('TELEGRAM_BATCH_RECOVERED',JSON.stringify({step:label,revision,attempt}));
    return{ok:true,revision,recovered:true,rowVersions:{}};
  }
  return null;
}

async function batch(label,expected,operations,actor='manager'){
  const prepared=operations.map(operation=>structuredClone(operation));
  const created=new Set(prepared.filter(operation=>
    operation.operation==='create'&&!['note','payment'].includes(String(operation.resource||''))
  ).map(operation=>{
    const ref=aggregateRef(operation);return ref.resource+':'+ref.id;
  }));
  for(const operation of prepared){
    const ref=aggregateRef(operation);
    const childCreate=operation.operation==='create'&&['note','payment'].includes(String(operation.resource||''));
    const topLevelCreate=operation.operation==='create'&&!childCreate;
    if(!ref.resource||!ref.id||topLevelCreate||created.has(ref.resource+':'+ref.id))continue;
    if(operation.baseRowVersion===undefined||operation.baseRowVersion===null){
      const version=knownVersion(ref.resource,ref.id);
      assert.ok(version,label+': missing tracked rowVersion for '+ref.resource+':'+ref.id);
      operation.baseRowVersion=version;
    }
  }

  const before=await state();
  const beforeRevision=Number(before.revision)||0;
  let lastFailure=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const {response,data}=await req('/api/auto-sale/entities/batch',{
        method:'POST',actor,
        body:{operations:prepared}
      });
      if(response.ok){
        applyVersions(data.rowVersions);
        await delivered(data.notifications,expected,label,Number(data.revision)||0);
        await sleep(1200);
        return data;
      }
      lastFailure=new Error(label+': HTTP '+response.status+' '+JSON.stringify(data));
      if(![409,503,504].includes(response.status))throw lastFailure;
    }catch(error){
      lastFailure=error;
      if(error?.name!=='TimeoutError'&&!/timeout|aborted/i.test(String(error?.message||'')))throw error;
    }

    const recovered=await recoverCommittedBatch(label,expected,prepared,beforeRevision);
    if(recovered)return recovered;
    if(attempt<3)await sleep(1200*attempt);
  }
  throw lastFailure||new Error(label+': batch failed after retries');
}

const initial=await state();
const auditManagerTelegramId=String(process.env.AUDIT_MANAGER_TELEGRAM_ID||'').trim();
const auditManagerName=String(process.env.AUDIT_MANAGER_NAME||'Дмитрий').trim();
const auditClientUsername=String(process.env.AUDIT_CLIENT_TELEGRAM_USERNAME||'Flyer_kg').trim().replace(/^@/,'');
const auditClientTelegramId=String(process.env.AUDIT_CLIENT_TELEGRAM_ID||'').trim();
const manager=(initial.team||[]).find(x=>x.active!==false&&String(x.name||'').trim()===auditManagerName&&String(x.telegramUsername||x.telegram||'').replace(/^@/,'').toLowerCase()==='flyer_flyer');
assert.ok(manager,`${auditManagerName} / Flyer_Flyer manager must exist in production team`);
const managerTelegramUserId=/^\d+$/.test(String(manager.telegramUserId||''))?String(manager.telegramUserId):auditManagerTelegramId;
assert.match(managerTelegramUserId,/^\d+$/,'Flyer_Flyer manager Telegram must be linked');
const linkedClientLead=(initial.leads||[]).find(x=>
  String(x.telegramUsername||'').replace(/^@/,'').toLowerCase()===auditClientUsername.toLowerCase()
  && /^\d+$/.test(String(x.telegramUserId||''))
);
const clientTelegramUserId=/^\d+$/.test(auditClientTelegramId)
  ?auditClientTelegramId
  :String(linkedClientLead?.telegramUserId||'');
assert.match(clientTelegramUserId,/^\d+$/,`@${auditClientUsername} client Telegram must be linked through Mini App or provided as AUDIT_CLIENT_TELEGRAM_ID`);
assert.notEqual(clientTelegramUserId,managerTelegramUserId,'Physical Telegram E2E requires distinct client and manager accounts');
const suffix=Date.now().toString(36).toUpperCase();
const leadId='L-QA-'+suffix,quoteId='Q-QA-'+suffix,orderId='O-QA-'+suffix;
const today=new Date().toISOString().slice(0,10),future=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
const model='ТЕСТ · BMW X5 · '+suffix;
const verification={
  lotNumber:'TEST-'+suffix,
  vin:'TESTVIN0000000001',
  year:2022,
  mileage:1000,
  damage:'ТЕСТ: вымышленное досье для проверки приложения',
  photos:[base+'/auto-sale-logo-automir.png'],
  history:'ТЕСТОВЫЕ ДАННЫЕ. Не реальная проверка автомобиля.',
  checkedAt:today,
  result:'Одобрен к покупке'
};
const plan=[
  {id:'auction_deposit',title:'Аукционный аванс',amount:10000},
  {id:'auction_balance',title:'Автомобиль и аукционные сборы',amount:16000},
  {id:'logistics_legalization',title:'Логистика',amount:6500},
  {id:'customs_fts',title:'Таможня',amount:6500}
];
const payment=i=>({
  id:'PAY-'+suffix+'-'+i,
  amount:plan[i].amount,
  date:today,
  method:'Банк',
  paymentStage:plan[i].id,
  note:'ТЕСТ, деньги не переводились'
});
const report={leadId,quoteId,orderId,telegram:{client:'@'+auditClientUsername,manager:'@Flyer_Flyer'},writePath:'entity-batch',authMode:'QA signatures for verified existing physical Telegram identities',logicalRoles:['client','manager'],initialManagerFanout:3,subsequentPhysicalRecipients:2,receipts,security:{},ui:{},conversation:[],cleanup:null};
let scenarioStarted=false;
let cleanupFailure=null;

try{
  const lead={
    id:leadId,
    name:'ТЕСТ @'+auditClientUsername,
    contact:'@'+auditClientUsername,
    model,
    origin:'США',
    budget:45000,
    source:'Mini App',
    manager:'',
    status:'Новый',
    nextAction:today,
    priority:'Средний',
    createdAt:new Date().toISOString(),
    clientCreated:true,
    telegramUserId:clientTelegramUserId,
    telegramUsername:auditClientUsername,
    deposit:0,
    note:'Полный тест уведомлений. Не реальная покупка.'
  };

  if(process.env.AUDIT_UI_ONLY==='1'){
    report.mode='UI recheck of the final state verified in run 38043465852; no Telegram notifications';
    const uiLead={...lead,status:'Сделка',manager:auditManagerName,managerTelegramUserId,managerTelegramUsername:'Flyer_Flyer',managerClaimedByTelegramUserId:managerTelegramUserId,deposit:10000,depositDate:today,paymentMethod:'Банк',note:'ТЕСТ интерфейса; без Telegram-уведомлений и реальных денег.'};
    const uiQuote={id:quoteId,leadId,model,origin:'США',transportMode:'Море',lot:25000,auction:1000,inland:1000,ocean:2500,customs:6500,repair:1500,service:1500,total:39000,status:'Согласован',version:1,validUntil:future,verification,clientDecision:'agreed',clientDecisionAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const uiOrder={id:orderId,leadId,customer:lead.name,model,origin:'США',transportMode:'Море',manager:auditManagerName,source:'Mini App',total:39000,cost:37500,paid:39000,stage:'Выдача',lot:verification.lotNumber,vin:verification.vin,eta:future,location:'ТЕСТ · Выдача',riskType:'Нет',riskNote:'',risk:'Нет',paymentPlan:plan,payments:plan.map((_,i)=>payment(i)),updatedAt:new Date().toISOString()};
    scenarioStarted=true;
    const fixture=await req('/api/auto-sale/entities/batch',{actor:'admin',method:'POST',headers:{'x-auto-sale-skip-telegram':'1'},body:{operations:[
      {resource:'lead',operation:'create',id:leadId,input:uiLead},
      {resource:'quote',operation:'create',id:quoteId,input:uiQuote},
      {resource:'order',operation:'create',id:orderId,input:uiOrder}
    ]}});
    assert.ok(fixture.response.ok,'UI fixture create HTTP '+fixture.response.status+': '+JSON.stringify(fixture.data));
    assert.equal(Number(fixture.data.notifications?.queued||0),0);
    console.log('TELEGRAM_UI_FIXTURE_READY',JSON.stringify({leadId,quoteId,orderId,notifications:0}));
    report.ui=await verifyLiveUI();
    report.ok=true;
    console.log('TELEGRAM_UI_RECHECK_OK',JSON.stringify({priorLifecycleRun:38043465852,ui:report.ui,notifications:0}));
  }else{

  const clientBefore=await req('/api/auto-sale/state',{actor:'client'});
  const managerBefore=await req('/api/auto-sale/state',{actor:'manager'});
  assert.equal(clientBefore.data?._access?.role,'client');
  assert.equal(clientBefore.data?._access?.authenticated,true);
  assert.equal(managerBefore.data?._access?.role,'admin');
  assert.equal(managerBefore.data?._access?.authType,'telegram');
  assert.equal((clientBefore.data.team||[]).length,0);
  report.security.realClientRole=true;
  report.security.registeredManagerRole=true;
  report.security.clientStaffIsolation=true;
  scenarioStarted=true;
  await batch('Новый',4,[{resource:'lead',operation:'create',id:leadId,input:lead}],'client');
  const afterCreate=await state();
  const persistedNew=(afterCreate.leads||[]).find(x=>x.id===leadId);
  assert.equal(persistedNew.manager,'','new client request must be unassigned');
  assert.equal(persistedNew.telegramUserId,clientTelegramUserId);
  assert.equal(persistedNew.source,'Mini App');
  report.security.serverOwnedClientIdentity=true;
  const own=await req('/api/auto-sale/state',{actor:'client'});
  assert.ok((own.data.leads||[]).some(x=>x.id===leadId));
  const foreign=signInitData({id:'999999999999993',username:'autoworld_isolation_probe',first_name:'QA isolation'});
  const outsider=await req('/api/auto-sale/state',{actor:'client',headers:{'x-telegram-init-data':foreign}});
  assert.equal(outsider.data?._access?.role,'client');
  assert.ok(!(outsider.data.leads||[]).some(x=>x.id===leadId));
  const directForbidden=await req('/api/auto-sale/leads/'+encodeURIComponent(leadId),{actor:'client',headers:{'x-telegram-init-data':foreign}});
  assert.equal(directForbidden.response.status,403);
  report.security.foreignClientIsolation=true;
  const publicResponse=await fetch(base+'/api/auto-sale/state',{signal:AbortSignal.timeout(30000)});
  const publicState=await publicResponse.json();
  for(const key of ['leads','quotes','orders','team'])assert.equal((publicState[key]||[]).length,0);
  report.security.guestIsolation=true;

  for(const status of ['В работе','Расчёт']){
    await batch(status,2,[{resource:'lead',operation:'patch',id:leadId,input:{status}}]);
    const current=await state();
    const owned=current.leads.find(x=>x.id===leadId);
    assert.equal(owned.manager,auditManagerName);
    assert.equal(owned.managerTelegramUserId,managerTelegramUserId);
    assert.equal(owned.managerClaimedByTelegramUserId,managerTelegramUserId);
  }
  report.security.statusClaimedByDmitry=true;
  const deniedEdit=await req('/api/auto-sale/entities/batch',{
    actor:'client',method:'POST',body:{operations:[{
      resource:'lead',operation:'patch',id:leadId,
      baseRowVersion:knownVersion('lead',leadId),input:{budget:1}
    }]}
  });
  assert.equal(deniedEdit.response.status,409);
  assert.equal(deniedEdit.data.error,'client_lead_locked');
  report.security.clientCannotEditAfterManagerStarts=true;
  const deniedStaffAction=await req('/api/auto-sale/entities/batch',{
    actor:'client',method:'POST',body:{operations:[{
      resource:'order',operation:'create',id:orderId,input:{id:orderId,leadId}
    }]}
  });
  assert.equal(deniedStaffAction.response.status,403);
  report.security.clientCannotCreateOrder=true;
  const staleVersion=knownVersion('lead',leadId)-1;
  const staleWrite=await req('/api/auto-sale/entities/batch',{
    actor:'manager',method:'POST',body:{operations:[{
      resource:'lead',operation:'patch',id:leadId,
      baseRowVersion:staleVersion,input:{status:'В работе'}
    }]}
  });
  assert.equal(staleWrite.response.status,409);
  report.security.staleUpdateRejected=true;

  for(const [actor,target,text] of [
    ['manager','client','ТЕСТ полного цикла: сообщение Дмитрия клиенту.'],
    ['client','manager','ТЕСТ полного цикла: ответ клиента Дмитрию.']
  ]){
    const sent=await req('/api/auto-sale/telegram/message',{actor,method:'POST',body:{leadId,target,text}});
    assert.equal(sent.response.status,201);
    assert.ok(sent.data.messageId);
    report.conversation.push({direction:actor+' -> '+target,delivered:true,messageId:sent.data.messageId});
  }
  console.log('TELEGRAM_ROLE_AND_ISOLATION_CHECKS_OK',JSON.stringify({security:report.security,conversation:report.conversation}));

  const quote={
    id:quoteId,leadId,model,origin:'США',transportMode:'Море',
    lot:25000,auction:1000,inland:1000,ocean:2500,customs:6500,repair:1500,service:1500,total:39000,
    status:'Черновик',version:1,validUntil:future,verification,updatedAt:new Date().toISOString()
  };
  await batch('Черновик расчёта',2,[{resource:'quote',operation:'create',id:quoteId,input:quote}]);

  await batch('Расчёт отправлен',4,[
    {resource:'lead',operation:'patch',id:leadId,input:{status:'Ожидает клиента'}},
    {resource:'quote',operation:'patch',id:quoteId,input:{status:'Отправлен',sentAt:new Date().toISOString()}}
  ]);
  await batch('На согласовании',2,[{resource:'quote',operation:'patch',id:quoteId,input:{status:'На согласовании'}}]);
  await batch('Запрос изменений',2,[{resource:'quote',operation:'patch',id:quoteId,input:{
    clientDecision:'changes_requested',
    clientComment:'ТЕСТ: подтвердите сроки доставки',
    clientDecisionAt:new Date().toISOString()
  }}],'client');
  await batch('Расчёт согласован',2,[{resource:'quote',operation:'patch',id:quoteId,input:{
    status:'Согласован',
    clientDecision:'agreed',
    clientDecisionAt:new Date().toISOString(),
    agreedAt:new Date().toISOString()
  }}],'client');
  const approved=await req('/api/auto-sale/state',{actor:'client'});
  assert.equal(approved.data.quotes.find(x=>x.id===quoteId)?.clientDecision,'agreed');
  report.security.clientQuoteDecisionPersisted=true;
  await batch('Сделка',2,[{resource:'lead',operation:'patch',id:leadId,input:{
    status:'Сделка',
    deposit:10000,
    depositDate:today,
    paymentMethod:'Банк'
  }}]);

  const order={
    id:orderId,leadId,customer:'ТЕСТ @'+auditClientUsername,model,origin:'США',transportMode:'Море',
    manager:manager.name,source:'Mini App',total:39000,cost:37500,paid:10000,
    stage:'Выкуп',lot:verification.lotNumber,vin:verification.vin,eta:future,location:'ТЕСТ',
    riskType:'Нет',riskNote:'',risk:'Нет',paymentPlan:plan,payments:[payment(0)],updatedAt:new Date().toISOString()
  };
  await batch('Заказ и депозит',4,[{resource:'order',operation:'create',id:orderId,input:order}]);
  await batch('Оплата автомобиля',2,[{resource:'payment',operation:'create',orderId,input:payment(1)}]);

  for(const stage of ['Подготовка к отправке','В пути','Таможня','Доставка']){
    await batch(stage,2,[{resource:'order',operation:'patch',id:orderId,input:{stage,location:'ТЕСТ · '+stage,updatedAt:new Date().toISOString()}}]);
  }

  await batch('Оплата логистики',2,[{resource:'payment',operation:'create',orderId,input:payment(2)}]);
  await batch('Полная оплата',2,[{resource:'payment',operation:'create',orderId,input:payment(3)}]);
  await batch('Выдача',2,[{resource:'order',operation:'patch',id:orderId,input:{stage:'Выдача',location:'ТЕСТ · Выдача',updatedAt:new Date().toISOString()}}]);

  const final=await state(),orderFinal=final.orders.find(x=>x.id===orderId);
  assert.equal(orderFinal.stage,'Выдача');
  assert.equal(orderFinal.paid,39000);
  assert.ok(initial.leads.every(old=>final.leads.some(x=>x.id===old.id)),'Existing applications preserved');
  assert.equal(new Set(receipts.map(x=>x.id)).size,receipts.length);
  assert.equal(new Set(receipts.map(x=>x.messageId)).size,receipts.length);
  const clientFinal=await req('/api/auto-sale/state',{actor:'client'});
  const clientOrder=clientFinal.data.orders.find(x=>x.id===orderId);
  assert.equal(clientOrder?.stage,'Выдача');
  assert.equal(clientOrder?.paid,39000);
  assert.equal((clientFinal.data.team||[]).length,0);
  report.security.clientSeesFinalOrder=true;
  report.finalOrder={stage:orderFinal.stage,total:orderFinal.total,paid:orderFinal.paid,manager:orderFinal.manager};
  report.ui=await verifyLiveUI();
  report.ok=true;
  report.count=receipts.length;
  report.perRole={client:receipts.filter(x=>x.target==='client').length,manager:receipts.filter(x=>x.target==='manager').length};
  report.finalRevision=Number(final.revision)||0;
  console.log('AUTOWORLD_FULL_LIFECYCLE_OK',JSON.stringify({...report,receipts:undefined}));
  }
}finally{
  if(scenarioStarted){
    try{
      let cleaned=await req('/api/auto-sale/admin/cleanup-test-scenario',{
        method:'POST',
        body:{leadId,quoteId,orderId}
      });
      if(cleaned.response.status===504){
        await sleep(1800);
        const check=await state();
        const remains=(check.leads||[]).some(x=>x.id===leadId)||(check.quotes||[]).some(x=>x.id===quoteId)||(check.orders||[]).some(x=>x.id===orderId);
        if(!remains)cleaned={response:{ok:true,status:200},data:{ok:true,timeoutRecovered:true}};
        else cleaned=await req('/api/auto-sale/admin/cleanup-test-scenario',{method:'POST',body:{leadId,quoteId,orderId}});
      }
      report.cleanup={status:cleaned.response.status,data:cleaned.data};
      assert.ok(cleaned.response.ok,'Telegram lifecycle cleanup failed: '+JSON.stringify(cleaned.data));
      const after=await state();
      assert.ok(!(after.leads||[]).some(x=>x.id===leadId),'Test lead cleanup failed');
      assert.ok(!(after.quotes||[]).some(x=>x.id===quoteId),'Test quote cleanup failed');
      assert.ok(!(after.orders||[]).some(x=>x.id===orderId),'Test order cleanup failed');
      console.log('TELEGRAM_FULL_CYCLE_CLEANUP_VERIFIED',JSON.stringify({leadId,quoteId,orderId,revision:after.revision}));
    }catch(error){
      report.cleanup={...(report.cleanup||{}),error:String(error?.stack||error)};
      cleanupFailure=error;
    }
  }
  const safeReport={...report,receipts:report.receipts.map((item,index)=>({...item,id:String(item.id).replace(/:[0-9]+$/,'')+':recipient-'+index}))};
  await writeFile('telegram-lifecycle-report.json',JSON.stringify(safeReport,null,2));
  if(report.ok&&cleanupFailure)throw cleanupFailure;
}

async function verifyLiveUI(){
  const results={client:false,manager:false,mode:'real Chromium with QA Telegram identity headers',screenshots:[]};
  const browser=await chromium.launch({
    headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/usr/bin/google-chrome',
    args:['--no-sandbox','--disable-dev-shm-usage']
  });
  try{
    for(const actor of ['client','manager']){
      const context=await browser.newContext({viewport:{width:actor==='client'?390:1280,height:900},locale:'ru-RU'});
      const page=await context.newPage();
      const pageErrors=[];
      page.on('pageerror',error=>pageErrors.push(String(error.message||error)));
      await page.route('**/api/auto-sale/**',async route=>{
        if(new URL(route.request().url()).origin!==new URL(base).origin)return route.continue();
        await route.continue({headers:{...route.request().headers(),...authHeaders(actor)}});
      });
      const navigated=await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:60000});
      assert.equal(navigated?.status(),200);
      await page.locator('#auto-client-quote-style').waitFor({state:'attached',timeout:60000});
      console.log('TELEGRAM_UI_MODULES_READY',JSON.stringify({actor}));
      if(actor==='client'){
        await page.locator('[data-go="orders"]').first().click({timeout:30000});
        await page.getByText(model,{exact:false}).first().waitFor({timeout:30000});
        const detail=page.locator('.auto-order-card[data-client-lead="'+leadId+'"]');
        await detail.waitFor({timeout:30000});
        await detail.locator('h3').click();
        const modal=page.locator('[data-client-detail-bg]');
        await modal.waitFor({timeout:30000});
        assert.ok(await modal.getByText('Выдача',{exact:false}).count());
        assert.ok(await modal.getByText('Дмитрий',{exact:false}).count());
        assert.ok(await modal.locator('[data-tg-manager]').isEnabled());
        results.client=true;
      }else{
        await page.locator('[data-role="manager"]').click({timeout:30000});
        await page.locator('[data-go="leads"]').click();
        const card=page.locator('button[data-lead]').filter({hasText:'ТЕСТ @'+auditClientUsername}).filter({hasText:model}).first();
        await card.waitFor({timeout:30000});
        await card.click();
        await page.locator('#leadEditForm').waitFor();
        assert.equal(await page.locator('#leadEditForm [name="status"]').inputValue(),'Сделка');
        results.manager=true;
      }
      console.log('TELEGRAM_UI_ACTOR_OK',JSON.stringify({actor,pageErrors:pageErrors.map(x=>x.slice(0,350))}));
      assert.equal(pageErrors.length,0,actor+' JS runtime errors: '+JSON.stringify(pageErrors));
      const file='telegram-full-cycle-'+actor+'.png';
      await page.screenshot({path:file,fullPage:true});
      results.screenshots.push(file);
      await context.close();
    }
  }catch(error){
    const contexts=browser.contexts();
    for(const [i,context] of contexts.entries())for(const page of context.pages()){
      try{await page.screenshot({path:'telegram-full-cycle-debug-'+i+'.png',fullPage:true});console.log('TELEGRAM_UI_DEBUG',JSON.stringify(await page.evaluate(()=>({loadedTelegramModule:!!document.getElementById('autoSaleTelegramStyles'),loadedQuoteModule:!!document.getElementById('auto-client-quote-style'),server:window.__AUTO_SALE_SERVER__,hasDetail:!!document.querySelector('[data-client-detail-bg]'),moduleScripts:[...document.querySelectorAll('script[type=module]')].map(x=>new URL(x.src,location.href).pathname)}))));}catch{}
    }
    throw error;
  }finally{await browser.close()}
  console.log('TELEGRAM_LIVE_UI_OK',JSON.stringify(results));
  return results;
}
