import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateQuote, quoteCost} from '../public/auto-sale-core.mjs';
import {validateQuote, validateClientRequest} from '../public/auto-sale-business-rules.mjs';

test('three new expense lines are counted exactly once',()=>{
  const original={lot:10000,auction:500,inland:700,ocean:1200,customs:800,repair:300,service:1000};
  const extra={georgiaDelivery:150,legalization:250,recyclingFee:400};
  assert.equal(calculateQuote(original),14500);
  assert.equal(quoteCost(original),13500);
  assert.equal(calculateQuote({...original,...extra}),15300);
  assert.equal(quoteCost({...original,...extra}),14300);
  assert.equal(calculateQuote({...original,...extra})-quoteCost({...original,...extra}),1000);
  assert.equal(calculateQuote({...original,georgiaDelivery:0,legalization:0,recyclingFee:0}),calculateQuote(original));
});

test('negative extra fees cannot be sent in a quote',()=>{
  const base={leadId:'L-1',model:'BMW',origin:'Грузия',status:'Отправлен',lot:10000,service:1000,validUntil:'2026-11-30'};
  assert.deepEqual(validateQuote({...base,georgiaDelivery:150,legalization:250,recyclingFee:400}),[]);
  for(const key of ['georgiaDelivery','legalization','recyclingFee']){
    assert.ok(validateQuote({...base,[key]:-1}).length>0,key);
  }
});

test('request can reference a catalog car without applying USD minimum',()=>{
  const car={name:'A',contact:'@a',model:'BMW X5',origin:'Грузия',carId:'CAR-1',estimatedCostRub:2400000,year:2021,mileage:'63 000 км',engine:'2.0',drive:'AWD'};
  assert.deepEqual(validateClientRequest(car),[]);
  assert.ok(validateClientRequest({...car,carId:'',ageRange:''}).length>0);
});
