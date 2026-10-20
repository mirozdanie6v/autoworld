import test from 'node:test';
import assert from 'node:assert/strict';
import {awgTariff,awgCryptoFee,awgPackageUsd,awgPendingItems,AWG_TARIFF_VERSION} from '../public/auto-sale-tariffs.mjs';
import {calculateQuote,quoteCost} from '../public/auto-sale-core.mjs';
import {validateQuote} from '../public/auto-sale-business-rules.mjs';
import {validateQuote as serverValidateQuote} from '../server/auto-sale-rules.mjs';

for(const [origin,age,total,delivery] of [
 ['Грузия','3to5',5000,0],
 ['Грузия','under3',5000,0],
 ['США','3to5',5000,3350],
 ['США','under3',6500,3350]
]){
  test('AWG tariff '+origin+' '+age+' service included, not double charged',()=>{
    const preset=awgTariff(origin,age);
    assert.equal(preset.tariffVersion,AWG_TARIFF_VERSION);
    assert.equal(preset.service,500);
    assert.equal(awgPackageUsd(preset),total);
    assert.equal(preset.ocean,delivery);
    assert.equal(calculateQuote({lot:12000,...preset}),12000+total+delivery);
    assert.equal(quoteCost({lot:12000,...preset}),12000+total+delivery-500);
  });
}

test('US crypto fee 3.5% of preliminary explicit base',()=>{
  assert.equal(awgCryptoFee({origin:'США',lot:10000,auction:800,inland:400}),392);
  assert.equal(awgCryptoFee({origin:'Грузия',lot:10000,auction:800,inland:400}),0);
});
test('unconfirmed customs, recycling, repair, crypto cannot be sent as final quote',()=>{
  const quote={tariffVersion:AWG_TARIFF_VERSION,ageCategory:'3to5',origin:'США'};
  assert.equal(awgPendingItems(quote).length,4);
  assert.deepEqual(awgPendingItems({...quote,customsConfirmed:true,recyclingConfirmed:true,repairReviewed:true,cryptoBaseConfirmed:true}),[]);
});
test('both client and server total include all new fee components',()=>{
 const quote={leadId:'L-1',model:'BMW',origin:'США',status:'Отправлен',tariffVersion:AWG_TARIFF_VERSION,
 ageCategory:'3to5',lot:12000,auction:800,inland:400,ocean:3350,georgiaDelivery:0,
 customs:4200,recyclingFee:800,legalization:4500,service:500,repair:1500,partsCost:200,cryptoFee:392,
 customsConfirmed:true,recyclingConfirmed:true,repairReviewed:true,cryptoBaseConfirmed:true,validUntil:'2026-11-01'};
 quote.total=calculateQuote(quote);
 assert.equal(quote.total,28642);
 assert.deepEqual(validateQuote(quote),[]);
 assert.deepEqual(serverValidateQuote(quote),[]);
});
