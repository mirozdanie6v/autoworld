import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_STAGES, calculateQuote, quoteCost,
  nextId, nextOrderStage, filterLeads, filterOrders, sourceStats, managerStats,
  financeStats, dashboardStats, funnelStats, clientStage
} from '../public/auto-sale-core.mjs';
import {seedLeads,seedQuotes,seedOrders} from './fixtures/auto-sale-business.mjs';

test('quote total equals all cost components including company service',()=>{
  const q=seedQuotes()[0];
  assert.equal(calculateQuote(q),46800);
  assert.equal(quoteCost(q),45300);
  assert.equal(calculateQuote(q)-quoteCost(q),1500);
});

test('next order stage advances once and stops at delivery handoff',()=>{
  assert.equal(nextOrderStage('Выкуп'),'Подготовка к отправке');
  assert.equal(nextOrderStage('В пути'),'Таможня');
  assert.equal(nextOrderStage('В море'),'Таможня');
  assert.equal(nextOrderStage('Выдача'),'Выдача');
  assert.equal(ORDER_STAGES.length,10);
});

test('manager lead filters combine query status source and manager',()=>{
  const leads=seedLeads();
  const result=filterLeads(leads,{query:'tesla',status:'Ожидает клиента',source:'Instagram',manager:'Анна'});
  assert.equal(result.length,1);
  assert.equal(result[0].id,'L-102');
});

test('order control filters find risky orders and VIN search',()=>{
  const orders=seedOrders();
  assert.equal(filterOrders(orders,{risk:'risk'}).length,2);
  assert.equal(filterOrders(orders,{query:'5UXCR6C0'}).length,1);
  assert.equal(filterOrders(orders,{stage:'Таможня'})[0].id,'O-2303');
});

test('director finance totals reconcile to order ledger',()=>{
  const stats=financeStats(seedOrders());
  assert.equal(stats.turnover,162100);
  assert.equal(stats.cost,152300);
  assert.equal(stats.margin,9800);
  assert.equal(stats.paid,112800);
  assert.equal(stats.outstanding,49300);
});

test('dashboard and funnel metrics are derived from the same CRM arrays',()=>{
  const leads=seedLeads(),orders=seedOrders(),quotes=seedQuotes();
  const dashboard=dashboardStats(leads,orders,quotes);
  assert.equal(dashboard.deals,4);
  assert.equal(dashboard.conversion,50);
  assert.equal(dashboard.risky,2);
  const funnel=funnelStats(leads,orders);
  assert.equal(funnel[0].label,'Лиды');
  assert.equal(funnel[0].value,8);
  assert.equal(funnel.at(-1).value,4);
});

test('source and manager analytics reconcile with orders',()=>{
  const leads=seedLeads(),orders=seedOrders();
  const telegram=sourceStats(leads,orders).find(x=>x.source==='Telegram');
  assert.equal(telegram.leads,2);
  assert.equal(telegram.deals,1);
  const dmitriy=managerStats(leads,orders).find(x=>x.manager==='Дмитрий');
  assert.equal(dmitriy.deals,2);
  assert.equal(dmitriy.revenue,78600);
});

test('client stage follows CRM before order and logistics after conversion',()=>{
  const lead=seedLeads().find(x=>x.id==='L-101');
  assert.equal(clientStage(lead,null),'Расчёт');
  const order=seedOrders().find(x=>x.leadId==='L-101');
  assert.equal(clientStage(lead,order),'В пути');
});

test('new ids continue after the highest numeric id',()=>{
  assert.equal(nextId('L',seedLeads()),'L-109');
  assert.equal(nextId('O',seedOrders()),'O-2305');
});
