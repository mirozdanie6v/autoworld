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

test('claimed lead rejects takeover by another Telegram manager',()=>{
  const state={team:TEAM,leads:[{
    id:'L-1',status:'В работе',manager:'Иван',
    managerClaimedAt:'2026-10-08T00:00:00.000Z'
  }]};
  const access={role:'admin',apiKey:false,user:{id:'801',username:'smit44744'}};
  const result=applyManagerLeadClaims(state,[{
    resource:'lead',operation:'patch',id:'L-1',input:{status:'Расчёт'}
  }],access);
  assert.equal(result.ok,false);
  assert.equal(result.status,409);
  assert.equal(result.error,'lead_claimed_by_other_manager');
  assert.equal(result.assignedManager,'Иван');
});

test('Telegram routing fans out before claim and narrows to owner after claim',()=>{
  const service=createTelegramService({token:'123456:TEST_TOKEN',fetchImpl:async()=>{throw new Error('not used')},managerChatIds:''});
  const state={team:TEAM};
  const unassigned={id:'L-1',status:'Новый',manager:''};
  const claimed={...unassigned,status:'В работе',manager:'Иван',managerClaimedAt:'2026-10-08T00:00:00.000Z'};
  assert.deepEqual(service.managerIds(unassigned,state),['800','801','802']);
  assert.deepEqual(service.managerIds(claimed,state),['802']);
});

test('API-key repair path can bypass Telegram ownership policy',()=>{
  const state={team:TEAM,leads:[{id:'L-1',status:'В работе',manager:'Иван',managerClaimedAt:'x'}]};
  const access={role:'admin',apiKey:true,user:null};
  const ops=[{resource:'lead',operation:'patch',id:'L-1',input:{manager:'Алексей'}}];
  const result=applyManagerLeadClaims(state,ops,access);
  assert.equal(result.ok,true);
  assert.equal(result.operations[0].input.manager,'Алексей');
});
