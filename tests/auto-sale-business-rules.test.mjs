import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_LEAD_STATUSES,QUOTE_STATUSES,validateClientRequest,validateManagerLead,validateLeadUpdate,validateQuote,
  canCreateOrder,validateOrderUpdate,normalizePayments,paymentsTotal,leadTransitionAllowed,quoteTransitionAllowed,orderRequiredFields,
  auctionDepositRange,buildUsPaymentPlan,paymentPlanTotal,paymentStageState,nextPaymentStage,migratePaymentsToPlan,validatePaymentStageEntry,
  normalizeVehicleVerification,validateVehicleVerification
} from '../public/auto-sale-business-rules.mjs';

const LEAD_STATUSES=['Новый','В работе','Расчёт','Ожидает клиента','Сделка','Отказ'];

test('client request requires contact model realistic budget and valid year range',()=>{
  assert.ok(validateClientRequest({name:'A',contact:'',model:'BMW X5',budget:40000}).length>0);
  assert.ok(validateClientRequest({name:'A',contact:'@a',model:'BMW X5',budget:40000,yearFrom:2025,yearTo:2021}).length>0);
  assert.equal(validateClientRequest({name:'A',contact:'@a',model:'BMW X5',origin:'США',budget:40000,yearFrom:2021,yearTo:2024}).length,0);
  assert.ok(validateClientRequest({name:'A',contact:'@a',model:'BMW X5',origin:'Корея',budget:40000,yearFrom:2021,yearTo:2024}).length>0);
});

test('manager-created lead requires manager source and next action',()=>{
  const bad=validateManagerLead({name:'A',contact:'@a',model:'BMW',source:'Сайт',manager:'',nextAction:''});
  assert.ok(bad.length>=2);
});

test('lead transition matrix allows canonical CRM movement and combined sent-quote step',()=>{
  const allowed={
    'Новый':['Новый','В работе','Отказ'],
    'В работе':['Новый','В работе','Расчёт','Ожидает клиента','Отказ'],
    'Расчёт':['В работе','Расчёт','Ожидает клиента','Отказ'],
    'Ожидает клиента':['Расчёт','Ожидает клиента','Отказ'],
    'Сделка':['Сделка'],
    'Отказ':['Отказ']
  };
  for(const from of LEAD_STATUSES)for(const to of LEAD_STATUSES)assert.equal(leadTransitionAllowed(from,to),allowed[from].includes(to),`${from} -> ${to}`);
  assert.equal(leadTransitionAllowed('Ожидает клиента','Сделка',{hasAgreedQuote:true,deposit:5000}),true);
  assert.equal(leadTransitionAllowed('Ожидает клиента','Сделка',{hasAgreedQuote:false,deposit:5000}),false);
  assert.equal(leadTransitionAllowed('Ожидает клиента','Сделка',{hasAgreedQuote:true,deposit:0}),false);
});

test('quote transition matrix allows client to approve a sent quote and locks terminal versions',()=>{
  const allowed={
    'Черновик':['Черновик','Отправлен'],
    'Отправлен':['Отправлен','На согласовании','Согласован','Отказ'],
    'На согласовании':['На согласовании','Согласован','Отказ'],
    'Согласован':['Согласован'],
    'Отказ':['Отказ']
  };
  assert.equal(quoteTransitionAllowed('','Черновик'),true);
  assert.equal(quoteTransitionAllowed('','Отправлен'),true);
  assert.equal(quoteTransitionAllowed('','Согласован'),false);
  for(const from of QUOTE_STATUSES)for(const to of QUOTE_STATUSES)assert.equal(quoteTransitionAllowed(from,to),allowed[from].includes(to),`${from} -> ${to}`);
});

test('active lead requires next action while terminal refusal does not',()=>{
  const common={name:'A',contact:'@a',model:'BMW',budget:40000,source:'Сайт',manager:'Анна',nextAction:''};
  assert.ok(validateLeadUpdate({...common,status:'В работе'},{status:'Новый'}).length>0);
  assert.equal(validateLeadUpdate({...common,status:'Отказ',lostReason:'Неактуально'},{status:'Новый'}).length,0);
  assert.ok(validateLeadUpdate({...common,status:'Отказ',lostReason:''},{status:'Новый'}).length>0);
});

test('sent quote requires complete cost structure and validity date',()=>{
  assert.ok(validateQuote({leadId:'L-1',model:'BMW',status:'Отправлен',lot:20000}).length>0);
  assert.equal(validateQuote({leadId:'L-1',model:'BMW',origin:'США',status:'Отправлен',lot:20000,auction:1000,inland:700,ocean:2500,customs:6000,service:1500,repair:0,validUntil:'2026-09-20'}).length,0);
});

test('order creation enforces verified USA lot plus the 25–30% auction advance',()=>{
  const usa={status:'Согласован',origin:'США',total:39000,verification:{lotNumber:'LOT-777',vin:'WAUZZZTEST1234567',year:2023,mileage:18000,damage:'Косметические повреждения',photos:['https://example.com/lot.jpg'],reportUrl:'https://example.com/report',history:'Проверена история.',result:'Одобрен к покупке',checkedAt:'2026-09-25'}};
  assert.equal(canCreateOrder({quote:{status:'На согласовании',origin:'США',total:39000},deposit:10000}).ok,false);
  assert.equal(canCreateOrder({quote:{status:'Согласован',origin:'США',total:39000},deposit:10000}).ok,false);
  assert.equal(canCreateOrder({quote:usa,deposit:5000}).ok,false);
  assert.equal(canCreateOrder({quote:usa,deposit:10000}).ok,true);
  assert.deepEqual(auctionDepositRange(39000),{min:9750,max:11700});
  assert.equal(canCreateOrder({quote:{status:'Согласован',origin:'Грузия',total:25000},deposit:1000}).ok,true);
});

test('logistics fields are route-neutral and required through handoff',()=>{
  assert.deepEqual(orderRequiredFields('Выкуп'),[]);
  for(const stage of ['Подготовка к отправке','В пути','Таможня','Доставка','Выдача','Порт США','В море'])assert.deepEqual(orderRequiredFields(stage),['vin','eta','location'],stage);
});

test('logistics blocks skipped stages missing fields unnoted risks and invalid payments',()=>{
  assert.ok(validateOrderUpdate({stage:'В пути',lot:'123',vin:'VIN',eta:'2026-10-20',location:'Маршрут',riskType:'Нет',paymentAmount:0},'Выкуп',['Выкуп','Подготовка к отправке']).length>0);
  assert.ok(validateOrderUpdate({stage:'Подготовка к отправке',lot:'',vin:'',eta:'2026-10-20',location:'Точка отправления',riskType:'Нет',paymentAmount:0},'Выкуп',['Выкуп','Подготовка к отправке']).length>0);
  assert.ok(validateOrderUpdate({stage:'Подготовка к отправке',lot:'',vin:'VIN',eta:'2026-10-20',location:'Точка отправления',riskType:'Задержка',riskNote:'',paymentAmount:0},'Выкуп',['Выкуп','Подготовка к отправке']).length>0);
  assert.ok(validateOrderUpdate({stage:'Подготовка к отправке',lot:'',vin:'VIN',eta:'2026-10-20',location:'Точка отправления',riskType:'Нет',paymentAmount:1000,paymentDate:''},'Выкуп',['Выкуп','Подготовка к отправке']).length>0);
  assert.equal(validateOrderUpdate({stage:'Подготовка к отправке',lot:'',vin:'VIN',eta:'2026-10-20',location:'Точка отправления',riskType:'Нет',paymentAmount:1000,paymentDate:'2026-09-12'},'Выкуп',['Выкуп','Подготовка к отправке']).length,0);
});

test('issued vehicle cannot move backward',()=>{
  assert.ok(validateOrderUpdate({stage:'Доставка',lot:'123',vin:'VIN',eta:'2026-09-12',location:'City',riskType:'Нет',paymentAmount:0},'Выдача',['Выдача']).length>0);
});

test('legacy paid total migrates into payment history',()=>{
  const payments=normalizePayments({paid:12000});
  assert.equal(payments.length,1);
  assert.equal(paymentsTotal(payments),12000);
});

test('active status registry matches CRM matrix',()=>{
  assert.deepEqual(ACTIVE_LEAD_STATUSES,['Новый','В работе','Расчёт','Ожидает клиента']);
});

test('Georgia quote can omit auction fee and sea transport',()=>{
  const errors=validateQuote({leadId:'L-GE',model:'Kia',origin:'Грузия',transportMode:'Автовоз',status:'Отправлен',lot:20000,auction:0,inland:900,ocean:0,customs:0,service:1500,repair:0,validUntil:'2026-10-01'});
  assert.deepEqual(errors,[]);
});

test('USA payment plan has four canonical stages and reconciles to the quote total',()=>{
  const quote={origin:'США',total:39000,lot:25000,auction:1000,inland:1000,ocean:2500,customs:6500,repair:1500,service:1500};
  const plan=buildUsPaymentPlan(quote,10000);
  assert.equal(plan.length,4);
  assert.deepEqual(plan.map(x=>x.id),['auction_deposit','auction_balance','logistics_legalization','customs_fts']);
  assert.deepEqual(plan.map(x=>x.amount),[10000,16000,6500,6500]);
  assert.equal(paymentPlanTotal(plan),39000);
});

test('payments are applied sequentially to canonical stages and keep per-stage balance',()=>{
  const quote={origin:'США',total:39000,lot:25000,auction:1000,inland:1000,ocean:2500,customs:6500,repair:1500,service:1500};
  const plan=buildUsPaymentPlan(quote,10000);
  let payments=[{id:'PAY-1',amount:10000,date:'2026-09-25',method:'Банк',paymentStage:'auction_deposit'}];
  assert.equal(nextPaymentStage(plan,payments).id,'auction_balance');
  assert.deepEqual(validatePaymentStageEntry({plan,payments,stageId:'logistics_legalization',amount:1000}),['Сначала завершите «2. Автомобиль + аукционные сборы».']);
  assert.equal(validatePaymentStageEntry({plan,payments,stageId:'auction_balance',amount:17000}).length>0,true);
  payments.push({id:'PAY-2',amount:16000,date:'2026-09-26',method:'Банк',paymentStage:'auction_balance'});
  assert.equal(paymentStageState(plan[1],payments).status,'Оплачено');
  assert.equal(nextPaymentStage(plan,payments).id,'logistics_legalization');
});

test('legacy payment totals migrate into four stages without losing money',()=>{
  const quote={origin:'США',total:39000,lot:25000,auction:1000,inland:1000,ocean:2500,customs:6500,repair:1500,service:1500};
  const plan=buildUsPaymentPlan(quote,10000);
  const migrated=migratePaymentsToPlan([{id:'PAY-LEGACY',amount:30000,date:'2026-09-20',method:'Банк'}],plan);
  assert.equal(paymentsTotal(migrated),30000);
  assert.equal(migrated.every(x=>x.paymentStage),true);
  assert.equal(nextPaymentStage(plan,migrated).id,'logistics_legalization');
});

test('approved USA quote requires a complete pre-purchase dossier',()=>{
  const base={leadId:'L-VERIFY',model:'Audi Q5',origin:'США',status:'Согласован',lot:26000,auction:1000,inland:700,ocean:2400,customs:6200,repair:1200,service:1500,validUntil:'2026-10-01'};
  assert.ok(validateQuote(base).some(x=>x.includes('LOT / номер лота')));
  const verification=normalizeVehicleVerification({verificationLot:'LOT-777',verificationVin:'WAUZZZTEST1234567',verificationYear:'2023',verificationMileage:'18000',verificationDamage:'Косметические повреждения',verificationPhotos:'["https://example.com/lot.jpg"]',verificationReportUrl:'https://example.com/report',verificationHistory:'Проверена история.',verificationResult:'Одобрен к покупке',verificationCheckedAt:'2026-09-25'});
  assert.deepEqual(validateVehicleVerification({verification},{requireApproved:true}),[]);
  assert.deepEqual(validateQuote({...base,verification}),[]);
});

test('lot cannot be approved while verification result needs more work',()=>{
  const verification={lotNumber:'LOT-778',vin:'VIN778',year:2022,mileage:24000,damage:'Повреждение бампера',photos:['https://example.com/a.jpg'],history:'История проверена.',reportUrl:'',result:'Требует дополнительной проверки',checkedAt:'2026-09-25'};
  const errors=validateVehicleVerification({verification},{requireApproved:true});
  assert.ok(errors.some(x=>x.includes('Одобрен к покупке')));
});
