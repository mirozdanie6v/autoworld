import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  AWG_QUOTE_V2_SCHEMA,AWG_QUOTE_V2_TARIFF,v2Quote,modesV2,
  quoteV2Amounts,quoteV2Total,quoteV2TotalRub,quoteV2Rate,
  quoteV2Errors,quoteV2Form,quoteV2Rows
} from '../public/auto-sale-quote-v2.mjs';
import {validateQuote as serverValidate} from '../server/auto-sale-rules.mjs';
import {validateQuote as clientValidate} from '../public/auto-sale-business-rules.mjs';
import {calculateQuote} from '../public/auto-sale-core.mjs';
import {catalogVehicleSnapshot,renderCatalogLeadVehicle} from '../public/auto-sale-catalog-lead.mjs';
import {catalogCustomsFacts} from '../public/auto-sale-catalog-customs.mjs';

const sample=(origin='Грузия')=>{
  const q={quoteSchema:AWG_QUOTE_V2_SCHEMA,tariffVersion:AWG_QUOTE_V2_TARIFF,
    origin,status:'Отправлен',leadId:'L-1',model:'Toyota Camry',ageCategory:'3to5',
    transportMode:'Доставка под ключ',
    lot:15000,turnkeyDeliveryUsd:2000,
    customsAndRecyclingRub:550000,internationalTransferPercent:3.5,
    cbrRubRate:100,exchangeRateDate:'2026-10-22',exchangeRateSource:'cbr',
    engineCc:2487,powerHp:178,engineType:'petrol',importerType:'nat',
    auction:0,inland:0,ocean:0,repair:0,partsCost:0,
    service:0,legalization:0,customs:0,recyclingFee:0,georgiaDelivery:0};
  return {...q,...quoteV2Amounts(q),usdRubRate:quoteV2Rate(q).calculationRubRate};
};
test('new Georgia and USA price totals never double count customs/recycling or legacy service',()=>{
  for(const origin of ['Грузия','США']){
    const q=sample(origin);
    assert.equal(v2Quote(q),true);
    assert.equal(q.cryptoFee,595);
    assert.equal(quoteV2Total(q),17595);
    assert.equal(calculateQuote(q),17595);
    assert.equal(quoteV2TotalRub(q),1829880);
    assert.equal(quoteV2Rate(q).calculationRubRate,104);
    assert.equal(quoteV2Rows(q).find(x=>x.key==='customsIncluded').value,0);
    assert.equal(quoteV2Rows(q).find(x=>x.key==='customsIncluded').displayValue.includes('550'),true);
    assert.deepEqual(quoteV2Errors(q),[]);
    assert.deepEqual(clientValidate(q),[]);
    assert.deepEqual(serverValidate({...q,total:17595}),[]);
  }
});
test('USA extras remain separately chargeable without entering crypto transfer base',()=>{
 const q=sample('США');
 Object.assign(q,{auction:500,inland:800,repair:200,partsCost:100});
 assert.equal(quoteV2Total(q),19195);
 assert.equal(quoteV2Amounts(q).cryptoFee,595);
 assert.equal(modesV2('США')[0],'Самовывоз — Минеральные Воды');
 assert.equal(modesV2('Грузия')[0],'Самовывоз — Владикавказ');
});
test('only the 4% marked up calculation rate applies to ruble conversion',()=>{
 const q=sample();
 assert.equal(quoteV2Rate(q).cbrRubRate,100);
 assert.equal(quoteV2Rate(q).spreadPercent,4);
 q.cbrRubRate=0;assert.ok(quoteV2Errors(q).length);
 q.cbrRubRate=100;q.usdRubRate=100;
 assert.ok(quoteV2Errors(q).some(x=>x.includes('4%')));
});
test('new editor includes power, CC, source hint and single informational Russian customs field',()=>{
 for(const origin of ['США','Грузия']){
  const q={...sample(origin),status:'Черновик',sourceTurnkeyDeliveryRub:700000};
  const html=quoteV2Form(q,[{id:'L-1',name:'Client',model:'Camry',status:'Расчёт'}],['Черновик','Отправлен'],String);
  for(const field of ['engineCc','powerHp','customsAndRecyclingRub','cbrRubRate','turnkeyDeliveryUsd'])assert.match(html,new RegExp('name="'+field+'"'));
  for(const removed of ['name="legalization"','name="service"','name="recyclingRub"'])assert.equal(html.includes(removed),false);
  assert.ok(html.includes('700'));
  assert.ok(html.includes(origin==='США'?'Самовывоз — Минеральные Воды':'Самовывоз — Владикавказ'));
 }
});
test('snapshot contains numeric engine and source turnkey difference for exact catalog lead',()=>{
 const car={id:'AWG-123',engine:'2.5 Hybrid',engineCc:2487,powerHp:178,
   priceRub:1600000,russiaTurnkeyRub:2300000,turnkeyDeliveryRub:700000,
   customsRub:310000,discountExplicit:false};
 const saved=catalogVehicleSnapshot(car);
 assert.equal(saved.engineCc,2487);
 assert.equal(saved.powerHp,178);
 assert.equal(saved.turnkeyDeliveryRub,700000);
 assert.equal(catalogCustomsFacts(saved,'2026-10-23').engineCc,2487);
 assert.equal(catalogCustomsFacts(saved,'2026-10-23').powerHp,178);
 const html=renderCatalogLeadVehicle({carId:car.id,catalogVehicle:saved});
 assert.ok(html.includes('2487'));
 assert.ok(html.includes('178'));
 assert.ok(html.includes('700000'));
 assert.ok(!html.includes('До скидки'));
});
test('catalog scraper Python remains syntactically valid',()=>{
 execFileSync('python3',['-m','py_compile','scripts/scrape-autoworld-georgia.py'],{stdio:'pipe'});
});
