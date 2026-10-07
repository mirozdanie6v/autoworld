import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const base=String(process.env.STAGING_URL||process.env.PRODUCTION_URL||'https://awgcars.ru').replace(/\/$/,'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'').trim();
const botToken=String(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN||'').trim();
const username=String(process.env.AUDIT_CLIENT_TELEGRAM_USERNAME||'Flyer_kg').trim().replace(/^@/,'');
const explicitTelegramId=String(process.env.AUDIT_CLIENT_TELEGRAM_ID||'').trim();
const expectedManagerName=String(process.env.AUDIT_MANAGER_NAME||'Дмитрий').trim();
const recentMinutes=Math.max(5,Number(process.env.AUDIT_RECENT_COMMAND_MAX_AGE_MINUTES||120));
if(!apiKey)throw new Error('AUTO_SALE_API_KEY required');
if(!botToken)throw new Error('AUTO_SALE_TELEGRAM_BOT_TOKEN required');
if(!username)throw new Error('AUDIT_CLIENT_TELEGRAM_USERNAME required');

const report={
  ok:false,
  base,
  username:'@'+username,
  identity:null,
  access:null,
  leadId:null,
  notifications:[],
  cleanup:null
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function jsonFetch(url,options={}){
  const response=await fetch(url,{
    ...options,
    signal:AbortSignal.timeout(30000)
  });
  const data=await response.json().catch(()=>({}));
  return{response,data};
}

async function admin(path,options={}){
  const headers={'content-type':'application/json','x-auto-sale-key':apiKey,...(options.headers||{})};
  return jsonFetch(base+path,{...options,headers});
}

async function getTelegramChat(chatId){
  const {response,data}=await jsonFetch(`https://api.telegram.org/bot${botToken}/getChat`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id:String(chatId)})
  });
  if(!response.ok||data?.ok!==true)return null;
  return data.result||null;
}

function signInitData(user){
  const params=new URLSearchParams();
  params.set('auth_date',String(Math.floor(Date.now()/1000)));
  params.set('query_id','autoworld-e2e-'+randomUUID());
  params.set('user',JSON.stringify(user));
  const check=[...params.entries()]
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([key,value])=>`${key}=${value}`)
    .join('\n');
  const secret=createHmac('sha256','WebAppData').update(botToken).digest();
  const hash=createHmac('sha256',secret).update(check).digest('hex');
  params.set('hash',hash);
  return params.toString();
}

async function resolvePhysicalUser(){
  if(explicitTelegramId){
    assert.match(explicitTelegramId,/^\\d+$/,'AUDIT_CLIENT_TELEGRAM_ID must be numeric');
    const chat=await getTelegramChat(explicitTelegramId);
    assert.ok(chat,'explicit physical Telegram identity must be reachable through bot getChat');
    assert.equal(String(chat.username||'').replace(/^@/,'').toLowerCase(),username.toLowerCase(),'explicit Telegram ID must belong to requested username');
    assert.equal(String(chat.type||''),'private','physical E2E requires a private Telegram chat');
    return{
      id:String(chat.id),
      username:String(chat.username||''),
      first_name:String(chat.first_name||''),
      last_name:String(chat.last_name||''),
      matchedCommandAt:'resolved-by-trusted-audit-bridge',
      matchedCommandMessageId:''
    };
  }
  const {response,data}=await admin('/api/auto-sale/telegram/recent-command-recipients?limit=100');
  assert.equal(response.status,200,'recent Telegram recipients endpoint');
  assert.equal(data.ok,true,'recent Telegram recipients response');
  const cutoff=Date.now()-recentMinutes*60_000;
  const candidates=[];
  const seen=new Set();
  for(const row of data.recipients||[]){
    const chatId=String(row.chatId||'');
    const createdAt=Date.parse(row.createdAt||'');
    if(!/^\d+$/.test(chatId)||seen.has(chatId)||!Number.isFinite(createdAt)||createdAt<cutoff)continue;
    seen.add(chatId);
    const chat=await getTelegramChat(chatId);
    if(!chat)continue;
    if(String(chat.username||'').replace(/^@/,'').toLowerCase()!==username.toLowerCase())continue;
    candidates.push({row,chat});
  }
  assert.equal(candidates.length,1,`Expected exactly one recent physical Telegram identity for @${username}, got ${candidates.length}`);
  const {row,chat}=candidates[0];
  assert.equal(String(chat.type||''),'private','physical E2E requires a private Telegram chat');
  return{
    id:String(chat.id),
    username:String(chat.username||''),
    first_name:String(chat.first_name||''),
    last_name:String(chat.last_name||''),
    matchedCommandAt:String(row.createdAt||''),
    matchedCommandMessageId:String(row.messageId||'')
  };
}

async function client(path,initData,options={}){
  const headers={'content-type':'application/json','x-telegram-init-data':initData,...(options.headers||{})};
  return jsonFetch(base+path,{...options,headers});
}

async function waitDeliveries(ids){
  const wanted=[...new Set(ids.map(String).filter(Boolean))];
  assert.ok(wanted.length>=2,'client E2E must queue at least client + manager notifications');
  let rows=[];
  for(let attempt=0;attempt<30;attempt++){
    const query=new URLSearchParams();
    for(const id of wanted)query.append('id',id);
    const checked=await admin('/api/auto-sale/notifications/status?'+query);
    assert.equal(checked.response.status,200,'notification status lookup');
    rows=checked.data.deliveries||[];
    if(rows.length===wanted.length&&rows.every(item=>item.status==='sent'&&item.messageId))return rows;
    if(rows.some(item=>['pending','retry','processing'].includes(item.status))){
      await admin('/api/auto-sale/notifications/process?'+query,{method:'POST'});
    }
    await sleep(1000+attempt*200);
  }
  throw new Error('Physical Telegram deliveries not confirmed: '+JSON.stringify(rows));
}

const identity=await resolvePhysicalUser();
report.identity={...identity,id:identity.id};
const telegramUser={
  id:identity.id,
  username:identity.username,
  first_name:identity.first_name,
  last_name:identity.last_name
};
const initData=signInitData(telegramUser);

const initialClient=await client('/api/auto-sale/state',initData);
assert.equal(initialClient.response.status,200,'client state read before test');
assert.equal(initialClient.data?._access?.role,'client','real Telegram identity must resolve to client role');
assert.equal(initialClient.data?._access?.authenticated,true,'real Telegram client must be authenticated');
assert.equal(String(initialClient.data?._access?.user?.id||''),identity.id,'client access user ID');
assert.equal((initialClient.data.team||[]).length,0,'client must not receive staff directory');
report.access=initialClient.data._access;

const suffix=randomUUID().replace(/-/g,'').slice(0,12).toUpperCase();
const leadId='L-E2E-'+suffix;
const noteId='N-E2E-'+suffix;
report.leadId=leadId;
let created=false;

try{
  const operations=[
    {
      resource:'lead',operation:'create',id:leadId,
      input:{
        id:leadId,
        name:'ТЕСТ @'+username,
        contact:'@'+username,
        model:'ТЕСТ · BMW X5 · '+suffix,
        origin:'США',
        budget:45000,
        source:'Manual',
        manager:'CLIENT_MUST_NOT_ASSIGN',
        status:'Сделка',
        priority:'Высокий',
        telegramUserId:'0',
        telegramUsername:'spoofed'
      }
    },
    {
      resource:'note',operation:'create',leadId,
      input:{id:noteId,text:'Автоматический E2E от физического Telegram-клиента @'+username}
    }
  ];
  const createdResult=await client('/api/auto-sale/entities/batch',initData,{
    method:'POST',
    body:JSON.stringify({operations})
  });
  assert.ok(createdResult.response.ok,'real client request create failed: '+JSON.stringify(createdResult.data));
  created=true;

  const ids=createdResult.data?.notifications?.ids||[];
  const deliveries=await waitDeliveries(ids);
  report.notifications=deliveries.map(item=>({
    id:item.id,target:item.target,event:item.event,messageId:item.messageId,status:item.status
  }));
  assert.ok(deliveries.some(item=>item.target==='client'&&item.event==='lead_created_confirmation'&&item.messageId),'client confirmation not delivered');
  assert.ok(deliveries.some(item=>item.target==='manager'&&item.event==='lead_created'&&item.messageId),'manager notification not delivered');

  const adminState=await admin('/api/auto-sale/state');
  assert.equal(adminState.response.status,200,'admin state verification');
  const persisted=(adminState.data.leads||[]).find(item=>String(item.id)===leadId);
  assert.ok(persisted,'test lead missing from authoritative state');
  assert.equal(String(persisted.telegramUserId||''),identity.id,'lead ownership must use real Telegram user ID');
  assert.equal(String(persisted.telegramUsername||'').toLowerCase(),username.toLowerCase(),'lead ownership username');
  assert.equal(persisted.clientCreated,true,'lead must be marked as client-created');
  assert.equal(persisted.source,'Mini App','client cannot override source');
  assert.equal(persisted.status,'Новый','client cannot override initial status');
  assert.equal(persisted.priority,'Средний','client cannot override priority');
  assert.notEqual(persisted.manager,'CLIENT_MUST_NOT_ASSIGN','client cannot assign manager');
  assert.ok(String(persisted.manager||'').trim(),'server must assign a manager');
  assert.equal(String(persisted.manager||'').trim(),expectedManagerName,'real client request must be assigned to the requested audit manager');

  const ownState=await client('/api/auto-sale/state',initData);
  assert.equal(ownState.response.status,200,'client state verification');
  assert.ok((ownState.data.leads||[]).some(item=>String(item.id)===leadId),'client must see own lead');
  assert.equal((ownState.data.team||[]).length,0,'client must remain isolated from staff data');

  const otherInitData=signInitData({id:'999999999999993',username:'autoworld_isolation_probe',first_name:'Isolation'});
  const otherState=await client('/api/auto-sale/state',otherInitData);
  assert.equal(otherState.response.status,200,'cross-client isolation read');
  assert.equal(otherState.data?._access?.role,'client','synthetic isolation identity must stay client');
  assert.ok(!(otherState.data.leads||[]).some(item=>String(item.id)===leadId),'another client must not see real client lead');

  report.ok=true;
  report.persisted={
    id:persisted.id,
    source:persisted.source,
    status:persisted.status,
    manager:persisted.manager,
    telegramUserId:String(persisted.telegramUserId||''),
    telegramUsername:String(persisted.telegramUsername||'')
  };
  console.log('AUTOWORLD_REAL_CLIENT_E2E_OK',JSON.stringify({
    username:'@'+username,
    telegramUserId:identity.id,
    leadId,
    manager:persisted.manager,
    notifications:report.notifications
  }));
}finally{
  if(created){
    try{
      const state=await admin('/api/auto-sale/state');
      const version=Number(state.data?._rowVersions?.lead?.[leadId]||0);
      if(version){
        const deleted=await admin('/api/auto-sale/leads/'+encodeURIComponent(leadId)+'?cascade=1',{
          method:'DELETE',
          body:JSON.stringify({baseRowVersion:version})
        });
        assert.ok(deleted.response.ok,'real client E2E cleanup failed: '+JSON.stringify(deleted.data));
      }
      const after=await admin('/api/auto-sale/state');
      assert.ok(!(after.data.leads||[]).some(item=>String(item.id)===leadId),'real client E2E lead cleanup failed');
      report.cleanup={ok:true};
    }catch(error){
      report.cleanup={ok:false,error:String(error?.stack||error)};
      if(report.ok)throw error;
    }
  }
  await writeFile('real-client-e2e-report.json',JSON.stringify(report,null,2));
}
