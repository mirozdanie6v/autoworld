import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const base=String(process.env.STAGING_URL||'').replace(/\/$/,'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
if(!base)throw new Error('STAGING_URL required');
if(!apiKey)throw new Error('AUTO_SALE_API_KEY required');
const headers={'content-type':'application/json','x-auto-sale-key':apiKey};
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
  const body=options.body&&typeof options.body!=='string'?JSON.stringify(options.body):options.body;
  const response=await fetch(base+path,{
    ...options,
    body,
    headers:{...headers,...options.headers},
    signal:AbortSignal.timeout(70000)
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
  assert.equal(rows.filter(x=>x.target==='client').length,expected/2,label+' client');
  assert.equal(rows.filter(x=>x.target==='manager').length,expected/2,label+' manager');
  receipts.push(...rows.map(x=>({...x,step:label})));
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

async function batch(label,expected,operations){
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
        method:'POST',
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
const manager=(initial.team||[]).find(x=>x.active!==false&&String(x.telegramUsername||x.telegram||'').replace(/^@/,'').toLowerCase()==='flyer_flyer'&&/^\d+$/.test(String(x.telegramUserId||'')));
assert.ok(manager,'Flyer_Flyer manager Telegram must be linked');
const telegramUserId=String(manager.telegramUserId),suffix=Date.now().toString(36).toUpperCase();
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
const report={leadId,quoteId,orderId,telegram:'@Flyer_Flyer',writePath:'entity-batch',receipts,cleanup:null};
let scenarioStarted=false;
let cleanupFailure=null;

try{
  const lead={
    id:leadId,
    name:'ТЕСТ @Flyer_Flyer',
    contact:'@Flyer_Flyer',
    model,
    origin:'США',
    budget:45000,
    source:'Mini App',
    manager:manager.name,
    status:'Новый',
    nextAction:today,
    priority:'Средний',
    createdAt:new Date().toISOString(),
    clientCreated:true,
    isTest:true,
    telegramUserId,
    telegramUsername:'Flyer_Flyer',
    managerTelegramUserId:telegramUserId,
    managerTelegramUsername:'Flyer_Flyer',
    managerTelegramName:manager.name,
    deposit:0,
    note:'Полный тест уведомлений. Не реальная покупка.'
  };
  await batch('Новый',2,[{resource:'lead',operation:'create',id:leadId,input:lead}]);
  scenarioStarted=true;

  for(const status of ['В работе','Расчёт']){
    await batch(status,2,[{resource:'lead',operation:'patch',id:leadId,input:{status}}]);
  }

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
  }}]);
  await batch('Расчёт согласован',2,[{resource:'quote',operation:'patch',id:quoteId,input:{
    status:'Согласован',
    clientDecision:'agreed',
    clientDecisionAt:new Date().toISOString(),
    agreedAt:new Date().toISOString()
  }}]);
  await batch('Сделка',2,[{resource:'lead',operation:'patch',id:leadId,input:{
    status:'Сделка',
    deposit:10000,
    depositDate:today,
    paymentMethod:'Банк'
  }}]);

  const order={
    id:orderId,leadId,customer:'ТЕСТ @Flyer_Flyer',model,origin:'США',transportMode:'Море',
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
  report.ok=true;
  report.count=receipts.length;
  report.perRole={client:receipts.filter(x=>x.target==='client').length,manager:receipts.filter(x=>x.target==='manager').length};
  report.finalRevision=Number(final.revision)||0;
  console.log('AUTOWORLD_FULL_LIFECYCLE_OK',JSON.stringify({...report,receipts:undefined}));
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
    }catch(error){
      report.cleanup={...(report.cleanup||{}),error:String(error?.stack||error)};
      cleanupFailure=error;
    }
  }
  await writeFile('telegram-lifecycle-report.json',JSON.stringify(report,null,2));
  if(report.ok&&cleanupFailure)throw cleanupFailure;
}
