import assert from 'node:assert/strict';
import {appendFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
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
    const url='https://api.telegram.org/bot'+botToken+'/getChat';
    const body=JSON.stringify({chat_id:String(id)});
    let data=null;
    try{
      const response=await fetch(url,{
        method:'POST',headers:{'content-type':'application/json'},body,
        signal:AbortSignal.timeout(8000)
      });
      data=await response.json();
    }catch(error){
      console.log('TELEGRAM_CHAT_FETCH_UNAVAILABLE',JSON.stringify({errorName:String(error.name||'fetch_error')}));
      try{
        const response=await exec('curl',['--ipv4','--connect-timeout','5','--max-time','12','--silent','--show-error','--header','Content-Type: application/json','--data',body,url],{timeout:15000,maxBuffer:100000});
        data=JSON.parse(response.stdout);
      }catch(error){
        console.log('TELEGRAM_CHAT_CURL_UNAVAILABLE',JSON.stringify({errorCode:String(error.code||'network_error')}));
      }
    }
    if(data?.ok)return data.result;
    if(data)console.log('TELEGRAM_CHAT_LOOKUP_REJECTED',JSON.stringify({code:data.error_code,description:data.description}));
    return null;
  }
  let managerChat=await chatFor(managerPin.telegramUserId);
  const managerIdentitySource=managerChat?'telegram-getChat':'registered-immutable-admin-pin';
  if(!managerChat)managerChat={id:managerPin.telegramUserId,username:'Flyer_Flyer',first_name:'Дмитрий',type:'private'};
  assert.ok(normalize(managerChat.username)==='flyer_flyer'&&managerChat.type==='private','registered private Dmitry Telegram identity');
  console.log('AUDIT_LINKED_CLIENT_ROWS',JSON.stringify({matchingRows:(snapshot.leads||[]).filter(item=>normalize(item.telegramUsername)==='flyer_kg'&&/^\d+$/.test(clean(item.telegramUserId))).length}));
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
    let chat=await chatFor(id);
    if(!chat&&source==='existing-linked-lead'){
      const trusted=(snapshot.leads||[]).find(item=>normalize(item.telegramUsername)==='flyer_kg'&&clean(item.telegramUserId)===id);
      if(trusted)chat={id,username:trusted.telegramUsername,first_name:trusted.telegramFirstName||'',last_name:trusted.telegramLastName||'',type:'private'};
    }
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
  console.log('AUDIT_IDENTITIES_VERIFIED',JSON.stringify({client:'@Flyer_kg',manager:'Дмитрий / @Flyer_Flyer',identitySource:source,managerIdentitySource,alreadyRegistered:true,distinctAccounts:true,buildSha:health.buildSha}));
}finally{
  if(extraDriver)extraDriver.close();
  await Promise.allSettled([domain.close(),runtime.close()]);
}
