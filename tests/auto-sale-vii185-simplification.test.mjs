import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AWG_US_SIMPLE_SCHEMA,AWG_US_SIMPLE_TARIFF,
  simpleUsQuote,quoteV2Amounts,quoteV2Total,quoteV2Rows,quoteV2Errors,quoteV2Form
} from '../public/auto-sale-quote-v2.mjs';
import {
  canCreateOrder,buildUsPaymentPlan,validateQuote as validateClientQuote,validateClientRequest
} from '../public/auto-sale-business-rules.mjs';
import {validateQuote as validateServerQuote,validateOrder} from '../server/auto-sale-rules.mjs';

const base={id:'Q-SIMPLE',leadId:'L-1',model:'Chevrolet Trailblazer',
  origin:'США',quoteSchema:AWG_US_SIMPLE_SCHEMA,tariffVersion:AWG_US_SIMPLE_TARIFF,
  transportMode:'Доставка под ключ',status:'Отправлен',lot:20000,repair:500,
  auction:1650,inland:900,ocean:2300,partsCost:450,turnkeyDeliveryUsd:1000,cryptoFee:875,
  customsAndRecyclingRub:420000,verification:{},cbrRubRate:0,exchangeRateDate:'',
  ageCategory:'',engineType:'',engineCc:0,powerHp:0,internationalTransferPercent:3.5};
const quote=(status='Отправлен')=>({...base,...quoteV2Amounts(base),status,total:quoteV2Total(base)});

test('new USA quote uses only vehicle+approximate repair, discarding old costs',()=>{
  const q=quote();assert.ok(simpleUsQuote(q));assert.equal(q.total,20500);
  assert.equal(q.auction,0);assert.equal(q.inland,0);assert.equal(q.ocean,0);
  assert.equal(q.partsCost,0);assert.equal(q.cryptoFee,0);assert.equal(q.turnkeyDeliveryUsd,0);
  assert.equal(quoteV2Total({...q,auction:4500}),20500);
  assert.deepEqual(quoteV2Errors(q),[]);
  assert.deepEqual(validateClientQuote(q),[]);
  assert.deepEqual(validateServerQuote(q),[]);
});
test('customs are only reference in RUB; repair is last client cost row',()=>{
  const q=quote(),rows=quoteV2Rows(q);
  assert.deepEqual(rows.map(x=>x.key),['lot','customsReference','repair']);
  assert.equal(rows[1].value,0);assert.match(rows[1].displayValue,/420/);
  assert.equal(rows.reduce((s,x)=>s+x.value,0),20500);
});
test('the US calculation form has editable VIN, date and liters, but no dossier',()=>{
  const q=quote('Черновик'),html=quoteV2Form(q,[{id:'L-1',name:'Client',model:'Chevrolet'}],['Черновик','Отправлен'],String);
  assert.match(html,/name="vin"/);
  for(const name of ['manufactureYear','manufactureMonth','manufactureDay'])assert.ok(html.includes('name="'+name+'"'));
  assert.match(html,/type="hidden" name="manufactureDate"/);
  assert.doesNotMatch(html,/name="manufactureDate" type="date"/);
  assert.match(html,/name="engineLiters"/);assert.match(html,/Город/);
  assert.doesNotMatch(html,/Досье проверки автомобиля США/);
  assert.doesNotMatch(html,/name="auction"/);
  assert.doesNotMatch(html,/name="internationalTransferPercent"/);
});
test('client acknowledges preliminary quote; order needs a separate agreed contract total',()=>{
  const q=quote('Согласован');
  assert.equal(canCreateOrder({quote:q,deposit:6000}).ok,false);
  assert.equal(canCreateOrder({quote:q,deposit:6000,agreedOrderTotal:22000}).ok,true);
  const plan=buildUsPaymentPlan({...q,total:22000},6000);
  assert.equal(plan.reduce((s,row)=>s+row.amount,0),22000);
  assert.equal(plan.find(row=>row.id==='customs_fts').amount,0);
  const order={leadId:'L-1',origin:'США',total:22000,priceBasis:'agreed_contract',preliminaryTotal:20500,stage:'Выкуп',payments:[],paymentPlan:plan};
  assert.deepEqual(validateOrder(order),[]);
});
test('similar-car client form requires price and a year range, without age-band',()=>{
 const q={name:'Иван',contact:'@client',model:'Chevrolet',origin:'США',budget:20000,yearFrom:2020,yearTo:2023,carId:'CAR-1'};
 assert.deepEqual(validateClientRequest(q),[]);
 assert.ok(validateClientRequest({...q,yearFrom:''}).length>0);
 assert.ok(validateClientRequest({...q,budget:0}).length>0);
 assert.ok(validateClientRequest({...q,yearFrom:2025,yearTo:2021}).length>0);
});