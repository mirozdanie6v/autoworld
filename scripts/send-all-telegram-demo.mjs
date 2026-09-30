const base=String(process.env.STAGING_URL||'').replace(/\/$/,'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
if(!base||!apiKey)throw new Error('STAGING_URL and AUTO_SALE_API_KEY required');
const headers={'content-type':'application/json','x-auto-sale-key':apiKey};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(path,opt={}){const r=await fetch(base+path,{...opt,headers:{...headers,...opt.headers},signal:AbortSignal.timeout(45000)});const d=await r.json().catch(()=>({}));return{r,d}}
async function state(){const {r,d}=await req('/api/auto-sale/state');if(!r.ok)throw new Error('state '+r.status);return d}
async function mutate(fn){for(let i=0;i<10;i++){const s=await state();fn(s);const p={...s,baseRevision:Number(s.revision)||0};delete p.revision;const {r,d}=await req('/api/auto-sale/state',{method:'PUT',body:JSON.stringify(p)});if(r.ok){await sleep(450);return d}if(r.status!==409)throw new Error('put '+r.status+' '+JSON.stringify(d));await sleep(200*(i+1))}throw new Error('revision retries exhausted')}
const s0=await state();
const manager=(s0.team||[]).find(x=>String(x.telegramUsername||x.telegram||'').replace(/^@/,'').toLowerCase()==='flyer_flyer'&&/^\d+$/.test(String(x.telegramUserId||'')));
if(!manager)throw new Error('Flyer_Flyer manager Telegram is not linked');
const tg=String(manager.telegramUserId), suffix=Date.now().toString(36).toUpperCase();
const leadId='L-LIVE-'+suffix, quoteId='Q-LIVE-'+suffix, orderId='O-LIVE-'+suffix;
const today=new Date().toISOString().slice(0,10), add=d=>{const x=new Date();x.setUTCDate(x.getUTCDate()+d);return x.toISOString().slice(0,10)};
await mutate(s=>{s.leads.push({id:leadId,name:'Тестовый клиент @Flyer_Flyer',contact:'@Flyer_Flyer',model:'BMW X5 xDrive40i 2022',budget:45000,source:'Mini App',manager:manager.name,status:'Новый',priority:'Средний',createdAt:new Date().toISOString(),nextAction:today,note:'Полный живой тест всех Telegram уведомлений',clientCreated:true,telegramUserId:tg,telegramUsername:'Flyer_Flyer',telegramDisplayName:'@Flyer_Flyer',managerTelegramUserId:tg,yearFrom:'2021',yearTo:'2023',mileageMax:'50000',engine:'Бензин',drive:'AWD',damage:'Минимальные',deliveryCity:'Москва',deposit:0});s.notes[leadId]=[{at:new Date().toISOString(),text:'Создана заявка для полного Telegram-теста.'}]});
for(const status of ['В работе','Расчёт'])await mutate(s=>{s.leads.find(x=>x.id===leadId).status=status});
await mutate(s=>{s.quotes.push({id:quoteId,leadId,model:'BMW X5 xDrive40i 2022',origin:'США',transportMode:'Море',lot:25000,auction:1000,inland:1000,ocean:2500,customs:6500,repair:1500,service:1500,total:39000,status:'Черновик',version:1,validUntil:add(7),updatedAt:new Date().toISOString()})});
await mutate(s=>{s.leads.find(x=>x.id===leadId).status='Ожидает клиента';const q=s.quotes.find(x=>x.id===quoteId);q.status='Отправлен';q.sentAt=new Date().toISOString()});
await mutate(s=>{const q=s.quotes.find(x=>x.id===quoteId);q.status='Согласован';q.agreedAt=new Date().toISOString()});
await mutate(s=>{const l=s.leads.find(x=>x.id===leadId);l.status='Сделка';l.origin='США';l.deposit=10000;l.depositDate=today;l.paymentMethod='Банк'});
await mutate(s=>{s.orders.push({id:orderId,leadId,customer:'Тестовый клиент @Flyer_Flyer',model:'BMW X5 xDrive40i 2022',origin:'США',transportMode:'Море',manager:manager.name,source:'Mini App',total:39000,cost:37500,paid:10000,stage:'Выкуп',eta:add(45),location:'',paymentPlan:[{id:'auction_deposit',title:'1. Аукционный аванс',amount:10000},{id:'auction_balance',title:'2. Автомобиль + аукционные сборы',amount:16000},{id:'logistics_legalization',title:'3. Логистика и легализация',amount:6500},{id:'customs_fts',title:'4. Таможенные платежи ФТС',amount:6500}],payments:[{id:'PAY-'+suffix+'-1',amount:10000,date:today,method:'Банк',paymentStage:'auction_deposit',createdAt:new Date().toISOString()}],updatedAt:new Date().toISOString()})});
for(const stage of ['Порт США','В море','Таможня','Доставка'])await mutate(s=>{const o=s.orders.find(x=>x.id===orderId);o.stage=stage;o.location=stage;o.updatedAt=new Date().toISOString()});
await mutate(s=>{const o=s.orders.find(x=>x.id===orderId);o.payments.push({id:'PAY-'+suffix+'-2',amount:16000,date:today,method:'Банк',paymentStage:'auction_balance',createdAt:new Date().toISOString()});o.paid=26000});
await mutate(s=>{const o=s.orders.find(x=>x.id===orderId);o.payments.push({id:'PAY-'+suffix+'-3',amount:6500,date:today,method:'Банк',paymentStage:'logistics_legalization',createdAt:new Date().toISOString()});o.paid=32500});
await mutate(s=>{const o=s.orders.find(x=>x.id===orderId);o.payments.push({id:'PAY-'+suffix+'-4',amount:6500,date:today,method:'Банк',paymentStage:'customs_fts',createdAt:new Date().toISOString()});o.paid=39000;o.stage='Выдача';o.location='Пункт выдачи'});
for(const [target,text,senderId] of [['client','Тест ручного сообщения: менеджер → клиент.',tg],['manager','Тест ручного сообщения: клиент → менеджер.',tg]]){const {r,d}=await req('/api/auto-sale/telegram/manual',{method:'POST',body:JSON.stringify({leadId,target,text,senderId})});if(!r.ok)console.log('manual route skipped',r.status,d)}
console.log('AUTOWORLD_ALL_MESSAGES_DEMO_CREATED',JSON.stringify({leadId,quoteId,orderId,telegram:'@Flyer_Flyer',telegramUserId:tg,manager:manager.name}));
