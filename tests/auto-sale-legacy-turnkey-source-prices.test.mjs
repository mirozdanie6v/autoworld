import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractLegacyTurnkeySource} from '../scripts/catalog-legacy-turnkey.mjs';
import {extractSourcePrices} from '../scripts/catalog-source-price.mjs';
import {catalogPriceRub,catalogVehicleSnapshot,renderCatalogLeadVehicle} from '../public/auto-sale-catalog-lead.mjs';

const archive=JSON.parse(readFileSync(new URL('../data/autoworld-georgia/cars.json',import.meta.url),'utf8'));
const posts=new Map(archive.map(x=>[String(x.sourcePostId),x]));
const expected={
  '1363':[3840000,0],'1303':[4620000,0],'1090':[1920000,2230000],
  '1080':[3500000,3900000],'1070':[2100000,0],'1059':[2080000,0],
  '1052':[2180000,0],'1042':[2750000,3160000],
  '1032':[3690000,4100000],'1012':[1900000,2390000],
  '989':[1850000,2380000],'979':[1990000,2490000],
  '864':[3700000,0],'854':[4380000,4900000],
  '834':[5900000,0],'824':[2790000,3100000],
  '814':[3577000,4588000],'803':[3309000,4125000]
};

test('all 18 archived Russia-with-repair listings retain actual typed pricing',()=>{
  for(const [id,[min,max]] of Object.entries(expected)){
    const p=posts.get(id);
    assert.ok(p?.rawText,'source archived '+id);
    const price=extractSourcePrices(p.rawText);
    assert.equal(price.priceRub,0,'do not invent a purchase price '+id);
    assert.equal(price.russiaTurnkeyRub,min,'turnkey min '+id);
    assert.equal(price.russiaTurnkeyMaxRub,max,'turnkey max '+id);
    assert.equal(price.priceEvidence,'russia_turnkey_only');
    assert.equal(price.turnkeyDeliveryRub,0,'cannot subtract from unknown purchase price '+id);
  }
});

test('dual-route comparisons preserve country-specific prices rather than a false generic car price',()=>{
  for(const [id,us,georgia] of [['814',3577000,4588000],['803',3309000,4125000]]){
    const price=extractLegacyTurnkeySource(posts.get(id).rawText);
    assert.equal(price.kind,'route_comparison');
    assert.equal(price.usaRub,us);
    assert.equal(price.georgiaRub,georgia);
  }
});

test('do not treat generic RUB prices, engine numbers or date headers as a verified turnkey quote',()=>{
  assert.equal(extractLegacyTurnkeySource('BMW X5 2024\nТаможня 2,5 млн\nЦена ЦБ 85 руб'),null);
  assert.equal(extractLegacyTurnkeySource('Цена в России под 🔧 : 2,9 - 2,1 млн'),null,'reverse range unsafe');
  assert.equal(extractLegacyTurnkeySource('Пример расчёта США/Грузия\nЦена 3 млн'),null);
  assert.equal(extractSourcePrices('Toyota 2022\n✨\n2️⃣\n🤩\n0️⃣\n8️⃣\n🔤\n🔤\n🔤\nЦена в России под 🔧: 2,4 млн').priceRub,2080000,'primary sticker remains primary');
});

test('catalog shows source turnkey reference as fallback but snapshots preserve its original basis',()=>{
  const car={id:'AWG-814',sourcePostId:'814',source:'AutoWorld_Georgia',
    priceRub:0,russiaTurnkeyRub:3577000,russiaTurnkeyMaxRub:4588000,
    russiaTurnkeyKind:'route_comparison',usaTurnkeyRub:3577000,georgiaTurnkeyRub:4588000};
  assert.equal(catalogPriceRub(car),3577000);
  const snap=catalogVehicleSnapshot(car);
  assert.equal(snap.priceRub,0);
  assert.equal(snap.russiaTurnkeyRub,3577000);
  assert.equal(snap.russiaTurnkeyMaxRub,4588000);
  assert.equal(snap.usaTurnkeyRub,3577000);
  assert.equal(snap.georgiaTurnkeyRub,4588000);
});

test('manager lead shows verified turnkey price without inventing a purchase price',()=>{
  const latest={id:'AWG-1363',source:'AutoWorld_Georgia',sourcePostId:'1363',
    brand:'Range Rover',model:'Evoque',year:2023,price:0,priceRub:0,
    russiaTurnkeyRub:3840000,russiaTurnkeyKind:'turnkey_single'};
  const old=structuredClone(latest);
  old.russiaTurnkeyRub=0;
  const lead={carId:old.id,origin:'США',estimatedCostRub:0,catalogVehicle:catalogVehicleSnapshot(old)};
  const html=renderCatalogLeadVehicle(lead,{escape:String,rubMoney:value=>value+' ₽',currentCatalogCar:latest});
  assert.match(html,/Расчёт в России с ремонтом \(источник\)/);
  assert.match(html,/3840000 ₽/);
  assert.doesNotMatch(html,/уточняется/);
  assert.doesNotMatch(html,/Стоимость из карточки/);
  assert.equal((html.match(/Расчёт в России с ремонтом \(источник\)/g)||[]).length,1);
  assert.equal(lead.catalogVehicle.russiaTurnkeyRub,0,'backfill does not rewrite historical snapshots');
  assert.equal(lead.catalogVehicle.priceRub,0,'turnkey is never misrepresented as purchase price');
});
test('supplement a stale lead only from exact same public source car and post',()=>{
  const original={id:'AWG-1363',source:'AutoWorld_Georgia',sourcePostId:'1363',priceRub:0,price:0};
  const lead={carId:original.id,catalogVehicle:catalogVehicleSnapshot(original)};
  const unrelated={...original,sourcePostId:'1303',russiaTurnkeyRub:9990000};
  const html=renderCatalogLeadVehicle(lead,{currentCatalogCar:unrelated});
  assert.doesNotMatch(html,/9990000/);
  assert.match(html,/уточняется/);
});
test('compare route prices without duplicating turnkey headline or hiding valid base',()=>{
  const legacy={id:'AWG-814',source:'AutoWorld_Georgia',sourcePostId:'814',
    priceRub:0,russiaTurnkeyRub:3577000,russiaTurnkeyMaxRub:4588000,
    russiaTurnkeyKind:'route_comparison',usaTurnkeyRub:3577000,georgiaTurnkeyRub:4588000};
  const lead={carId:legacy.id,catalogVehicle:catalogVehicleSnapshot(legacy)};
  const html=renderCatalogLeadVehicle(lead,{rubMoney:v=>v+' ₽'});
  assert.match(html,/от 3577000 ₽/);
  assert.match(html,/Оценка через США/);
  assert.match(html,/Оценка через Грузию/);
  assert.equal((html.match(/Расчёт в России с ремонтом \(источник\)/g)||[]).length,1);
  const priced={...legacy,priceRub:1800000};
  const html2=renderCatalogLeadVehicle({carId:priced.id,catalogVehicle:catalogVehicleSnapshot(priced)},{rubMoney:v=>v+' ₽'});
  assert.match(html2,/Стоимость из карточки/);
  assert.match(html2,/1800000 ₽/);
  assert.match(html2,/Цена в России с ремонтом \(источник\)/);
});
