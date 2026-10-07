import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createVkService} from '../server/vk.mjs';
import {clientState,sanitizeClientOperations} from '../server/auto-sale-access.mjs';
import {createTelegramService} from '../server/telegram-bot.mjs';

const APP_ID='777001';
const SECRET='vk-test-secret';
const NOW_SEC=2_000_000_000;

function launchParams({userId='42',appId=APP_ID,ts=NOW_SEC,secret=SECRET,extra={}}={}){
  const params=new URLSearchParams({
    vk_app_id:String(appId),
    vk_user_id:String(userId),
    vk_ts:String(ts),
    vk_platform:'android',
    vk_language:'ru',
    ...extra
  });
  const signed=new URLSearchParams([...params.entries()].sort(([a],[b])=>a.localeCompare(b))).toString();
  const sign=createHmac('sha256',secret).update(signed).digest('base64url');
  params.set('sign',sign);
  return params.toString();
}

test('VK launch params are feature-gated and HMAC verified',()=>{
  const off=createVkService({enabled:false,appId:APP_ID,appSecret:SECRET,now:()=>NOW_SEC*1000});
  assert.equal(off.validateLaunchParams(launchParams()).error,'vk_not_configured');

  const service=createVkService({enabled:true,appId:APP_ID,appSecret:SECRET,now:()=>NOW_SEC*1000,fetchImpl:async()=>{}});
  const valid=service.validateLaunchParams(launchParams({userId:'123'}));
  assert.equal(valid.ok,true);
  assert.deepEqual(valid.identity,{provider:'vk',id:'123',key:'vk:123'});
  assert.equal(valid.user.provider,'vk');

  const tampered=new URLSearchParams(launchParams({userId:'123'}));
  tampered.set('vk_user_id','124');
  assert.equal(service.validateLaunchParams(tampered.toString()).error,'vk_sign_invalid');
  assert.equal(service.validateLaunchParams(launchParams({appId:'999'})).error,'vk_app_id_invalid');
  assert.equal(service.validateLaunchParams(launchParams({ts:NOW_SEC-86401})).error,'vk_launch_params_expired');
});

test('VK and Telegram numeric IDs cannot see each other leads',()=>{
  const state={
    leads:[
      {id:'TG',telegramUserId:'42',clientCreated:true},
      {id:'VK',clientProvider:'vk',clientProviderUserId:'42',clientIdentityKey:'vk:42',clientCreated:true}
    ],
    quotes:[],orders:[],catalog:[],team:[],notes:{}
  };
  assert.deepEqual(clientState(state,{provider:'telegram',id:'42'}).leads.map(x=>x.id),['TG']);
  assert.deepEqual(clientState(state,{provider:'vk',id:'42'}).leads.map(x=>x.id),['VK']);
});

test('VK client creation stores generic provider identity and no Telegram identity',()=>{
  const result=sanitizeClientOperations({leads:[],quotes:[],orders:[]},[
    {resource:'lead',operation:'create',id:'L-VK',input:{id:'L-VK',name:'VK Client',model:'BMW X5'}}
  ],{id:'42',provider:'vk'},{provider:'vk',id:'42',key:'vk:42'});
  assert.equal(result.ok,true);
  const lead=result.operations[0].input;
  assert.equal(lead.manager,'');
  assert.equal(lead.status,'Новый');
  assert.equal(lead.clientProvider,'vk');
  assert.equal(lead.clientProviderUserId,'42');
  assert.equal(lead.clientIdentityKey,'vk:42');
  assert.equal(Object.prototype.hasOwnProperty.call(lead,'telegramUserId'),false);
});

test('VK client lead keeps manager fan-out in Telegram and routes client confirmation to VK',async()=>{
  const service=createTelegramService({
    token:'123456:TEST_TOKEN',
    managerChatIds:'900,901',
    fetchImpl:async()=>{throw new Error('send must not run during planning')},
    relayUrl:''
  });
  const previous={initialized:true,revision:10,leads:[],quotes:[],orders:[],team:[]};
  const next={initialized:true,revision:11,leads:[{
    id:'L-VK',name:'VK Client',model:'Audi Q5',budget:40000,contact:'vk',
    clientCreated:true,clientProvider:'vk',clientProviderUserId:'42',clientIdentityKey:'vk:42',
    status:'Новый',manager:''
  }],quotes:[],orders:[],team:[]};
  const planned=await service.collectStateChanges(previous,next);
  const managers=planned.filter(x=>x.target==='manager');
  const client=planned.find(x=>x.target==='client');
  assert.deepEqual(managers.map(x=>[x.channel,x.chatId]),[['telegram','900'],['telegram','901']]);
  assert.equal(client.channel,'vk');
  assert.equal(client.vkUserId,'42');
  assert.match(client.id,/client:vk:42$/);
});

test('legacy Telegram client notification IDs and routes remain stable',async()=>{
  const service=createTelegramService({
    token:'123456:TEST_TOKEN',
    managerChatIds:'900',
    fetchImpl:async()=>{throw new Error('send must not run during planning')},
    relayUrl:''
  });
  const previous={initialized:true,revision:10,leads:[],quotes:[],orders:[],team:[]};
  const next={initialized:true,revision:11,leads:[{
    id:'L-TG',name:'TG Client',model:'BMW X3',clientCreated:true,telegramUserId:'42',status:'Новый'
  }],quotes:[],orders:[],team:[]};
  const client=(await service.collectStateChanges(previous,next)).find(x=>x.target==='client');
  assert.equal(client.channel,'telegram');
  assert.equal(client.chatId,'42');
  assert.match(client.id,/client:42$/);
});


test('VK Mini App shell initializes once and does not require messaging config',async()=>{
  const previousWindow=globalThis.window;
  const previousSessionStorage=globalThis.sessionStorage;
  const calls=[];
  globalThis.window={
    location:{search:'?vk_app_id=54810434&vk_user_id=42&sign=test'},
    vkBridge:{
      send:async method=>{
        calls.push(method);
        return{};
      }
    }
  };
  globalThis.sessionStorage={
    getItem:()=>null,
    setItem:()=>{}
  };
  try{
    const url=new URL('../public/auto-sale-vk.mjs',import.meta.url);
    url.searchParams.set('test',String(Date.now()));
    const module=await import(url.href);
    const first=await module.initVkMiniAppShell();
    const second=await module.initVkMiniAppShell();
    assert.equal(first.ok,true);
    assert.equal(second.ok,true);
    assert.deepEqual(calls,['VKWebAppInit']);
  }finally{
    if(previousWindow===undefined)delete globalThis.window;
    else globalThis.window=previousWindow;
    if(previousSessionStorage===undefined)delete globalThis.sessionStorage;
    else globalThis.sessionStorage=previousSessionStorage;
  }
});

test('VK shell bootstrap is placed only at the application startup boundary',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../public/auto-sale-bootstrap.mjs',import.meta.url),'utf8');
  assert.equal(source.includes('const state=if('),false);
  const initIndex=source.lastIndexOf('initVkMiniAppShell()');
  const pullIndex=source.lastIndexOf('await pullInitialState();');
  assert.ok(initIndex>0,'VK shell init must be present');
  assert.ok(pullIndex>initIndex,'VK shell init must happen before the startup state pull');
});
