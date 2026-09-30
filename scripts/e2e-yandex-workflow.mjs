const base=String(process.env.STAGING_URL||'').replace(/\/+$/,'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
if(!base)throw new Error('STAGING_URL is required');
if(!apiKey)throw new Error('AUTO_SALE_API_KEY is required');

const headers={'content-type':'application/json','x-auto-sale-key':apiKey,'x-auto-sale-skip-telegram':'1'};
const notifyHeaders={'content-type':'application/json','x-auto-sale-key':apiKey};
const clone=value=>JSON.parse(JSON.stringify(value));
const today=new Date().toISOString().slice(0,10);
const addDays=(days)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};

async function request(path,options={}){
  let last={response:null,data:{}};
  for(let attempt=0;attempt<4;attempt++){
    try{
      const response=await fetch(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(45_000)});
      const data=await response.json().catch(()=>({}));
      last={response,data};
      if(response.status!==502&&response.status!==503&&response.status!==504)return last;
    }catch(error){
      last={response:null,data:{error:String(error?.message||error)}};
    }
    if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
  }
  if(!last.response)throw new Error(`request failed after retries: ${path} ${JSON.stringify(last.data)}`);
  return last;
}
async function getState(){
  const {response,data}=await request('/api/auto-sale/state',{method:'GET'});
  if(!response.ok)throw new Error(`GET state failed after retries: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function putState(state){
  const payload={...state,baseRevision:Number(state.revision)||0};
  delete payload.revision;
  const {response,data}=await request('/api/auto-sale/state',{method:'PUT',body:JSON.stringify(payload)});
  if(!response.ok)throw new Error(`PUT state failed: ${response.status} ${JSON.stringify(data)}`);
  const next=await getState();
  if(Number(next.revision)<Number(data.revision))throw new Error('revision_regressed_after_write');
  return next;
}
async function mutate(mutator){
  for(let attempt=0;attempt<8;attempt++){
    const state=await getState();
    mutator(state);
    const payload={...state,baseRevision:Number(state.revision)||0};delete payload.revision;
    const {response,data}=await request('/api/auto-sale/state',{method:'PUT',body:JSON.stringify(payload)});
    if(response.ok)return getState();
    if(response.status!==409)throw new Error(`PUT state failed: ${response.status} ${JSON.stringify(data)}`);
    await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
  }
  throw new Error('PUT state failed after revision-conflict retries');
}

const publicStateResponse=await fetch(base+'/api/auto-sale/state',{headers:{accept:'application/json'},cache:'no-store'});
const publicState=await publicStateResponse.json().catch(()=>({}));
if(!publicStateResponse.ok||publicState.initialized!==true)throw new Error(`public_demo_state_expected_200_got_${publicStateResponse.status}`);

const original=clone(await getState());
const suffix=Date.now().toString(36).toUpperCase();
const leadId=`L-YDB-${suffix}`;
const quoteId=`Q-YDB-${suffix}`;
const orderId=`O-YDB-${suffix}`;
const payment1=`PAY-YDB-${suffix}-1`;
const payment2=`PAY-YDB-${suffix}-2`;
const total=39000;

try{
  // Verify the real state-change path used by a newly created application.
  {
    const notificationLeadId=`L-NOTIFY-${suffix}`;
    let delivered=null;
    for(let attempt=0;attempt<8;attempt++){
      const state=await getState();
      if(!state.leads.some(x=>x.id===notificationLeadId)){
        state.leads.push({
          id:notificationLeadId,name:'Notification E2E Client',contact:`notify-${suffix}@example.invalid`,model:'Telegram notification E2E',
          budget:35000,source:'Mini App',manager:'',status:'Новый',priority:'Средний',
          createdAt:new Date().toISOString(),nextAction:today,note:'Real lead-created notification E2E',clientCreated:true
        });
        state.notes[notificationLeadId]=[{at:new Date().toISOString(),text:'Notification E2E: заявка создана.'}];
      }
      const payload={...state,baseRevision:Number(state.revision)||0};delete payload.revision;
      const response=await fetch(base+'/api/auto-sale/state',{method:'PUT',headers:notifyHeaders,body:JSON.stringify(payload)});
      const data=await response.json().catch(()=>({}));
      if(response.ok){delivered=data;break;}
      if(response.status!==409)throw new Error(`notification lead PUT failed: ${response.status} ${JSON.stringify(data)}`);
      await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
    }
    if(!delivered)throw new Error('notification lead PUT failed after revision-conflict retries');
    console.log('AUTO_SALE_REAL_LEAD_NOTIFICATION_TRIGGERED',JSON.stringify({leadId:notificationLeadId,revision:delivered.revision}));
  }

  await mutate(state=>{
    state.leads.push({
      id:leadId,name:'Yandex E2E Client',contact:`e2e-${suffix}@example.invalid`,model:'BMW X5 xDrive40i 2022',
      budget:45000,source:'Mini App',manager:'Дмитрий',status:'Новый',priority:'Средний',
      createdAt:new Date().toISOString(),nextAction:today,note:'Yandex staging E2E',clientCreated:true,
      yearFrom:'2021',yearTo:'2023',mileageMax:'50000',engine:'Бензин',drive:'AWD',damage:'Минимальные',
      deliveryCity:'Москва',deposit:0,depositDate:'',paymentMethod:''
    });
    state.notes[leadId]=[{at:new Date().toISOString(),text:'Yandex E2E: лид создан.'}];
  });

  await mutate(state=>{
    const lead=state.leads.find(x=>x.id===leadId);lead.status='В работе';
    state.notes[leadId].push({at:new Date().toISOString(),text:'Yandex E2E: лид взят в работу.'});
  });

  await mutate(state=>{
    const lead=state.leads.find(x=>x.id===leadId);lead.status='Расчёт';
    state.quotes.push({
      id:quoteId,leadId,model:'BMW X5 xDrive40i 2022',origin:'США',transportMode:'Море',lot:25000,auction:1000,inland:1000,ocean:2500,
      customs:6500,repair:1500,service:1500,total,status:'Черновик',version:1,validUntil:addDays(7),
      verification:{
        lotNumber:'E2E-LOT-001',vin:'E2E-VIN-00000000001',year:2022,mileage:32000,
        damage:'Косметические повреждения',photos:['https://example.com/e2e-before.jpg'],
        reportUrl:'https://example.com/e2e-report',history:'Yandex E2E vehicle history checked.',
        result:'Одобрен к покупке',checkedAt:today
      },
      updatedAt:new Date().toISOString()
    });
  });

  await mutate(state=>{
    const lead=state.leads.find(x=>x.id===leadId);lead.status='Ожидает клиента';
    const quote=state.quotes.find(x=>x.id===quoteId);quote.status='Отправлен';quote.sentAt=new Date().toISOString();quote.updatedAt=quote.sentAt;
  });

  await mutate(state=>{
    const quote=state.quotes.find(x=>x.id===quoteId);quote.status='Согласован';quote.agreedAt=new Date().toISOString();quote.updatedAt=quote.agreedAt;
  });

  await mutate(state=>{
    const lead=state.leads.find(x=>x.id===leadId);
    lead.status='Сделка';lead.origin='США';lead.deposit=10000;lead.depositDate=today;lead.paymentMethod='Банк';
  });

  await mutate(state=>{
    state.orders.push({
      id:orderId,leadId,customer:'Yandex E2E Client',model:'BMW X5 xDrive40i 2022',origin:'США',transportMode:'Море',manager:'Дмитрий',source:'Mini App',
      total,cost:37500,paid:10000,stage:'Выкуп',eta:addDays(45),lot:'',vin:'',location:'',risk:'Нет',riskType:'Нет',riskNote:'',
      paymentPlan:[
        {id:'auction_deposit',title:'1. Аукционный аванс',due:'До начала торгов',amount:10000},
        {id:'auction_balance',title:'2. Автомобиль + аукционные сборы',due:'После победы на торгах',amount:16000},
        {id:'logistics_legalization',title:'3. Логистика и легализация',due:'За несколько дней до прибытия в порт назначения',amount:6500},
        {id:'customs_fts',title:'4. Таможенные платежи ФТС',due:'За 1–2 дня до пересечения границы РФ',amount:6500}
      ],
      paymentPlanNeedsReview:false,updatedAt:new Date().toISOString(),
      payments:[{id:payment1,amount:10000,date:today,method:'Банк',paymentStage:'auction_deposit',note:'Аукционный аванс',createdAt:new Date().toISOString()}]
    });
  });

  for(const stage of ['Порт США','В море','Таможня','Доставка']){
    await mutate(state=>{
      const order=state.orders.find(x=>x.id===orderId);
      order.stage=stage;order.lot='E2E-LOT-001';order.vin='E2E-VIN-00000000001';order.eta=addDays(30);order.location=stage;order.updatedAt=new Date().toISOString();
    });
  }

  await mutate(state=>{
    const order=state.orders.find(x=>x.id===orderId);
    order.payments.push(
      {id:payment2+'-A',amount:16000,date:today,method:'Банк',paymentStage:'auction_balance',note:'После победы на торгах',createdAt:new Date().toISOString()},
      {id:payment2+'-B',amount:6500,date:today,method:'Банк',paymentStage:'logistics_legalization',note:'Логистика и легализация',createdAt:new Date().toISOString()},
      {id:payment2+'-C',amount:6500,date:today,method:'Банк',paymentStage:'customs_fts',note:'Платежи ФТС',createdAt:new Date().toISOString()}
    );
    order.paid=total;order.stage='Выдача';order.location='Пункт выдачи';order.updatedAt=new Date().toISOString();
  });

  const finalState=await getState();
  const lead=finalState.leads.find(x=>x.id===leadId);
  const quote=finalState.quotes.find(x=>x.id===quoteId);
  const order=finalState.orders.find(x=>x.id===orderId);
  if(lead?.status!=='Сделка')throw new Error('e2e_lead_not_deal');
  if(quote?.status!=='Согласован')throw new Error('e2e_quote_not_agreed');
  if(order?.stage!=='Выдача'||Number(order?.paid)!==total)throw new Error('e2e_order_not_handed_off');
  console.log('AUTO_SALE_YANDEX_E2E_OK',JSON.stringify({leadId,quoteId,orderId,revision:finalState.revision,stage:order.stage,paid:order.paid}));
}finally{
  const latest=await getState();
  const restore={...clone(original),baseRevision:Number(latest.revision)||0};
  delete restore.revision;
  let {response,data}=await request('/api/auto-sale/state',{method:'PUT',body:JSON.stringify(restore)});
  if(!response.ok){
    const fresh=await getState();
    const retry={...clone(original),baseRevision:Number(fresh.revision)||0};
    delete retry.revision;
    ({response,data}=await request('/api/auto-sale/state',{method:'PUT',body:JSON.stringify(retry)}));
  }
  if(!response.ok)throw new Error(`restore_failed: ${response.status} ${JSON.stringify(data)}`);
  const restored=await getState();
  const counts={
    leads:restored.leads?.length||0,quotes:restored.quotes?.length||0,orders:restored.orders?.length||0,
    notes:Object.values(restored.notes||{}).reduce((n,list)=>n+(Array.isArray(list)?list.length:0),0),
    team:restored.team?.length||0
  };
  const originalCounts={
    leads:original.leads?.length||0,quotes:original.quotes?.length||0,orders:original.orders?.length||0,
    notes:Object.values(original.notes||{}).reduce((n,list)=>n+(Array.isArray(list)?list.length:0),0),
    team:original.team?.length||0
  };
  if(JSON.stringify(counts)!==JSON.stringify(originalCounts))throw new Error(`restore_count_mismatch ${JSON.stringify({counts,originalCounts})}`);
  console.log('AUTO_SALE_YANDEX_E2E_RESTORED',JSON.stringify({revision:restored.revision,counts}));
}
