import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeClientOperations,applyManagerLeadClaims} from '../server/auto-sale-access.mjs';
import {createTelegramService} from '../server/telegram-bot.mjs';

const TEAM=[
  {id:'TM-DMITRY',name:'Дмитрий',role:'Менеджер',active:true,telegramUsername:'Flyer_Flyer',telegramUserId:'800'},
  {id:'TM-ALEXEY',name:'Алексей',role:'Менеджер',active:true,telegramUsername:'smit44744',telegramUserId:'801'},
  {id:'TM-IVAN',name:'Иван',role:'Менеджер',active:true,telegramUsername:'Ivan_AWG',telegramUserId:'802'}
];

test('new Telegram client lead remains unassigned',()=>{
  const state={leads:[],team:TEAM};
  const user={id:'700',username:'fresh_client',first_name:'Новый'};
  const result=sanitizeClientOperations(state,[{
    resource:'lead',operation:'create',id:'L-NEW',
    input:{id:'L-NEW',name:'Новый клиент',contact:'@fresh_client',model:'BMW X5'}
  }],user);
  assert.equal(result.ok,true);
  assert.equal(result.operations[0].input.status,'Новый');
  assert.equal(result.operations[0].input.manager,'');
  assert.equal(result.operations[0].input.telegramUserId,'700');
});

test('first manager status transition claims an unassigned lead',()=>{
  const state={team:TEAM,leads:[{id:'L-1',name:'Клиент',status:'Новый',manager:''}]};
  const access={role:'admin',apiKey:false,user:{id:'802',username:'Ivan_AWG'}};
  const result=applyManagerLeadClaims(state,[{
    resource:'lead',operation:'patch',id:'L-1',input:{status:'В работе',baseRowVersion:4}
  }],access,{now:()=> '2026-10-08T00:00:00.000Z'});
  assert.equal(result.ok,true);
  const input=result.operations[0].input;
  assert.equal(input.manager,'Иван');
  assert.equal(input.managerTelegramUserId,'802');
  assert.equal(input.managerTelegramUsername,'ivan_awg');
  assert.equal(input.managerClaimedAt,'2026-10-08T00:00:00.000Z');
});

test('latest status-changing manager takes over an already assigned lead',()=>{
  const state={team:TEAM,leads:[{
    id:'L-1',status:'В работе',manager:'Иван',
    managerClaimedAt:'2026-10-08T00:00:00.000Z',
    managerTelegramUserId:'802',managerTelegramUsername:'ivan_awg'
  }]};
  const access={role:'admin',apiKey:false,user:{id:'801',username:'smit44744'}};
  const result=applyManagerLeadClaims(state,[{
    resource:'lead',operation:'patch',id:'L-1',input:{
      status:'Расчёт',manager:'Иван',managerTelegramUserId:'802',managerClaimedAt:'spoofed'
    }
  }],access,{now:()=> '2026-10-10T00:00:00.000Z'});
  assert.equal(result.ok,true);
  const input=result.operations[0].input;
  assert.equal(input.manager,'Алексей');
  assert.equal(input.managerTelegramUserId,'801');
  assert.equal(input.managerTelegramUsername,'smit44744');
  assert.equal(input.managerClaimedAt,'2026-10-10T00:00:00.000Z');
  assert.equal(input.managerClaimedByTelegramUserId,'801');
});

test('sequential status transitions reassign from Ivan to Alexey to Dmitry, no first-touch lock',()=>{
  const timeline=[
    [{id:'801',username:'smit44744'},'Расчёт','Алексей'],
    [{id:'800',username:'Flyer_Flyer'},'Ожидает клиента','Дмитрий']
  ];
  let lead={id:'L-1',status:'В работе',manager:'Иван',
    managerTelegramUserId:'802',managerClaimedAt:'2026-10-08T00:00:00.000Z'};
  for(const [user,status,name] of timeline){
    const result=applyManagerLeadClaims({team:TEAM,leads:[lead]},[{
      resource:'lead',operation:'patch',id:lead.id,input:{status}
    }],{role:'admin',apiKey:false,user});
    assert.equal(result.ok,true);
    lead={...lead,...result.operations[0].input};
    assert.equal(lead.status,status);
    assert.equal(lead.manager,name);
  }
  assert.equal(lead.managerTelegramUserId,'800');
});

test('same-status and non-status updates cannot reassign lead or spoof another manager',()=>{
  const state={team:TEAM,leads:[{id:'L-1',status:'В работе',manager:'Иван',
    managerTelegramUserId:'802',managerTelegramUsername:'ivan_awg'}]};
  const access={role:'admin',apiKey:false,user:{id:'801',username:'smit44744'}};
  for(const input of [
    {status:'В работе',manager:'Алексей',managerTelegramUserId:'801'},
    {nextAction:'2026-10-20',manager:'Алексей',managerClaimedByTelegramUsername:'smit44744'}
  ]){
    const result=applyManagerLeadClaims(state,[{resource:'lead',operation:'patch',id:'L-1',input}],access);
    assert.equal(result.ok,true);
    assert.equal('manager' in result.operations[0].input,false);
    assert.equal('managerTelegramUserId' in result.operations[0].input,false);
  }
});

test('unknown user and non-manager cannot change status or forge manager attribution',()=>{
  const state={team:TEAM,leads:[{id:'L-1',status:'Новый',manager:''}]};
  for(const user of [{id:'999',username:'not_a_manager'},{id:'',username:'smit44744'}]){
    const result=applyManagerLeadClaims(state,[{
      resource:'lead',operation:'patch',id:'L-1',input:{status:'В работе',manager:'Алексей'}
    }],{role:'admin',apiKey:false,user});
    assert.equal(result.ok,false);
    assert.equal(result.status,403);
    assert.equal(result.error,'manager_identity_required');
  }
});

test('Telegram routing fans out before first status edit and follows last status editor',()=>{
  const service=createTelegramService({token:'123456:TEST_TOKEN',fetchImpl:async()=>{throw new Error('not used')},managerChatIds:''});
  const state={team:TEAM};
  const unassigned={id:'L-1',status:'Новый',manager:''};
  const claimed={...unassigned,status:'В работе',manager:'Иван',managerClaimedAt:'2026-10-08T00:00:00.000Z'};
  assert.deepEqual(service.managerIds(unassigned,state),['800','801','802']);
  assert.deepEqual(service.managerIds(claimed,state),['802']);
  const reassigned={...claimed,status:'Расчёт',manager:'Алексей',managerTelegramUserId:'801',managerTelegramUsername:'smit44744'};
  assert.deepEqual(service.managerIds(reassigned,state),['801']);
});

test('API-key repair path can bypass Telegram ownership policy',()=>{
  const state={team:TEAM,leads:[{id:'L-1',status:'В работе',manager:'Иван',managerClaimedAt:'x'}]};
  const access={role:'admin',apiKey:true,user:null};
  const ops=[{resource:'lead',operation:'patch',id:'L-1',input:{manager:'Алексей'}}];
  const result=applyManagerLeadClaims(state,ops,access);
  assert.equal(result.ok,true);
  assert.equal(result.operations[0].input.manager,'Алексей');
});
