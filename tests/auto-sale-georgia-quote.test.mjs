import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AWG_GEORGIA_TARIFF_VERSION,AWG_GEORGIA_QUOTE_SCHEMA,GEORGIA_MODES,georgiaTransferFee,georgiaQuoteAmounts,georgiaQuoteErrors,georgiaQuoteForm} from '../public/auto-sale-georgia-quote.mjs';
import {awgTariff,AWG_TARIFF_VERSION} from '../public/auto-sale-tariffs.mjs';
import {calculateQuote} from '../public/auto-sale-core.mjs';
import {quoteCostRows,quoteRowsTotal} from '../public/auto-sale-quote-audit.mjs';
import {validateQuote} from '../public/auto-sale-business-rules.mjs';
import {validateQuote as serverValidateQuote} from '../server/auto-sale-rules.mjs';
import {seedLeads,seedQuotes,seedOrders,seedTeam} from './fixtures/auto-sale-business.mjs';

const valid=age=>{
 const fields={origin:'Грузия',tariffVersion:AWG_GEORGIA_TARIFF_VERSION,quoteSchema:AWG_GEORGIA_QUOTE_SCHEMA,
  leadId:'L-GEO',model:'Toyota Camry',status:'Отправлен',ageCategory:age,transportMode:GEORGIA_MODES[0],
  lot:15000,legalization:4000,service:1000,internationalTransferPercent:3.5,
  customsRub:420000,recyclingRub:100000,usdRubRate:100,exchangeRateDate:'2026-10-21',comment:'Владик'};
 const q={...fields,...georgiaQuoteAmounts(fields)};
 q.total=calculateQuote(q);
 return q;
};
for(const age of ['under3','3to5']){
 test('new Georgia '+age+' has $4000 legalization + $1000 service and amount matches both validators',()=>{
  const tariff=awgTariff('Грузия',age);
  assert.equal(tariff.tariffVersion,AWG_GEORGIA_TARIFF_VERSION);
  assert.equal(tariff.legalization,4000);assert.equal(tariff.service,1000);
  const q=valid(age);
  assert.equal(q.customs,4200);assert.equal(q.recyclingFee,1000);
  assert.equal(q.cryptoFee,525);assert.equal(q.total,25725);
  assert.equal(quoteRowsTotal(q),q.total);
  assert.deepEqual(georgiaQuoteErrors(q),[]);
  assert.deepEqual(validateQuote(q),[]);
  assert.deepEqual(serverValidateQuote(q),[]);
  const rows=quoteCostRows(q);
  assert.equal(rows.length,6);
  assert.equal(rows.find(x=>x.key==='customs').displayValue.includes('₽'),true);
  assert.equal(rows.some(x=>['ocean','repair','inland','partsCost','georgiaDelivery'].includes(x.key)),false);
 });
}
test('USA 3–5 and under3 tariffs are not changed',()=>{
 for(const [age,service,legal] of [['3to5',500,4500],['under3',500,6000]]){
  const tariff=awgTariff('США',age);
  assert.equal(tariff.tariffVersion,AWG_TARIFF_VERSION);
  assert.equal(tariff.service,service);
  assert.equal(tariff.legalization,legal);
  assert.equal(tariff.ocean,3350);
 }
});
test('Georgia percent is editable and correct even with decimals',()=>{
 assert.equal(georgiaTransferFee(15000,3.5),525);
 assert.equal(georgiaTransferFee(15000,5),750);
});
test('Georgia quote cannot be sent with missing exchange-rate evidence or customs and recycling amounts',()=>{
 const q=valid('3to5');
 q.usdRubRate=0;q.exchangeRateDate='';q.customsRub=0;q.recyclingRub=0;
 assert.ok(georgiaQuoteErrors(q).some(x=>x.includes('курс')));
 assert.ok(validateQuote(q).length>0);
 assert.ok(serverValidateQuote(q).length>0);
});
test('Georgia rejects hidden legacy fees rather than silently including them',()=>{
 const q=valid('3to5');q.ocean=300;
 assert.ok(validateQuote(q).some(x=>x.includes('ocean')));
 assert.ok(serverValidateQuote(q).some(x=>x.includes('ocean')));
});
test('Georgia editor has requested fields and not the removed old blocks',()=>{
 const q={...valid('3to5'),status:'Черновик'};
 const html=georgiaQuoteForm(q,[{id:'L-GEO',name:'Test',model:'Camry',status:'Расчёт'}],['Черновик','Отправлен'],x=>String(x),x=>'$'+x);
 for(const label of ['Самовывоз — Владикавказ','Доставка под ключ','Комментарий','Утильсбор РФ','Таможня РФ','Международный перевод','Дата курса'])assert.ok(html.includes(label),label);
 for(const old of ['Досье проверки автомобиля','Ссылка на лот / объявление','Фото до покупки','Действует до','Источник цены','Логистика по Грузии','Доставка из Грузии в Россию','Запчасти (США до 3 лет)','Ремонт / подготовка','Подтверждение предварительных расходов','Таможенная оценка и утильсбор'])assert.equal(html.includes(old),false,old);
});
const tick=()=>new Promise(r=>setTimeout(r,0));
test('manager creates Georgia quote after scenario switch, zero clears, save uses RUB+date',async()=>{
 const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://auto-sale.viiversion.com/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent});
 const leads=seedLeads();leads[0].origin='Грузия';leads[0].ageRange='3–5 лет';
 localStorage.setItem('auto-sale-leads-v2',JSON.stringify(leads));
 localStorage.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
 localStorage.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
 localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
 await import('../public/auto-sale-app-v3.mjs?georgia-ui='+Date.now());
 const root=document.querySelector('#app');
 root.querySelector('[data-role="manager"]').click();
 root.querySelector('[data-go="quotes"]').click();
 root.querySelector('[data-new-quote]').click();
 let form=root.querySelector('#quoteForm');
 assert.ok(form);
 if(!form.dataset.georgiaQuote){
   form.elements.origin.value='Грузия';
   form.elements.origin.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
   form=root.querySelector('#quoteForm');
 }
 assert.equal(form.dataset.georgiaQuote,'true');
 assert.equal(form.elements.service.value,'1000');
 assert.equal(form.elements.legalization.value,'4000');
 form.elements.customsRub.dispatchEvent(new dom.window.Event('focusin',{bubbles:true}));
 assert.equal(form.elements.customsRub.value,'');
 form.elements.lot.value='15000';
 form.elements.customsRub.value='420000';
 form.elements.recyclingRub.value='100000';
 form.elements.usdRubRate.value='100';
 form.elements.exchangeRateDate.value='2026-10-21';
 form.elements.status.value='Отправлен';
 form.elements.lot.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.match(form.querySelector('#quoteTotal').textContent,/25,725/);
 form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await tick();await tick();
 const q=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(x=>x.tariffVersion===AWG_GEORGIA_TARIFF_VERSION);
 assert.ok(q,'new Georgian quote saved');
 assert.equal(q.status,'Отправлен');
 assert.equal(q.total,25725);
 assert.equal(q.customsRub,420000);
 assert.equal(q.exchangeRateDate,'2026-10-21');
 assert.equal(q.inland,0);
 assert.equal(q.ocean,0);
 dom.window.close();
});
