import assert from 'node:assert/strict';
import {appendFile} from 'node:fs/promises';
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {createYdbStateStore} from '../server/ydb-state.mjs';

const clean=value=>String(value??'').trim();
const normalize=value=>clean(value).replace(/^@/,'').toLowerCase();
const connectionString=clean(process.env.YDB_CONNECTION_STRING);
const iamToken=clean(process.env.YC_IAM_TOKEN);
const botToken=clean(process.env.AUTO_SALE_TELEGRAM_BOT_TOKEN);
assert.ok(connectionString&&iamToken&&botToken,'audit_credentials_required');
const credentialsProvider=new AccessTokenCredentialsProvider({token:iamToken});
const domain=await createYdbDomainStore({connectionString,credentialsProvider,ensureSchema:false});
const runtime=await createYdbStateStore({connectionString,credentialsProvider,ensureSchema:false,domainDualWrite:false});
let extraDriver=null;
try{
  const healthResponse=await fetch('https://awgcars.ru/api/health',{signal:AbortSignal.timeout(30000),cache:'no-store'});
  const health=await healthResponse.json();
  assert.equal(healthResponse.status,200);
  assert.equal(health.ok,true);
  assert.equal(health.buildSha,process.env.AUDIT_EXPECTED_BUILD_SHA,'credentials must match current production');
  assert.equal(health.telegramNotifications,'enabled');
  const pins=await runtime.adminAccessList();
  const managerPin=pins.find(item=>normalize(item.username)==='flyer_flyer');
  assert.ok(managerPin&&/^\d+$/.test(managerPin.telegramUserId),'Dmitry must already be registered');
  const snapshot=await domain.loadState();
  const managerMember=(snapshot.team||[]).find(item=>clean(item.name)==='Дмитрий'&&item.active!==false);
  assert.ok(managerMember&&clean(managerMember.role)==='Менеджер','Dmitry active manager required');

  async function chatFor(id){
    try{
      const response=await fetch('https://api.telegram.org/bot'+botToken+'/getChat',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:String(id)}),
        signal:AbortSignal.timeout(10000)
      });
      const data=await response.json();
      return response.ok&&data.ok?data.result:null;
    }catch{return null}
  }
  const managerChat=await chatFor(managerPin.telegramUserId);
  assert.ok(managerChat&&normalize(managerChat.username)==='flyer_flyer'&&managerChat.type==='private','verified private Dmitry Telegram chat');
  const candidates=new Set((snapshot.leads||[])
    .filter(item=>normalize(item.telegramUsername)==='flyer_kg'&&/^\d+$/.test(clean(item.telegramUserId)))
    .map(item=>clean(item.telegramUserId)));
  let source='existing-linked-lead';
  if(!candidates.size){
    source='bot-command-history';
    extraDriver=new Driver(connectionString,{credentialsProvider});
    await extraDriver.ready();
    const sql=query(extraDriver);
    const [rows]=await sql`SELECT payload,created_at FROM auto_sale_notification_outbox ORDER BY created_at DESC LIMIT 5000`
      .isolation('onlineReadOnly',{allowInconsistentReads:false}).idempotent(true).timeout(10000);
    for(const row of rows){
      let item;
      try{item=JSON.parse(String(row.payload||'{}'))}catch{continue}
      if(item.event==='bot_command_reply'&&/^\d+$/.test(clean(item.chatId)))candidates.add(clean(item.chatId));
    }
  }
  let clientChat=null;
  for(const id of candidates){
    const chat=await chatFor(id);
    if(chat?.type==='private'&&normalize(chat.username)==='flyer_kg'){
      assert.ok(!clientChat||String(clientChat.id)===String(chat.id),'client identity must be unique');
      clientChat=chat;
    }
  }
  assert.ok(clientChat,'physical Flyer_kg identity unavailable in existing leads or bot-command history');
  assert.notEqual(String(clientChat.id),String(managerChat.id));
  assert.ok(!pins.some(item=>String(item.telegramUserId)===String(clientChat.id)),'Flyer_kg must be a client, not an admin');
  const asUser=chat=>({id:String(chat.id),username:String(chat.username),first_name:String(chat.first_name||''),last_name:String(chat.last_name||'')});
  const values={
    AUDIT_CLIENT_TELEGRAM_ID:String(clientChat.id),
    AUDIT_MANAGER_TELEGRAM_ID:String(managerChat.id),
    AUDIT_CLIENT_USER:JSON.stringify(asUser(clientChat)),
    AUDIT_MANAGER_USER:JSON.stringify(asUser(managerChat)),
    AUDIT_CLIENT_TELEGRAM_USERNAME:'Flyer_kg',
    AUDIT_MANAGER_NAME:'Дмитрий'
  };
  for(const id of [String(clientChat.id),String(managerChat.id)])console.log('::add-mask::'+id);
  await appendFile(process.env.GITHUB_ENV,Object.entries(values).map(([key,value])=>key+'='+value).join('\n')+'\n');
  console.log('AUDIT_IDENTITIES_VERIFIED',JSON.stringify({client:'@Flyer_kg',manager:'Дмитрий / @Flyer_Flyer',identitySource:source,alreadyRegistered:true,distinctAccounts:true,buildSha:health.buildSha}));
}finally{
  if(extraDriver)extraDriver.close();
  await Promise.allSettled([domain.close(),runtime.close()]);
}
