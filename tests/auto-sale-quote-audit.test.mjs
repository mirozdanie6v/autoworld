import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteCostRows,quoteRowsTotal,rubToUsd,ageCategoryForDate,ageCategoryForMonth,ageCategoryForYear,quoteAuditErrors,tksParameters,QUOTE_AUDIT_SCHEMA} from '../public/auto-sale-quote-audit.mjs';
import {awgTariff} from '../public/auto-sale-tariffs.mjs';
import {calculateQuote,quoteCost} from '../public/auto-sale-core.mjs';
import {validateQuote as browserValidate} from '../public/auto-sale-business-rules.mjs';
import {validateQuote as serverValidate} from '../server/auto-sale-rules.mjs';

function validQuote(origin,age){
 const base=awgTariff(origin,age);
 const q={...base,id:'Q-AUDIT',leadId:'L-AUDIT',model:'BMW',origin,quoteSchema:QUOTE_AUDIT_SCHEMA,status:'Отправлен',lot:12000,
  auction:origin==='США'?600:0,inland:origin==='США'?400:0,ocean:base.ocean,repair:300,partsCost:origin==='США'&&age==='under3'?280:0,
  georgiaDelivery:0,cryptoFee:origin==='США'?455:0,customs:4200,recyclingFee:800,engineCc:2000,powerHp:150,
  importerType:'nat',engineType:'petrol',priceSource:origin==='США'?'Copart':'MyAuto',
  invoiceUsd:12000,customsSource:'TKS',customsCheckedAt:'2026-10-20',customsConfirmed:true,recyclingConfirmed:true,
  repairReviewed:true,cryptoBaseConfirmed:true,validUntil:'2026-11-30'};
 // This suite checks historical 2026-10-20 quotes, which must remain unchanged.
 if(origin==='Грузия'){q.tariffVersion='2026-10-20';q.service=500;q.legalization=4500;}
 q.total=calculateQuote(q);
 return q;
}
for(const origin of ['Грузия','США'])for(const age of ['under3','3to5']){
 test('customer audit scenario '+origin+' '+age+' sums all rows and validates in two layers',()=>{
  const q=validQuote(origin,age),rows=quoteCostRows(q);
  assert.equal(quoteRowsTotal(q),q.total);
  assert.equal(q.total-quoteCost(q),500);
  assert.equal(q.service,500);
  assert.equal(rows.find(x=>x.key==='legalization').value,q.legalization);
  assert.equal(rows.find(x=>x.key==='recyclingFee').value,q.recyclingFee);
  assert.equal(rows.find(x=>x.key==='customs').value,q.customs);
  if(origin==='США'){
   assert.equal(rows.find(x=>x.key==='cryptoFee').value,q.cryptoFee);
   assert.match(rows.find(x=>x.key==='inland').label,/США/);
  }else{
   assert.ok(rows.find(x=>x.key==='lot').label.includes('Грузии'));
   assert.equal(rows.some(x=>x.key==='cryptoFee'),false);
  }
  assert.deepEqual(quoteAuditErrors(q),[]);
  assert.deepEqual(browserValidate(q),[]);
  assert.deepEqual(serverValidate(q),[]);
 });
}
test('new quotes never approve zero customs or recycling without explicit reason',()=>{
 const q=validQuote('Грузия','3to5');q.customs=0;q.recyclingFee=0;q.total=calculateQuote(q);
 assert.ok(quoteAuditErrors(q).some(x=>x.includes('Таможня')));
 assert.ok(quoteAuditErrors(q).some(x=>x.includes('Утильсбор')));
 assert.notDeepEqual(browserValidate(q),[]);
 assert.notDeepEqual(serverValidate(q),[]);
 q.customsZeroReason='Проверенные документы: освобождение от платежа.';
 q.recyclingZeroReason='Проверенные документы: льгота по утильсбору.';
 assert.deepEqual(browserValidate(q),[]);
 assert.deepEqual(serverValidate(q),[]);
});
test('old quotes without audit schema remain compatible',()=>{
 const q=validQuote('Грузия','3to5');
 delete q.quoteSchema;delete q.priceSource;delete q.customsSource;
 assert.deepEqual(quoteAuditErrors(q),[]);
});
test('date-only and year-only age selection refuses ambiguous boundary',()=>{
 assert.equal(ageCategoryForDate('2024-01-01','2026-10-20'),'under3');
 assert.equal(ageCategoryForDate('2022-01-01','2026-10-20'),'3to5');
 assert.equal(ageCategoryForYear(2022,'2026-10-20'),'3to5');
 assert.equal(ageCategoryForYear(2023,'2026-10-20'),'');
 assert.equal(ageCategoryForMonth('2023-10','2026-10-20'),'');
 assert.equal(ageCategoryForMonth('2024-09','2026-10-20'),'under3');
});
test('licensed TKS inputs are only reference parameters, never invented tariffs',()=>{
 const q=validQuote('США','under3');
 assert.deepEqual(tksParameters(q),{cost:12000,volume:2000,currency:840,power:150,power_edizm:'ls',engine_type:'petrol',age:3,face:'nat',ts_type:'00_8703'});
 assert.equal(rubToUsd(90000,90),1000);
 assert.equal(rubToUsd(90000,0),null);
});
