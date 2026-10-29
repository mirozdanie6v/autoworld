import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCatalogPriceSync} from '../scripts/prepare-awg-price-safe-import.mjs';

const digits='0123456789'.split('').map(n=>n+'️⃣');
const sticker=n=>{
  const s=(n/1_000_000).toFixed(2);
  return [...s].map(c=>c==='.'?'🤩':digits[Number(c)]).join('\n')+'\n🔤\n🔤\n🔤';
};
const post=(postId,vin,price,turnkey=0)=>({
  sourcePostId:String(postId),vin,
  sourceUrl:'https://t.me/AutoWorld_Georgia/'+postId,
  priceRub:price,
  rawText:'🌟\nBuick Encore 05/22г.\n✨\n'+sticker(price)+
    '\n🔹\nкомплектация\nSelect\nИстория автомобиля\n'+vin+
    (turnkey?'\nЦена в России под 🔧: '+(turnkey/1e6).toFixed(2)+' млн руб.':'')
});
const liveCar=(id,postId,vin,price,extra={})=>({
  id:'AWG-'+id,source:'AutoWorld_Georgia',sourcePostId:String(postId),
  sourceUrl:'https://t.me/AutoWorld_Georgia/'+postId,vin,priceRub:price,
  priceBeforeDiscountRub:0,priceAfterDiscountRub:0,russiaTurnkeyRub:0,
  catalogPriceEvidence:'channel_emoji',active:true,
  image:'https://storage.yandexcloud.net/example/photo.jpg',
  photos:['https://storage.yandexcloud.net/example/photo.jpg'],...extra
});
const encore='KL4CJASMXNB525640';
test('price reduction from a later post updates the EXISTING ID only, with no photo or VIN changes',()=>{
  const car=liveCar(4182,4182,encore,1380000,{active:false,managerNote:'keep this'});
  const incoming=post(4323,encore,1330000);
  const freshFull={id:'AWG-4323',source:'AutoWorld_Georgia',vin:encore,priceRub:1330000};
  const {items,report}=prepareCatalogPriceSync({source:[incoming],live:[car],normalized:[freshFull]});
  assert.equal(report.pricePatches,1);
  assert.equal(report.newCars,0);
  assert.equal(items.length,1);
  assert.equal(items[0].id,'AWG-4182');
  assert.equal(items[0].priceRub,1330000);
  assert.equal(items[0].sourceUrl,'https://t.me/AutoWorld_Georgia/4323');
  for(const field of ['sourcePostId','vin','active','photos','image','managerNote'])
    assert.equal(Object.hasOwn(items[0],field),false,field+' must never be changed');
});
test('three source sticker prices stay separate from Russia turnkey, even without scraped photos',()=>{
  const fixtures=[
    ['4202','JF2GUADC8RH222878',2150000,1980000,2150000],
    ['4192','JF2GUADC7R8267214',2150000,2020000,2150000],
    ['4212','KMHLP4DG3RU744930',2050000,1920000,2050000]
  ];
  const live=fixtures.map(([postId,vin,old])=>liveCar(postId,postId,vin,old));
  const source=fixtures.map(([id,vin,_,price,turnkey])=>post(id,vin,price,turnkey));
  const {items,report}=prepareCatalogPriceSync({source,live,normalized:[]});
  assert.equal(report.pricePatches,3);
  assert.equal(report.newCars,0);
  for(const [id,,old,price,turnkey] of fixtures){
    const x=items.find(x=>x.id==='AWG-'+id);
    assert.ok(x);
    assert.equal(x.priceRub,price);
    assert.equal(x.russiaTurnkeyRub,turnkey);
    assert.equal(x.turnkeyDeliveryRub,turnkey-price);
    assert.notEqual(old,price);
  }
});
test('never regress to a historical post or touch manager prices',()=>{
  const live=[liveCar(4182,4182,encore,1380000,{catalogPriceSourcePostId:'4323'}),
    liveCar(4000,4000,'KL77LGE22RC035835',1970000,{manualPriceOverride:true})];
  const source=[post(4090,encore,1430000),post(4100,'KL77LGE22RC035835',1930000)];
  const {items,report}=prepareCatalogPriceSync({source,live,normalized:[]});
  assert.deepEqual(items,[]);
  assert.equal(report.pricePatches,0);
  assert.ok(report.unresolved.some(x=>x.reason==='manager_price_override'));
});
test('reject mismatches between Python scraper amount and raw Telegram sticker',()=>{
  const source=[{...post(4323,encore,1330000),priceRub:1430000}];
  const {items,report}=prepareCatalogPriceSync({source,
    live:[liveCar(4182,4182,encore,1380000)],normalized:[]});
  assert.deepEqual(items,[]);
  assert.equal(report.unresolved[0].reason,'independent_price_parsers_disagree');
});
test('brand-new VIN is imported in full and existing VIN is never deleted',()=>{
  const newVin='KL77LGE22RC035835';
  const existing=liveCar(4182,4182,encore,1380000);
  const normalized=[
    {id:'AWG-4323',source:'AutoWorld_Georgia',vin:encore,priceRub:1330000},
    {id:'AWG-4450',source:'AutoWorld_Georgia',vin:newVin,priceRub:1950000}
  ];
  const {items,report}=prepareCatalogPriceSync({
    source:[post(4323,encore,1330000)],live:[existing],normalized
  });
  assert.equal(report.newCars,1);
  assert.equal(report.pricePatches,1);
  assert.equal(items.length,2);
  assert.deepEqual(items.map(x=>x.id).sort(),['AWG-4182','AWG-4450']);
});
test('already corrected price does not produce repetitive changes',()=>{
  const car=liveCar(4182,4182,encore,1330000,{
    catalogPriceSourcePostId:'4323',catalogPriceSourceUrl:'https://t.me/AutoWorld_Georgia/4323',
    sourceUrl:'https://t.me/AutoWorld_Georgia/4323'
  });
  const {items,report}=prepareCatalogPriceSync({source:[post(4323,encore,1330000)],live:[car],normalized:[]});
  assert.equal(report.pricePatches,0);
  assert.deepEqual(items,[]);
});
