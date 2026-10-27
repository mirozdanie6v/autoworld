import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';

const fixture=[
  {id:'AWG-1363',brand:'Range Rover',model:'Evoque',origin:'США',year:2023,price:0,priceRub:0,
   sourcePostId:'1363',source:'AutoWorld_Georgia',russiaTurnkeyRub:3840000,russiaTurnkeyKind:'russia_with_repair',auction:'COPART'},
  {id:'AWG-1090',brand:'Chevrolet',model:'Trailblazer',origin:'США',year:2025,price:0,priceRub:0,
   sourcePostId:'1090',source:'AutoWorld_Georgia',russiaTurnkeyRub:1920000,russiaTurnkeyMaxRub:2230000,russiaTurnkeyKind:'russia_with_repair',auction:'COPART'},
  {id:'AWG-PAID',brand:'BMW',model:'X5',origin:'Грузия',year:2024,price:0,priceRub:3500000,
   russiaTurnkeyRub:4600000,auction:'Склад Грузия'},
  {id:'AWG-BID',brand:'Audi',model:'A4',origin:'США',year:2024,price:0,priceRub:0,estimatedBidUsd:8900,auction:'COPART'}
];

test('detail modal renders source-verified turnkey amount without inventing a base listing price',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',{url:'https://awgcars.ru'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,MutationObserver:dom.window.MutationObserver});
  localStorage.setItem('auto-sale-catalog-v1',JSON.stringify(fixture));
  await import('../public/auto-sale-car-details.mjs?catalog-turnkey-detail-v1');
  const open=id=>{window.__AUTO_SALE_CAR_DETAILS__.open(id);return document.querySelector('.auto-detail-price-line');};
  let line=open('AWG-1363');
  assert.ok(line,'source car detail visible');
  assert.match(line.textContent,/3\s?840\s?000\s?₽/u);
  assert.match(line.textContent,/цена в России с ремонтом \(источник\)/u);
  assert.doesNotMatch(line.textContent,/по расчёту/u);
  line=open('AWG-1090');
  assert.match(line.textContent,/от 1\s?920\s?000\s?₽/u);
  assert.match(line.textContent,/цена в России с ремонтом/u);
  line=open('AWG-PAID');
  assert.match(line.textContent,/3\s?500\s?000\s?₽/u);
  assert.doesNotMatch(line.textContent,/4\s?600\s?000\s?₽/u,'turnkey must not replace a positive base source price');
  line=open('AWG-BID');
  assert.match(line.textContent,/ставка ≈ \$8,900/u);
  dom.window.close();
});

test('index invalidates cached Mini App detail view script for Telegram and VK',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(html.includes('auto-sale-car-details.mjs?v=20261027-source-turnkey-detail-v1'));
});
