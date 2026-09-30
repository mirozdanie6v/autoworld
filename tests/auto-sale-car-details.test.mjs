import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const details=fs.readFileSync(new URL('../public/auto-sale-car-details.mjs',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/auto-sale-car-details.css',import.meta.url),'utf8');

test('car detail module has no static demo vehicle registry',()=>{
  for(const token of ['bmw-x5-22','tesla-y-23','rav4-22','cadillac-xt5-22'])assert.doesNotMatch(details,new RegExp(token));
  assert.doesNotMatch(details,/const carDetails=\[/);
  assert.doesNotMatch(details,/пример автомобиля/);
});

test('managed catalog cars still receive useful detail fields',()=>{
  for(const field of ["body:'Автомобиль из каталога'","power:'—'","highlights:[]","safety:[]","bestFor:"])assert.ok(details.includes(field),field);
  assert.match(details,/const currentCar=id=>/);
  assert.match(details,/if\(!managed\)return null/);
});

test('car photo and detail button types open the unified modal',()=>{
  assert.match(details,/\.auto-car \.auto-car-media/);
  assert.match(details,/\[data-detail\],\[data-extra-detail\]/);
  assert.match(details,/data-car-photo-detail/);
  assert.match(details,/data-car-detail-bg/);
});

test('rich details are keyboard accessible and responsive assets are loaded',()=>{
  assert.match(details,/\['Enter',' '\]/);
  assert.match(details,/role','button'/);
  assert.match(index,/auto-sale-car-details\.css/);
  assert.match(index,/auto-sale-car-details\.mjs/);
  assert.match(css,/@media\(max-width:760px\)/);
});

test('client popup uses a swipeable photo slider with arrows and thumbnails',()=>{
  for(const token of ['data-car-slider','data-car-slide-prev','data-car-slide-next','data-car-slide-thumb','touchstart','touchend','setSliderIndex'])assert.ok(details.includes(token),token);
  assert.match(css,/auto-car-slider-track/);
  assert.match(css,/touch-action:pan-y/);
});

test('vehicle popup exposes auction date as a dedicated field',()=>{
  assert.match(details,/spec\('Аукцион',car\.auction\)/);
  assert.match(details,/spec\(ended\?'Аукцион завершён':'Дата аукциона',auctionDateText\(car\)\)/);
  assert.match(details,/detailHighlights/);
});

test('vehicle popup shows origin and uses source-neutral verification copy',()=>{
  assert.match(details,/spec\('Локация автомобиля',car\.origin\|\|'Уточняется'\)/);
  assert.match(details,/по VIN и данным источника до покупки/);
});


test('car detail popup supports before and after discount price markup',()=>{
  assert.match(details,/detailOldPriceRub/);
  assert.match(details,/auto-detail-price-old/);
  assert.match(details,/auto-detail-price-current/);
  assert.match(details,/цена со скидкой/);
  assert.match(css,/auto-detail-price-old/);
});
