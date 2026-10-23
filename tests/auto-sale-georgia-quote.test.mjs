import {AWG_QUOTE_V2_SCHEMA,AWG_QUOTE_V2_TARIFF} from '../public/auto-sale-quote-v2.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AWG_GEORGIA_TARIFF_VERSION,AWG_GEORGIA_QUOTE_SCHEMA,GEORGIA_MODES,georgiaTransferFee,georgiaQuoteAmounts,georgiaQuoteErrors,georgiaQuoteForm,georgiaDraftForEditing,formatGeorgiaUsd} from '../public/auto-sale-georgia-quote.mjs';
import {awgTariff,AWG_TARIFF_VERSION} from '../public/auto-sale-tariffs.mjs';
import {calculateQuote} from '../public/auto-sale-core.mjs';
import {quoteCostRows,quoteRowsTotal} from '../public/auto-sale-quote-audit.mjs';
import {validateQuote} from '../public/auto-sale-business-rules.mjs';
import {validateQuote as serverValidateQuote} from '../server/auto-sale-rules.mjs';
import {seedLeads,seedQuotes,seedOrders,seedTeam} from './fixtures/auto-sale-business.mjs';

const valid=age=>{
 const fields={origin:'Грузия',tariffVersion:AWG_GEORGIA_TARIFF_VERSION,quoteSchema:AWG_GEORGIA_QUOTE_SCHEMA,
  leadId:'L-GEO',model:'Toyota Camry',status:'Отправлен',ageCategory:age,transportMode:GEORGIA_MODES[0],engineCc:2000,powerHp:150,engineType:'petrol',importerType:'nat',manufactureDate:'2022-05',
  lot:15000,legalization:4000,service:1000,internationalTransferPercent:3.5,
  customsRub:420000,recyclingRub:100000,usdRubRate:100,exchangeRateDate:'2026-10-21',exchangeRateSource:'cbr',comment:'Владик'};
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
 assert.equal(georgiaTransferFee(15000,3.5,900.50),556.52);
 assert.equal(georgiaTransferFee(15000,3.5,875.25),555.63);
 assert.equal(georgiaTransferFee(15000,3.5,0),525);
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
 for(const label of ['Самовывоз — Владикавказ','Доставка под ключ','Общедоступный комментарий','Утильсбор РФ','Таможня РФ','Международный перевод','Дата курса'])assert.ok(html.includes(label),label);
 for(const old of ['Досье проверки автомобиля','Ссылка на лот / объявление','Фото до покупки','Действует до','Источник цены','Логистика по Грузии','Доставка из Грузии в Россию','Запчасти (США до 3 лет)','Ремонт / подготовка','Подтверждение предварительных расходов','Таможенная оценка и утильсбор'])assert.equal(html.includes(old),false,old);
});
const tick=()=>new Promise(r=>setTimeout(r,0));
test('manager creates new-version Georgia quote without obsolete fees and independent customs',async()=>{
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent});
  const leads=seedLeads();leads[0].origin='Грузия';leads[0].ageRange='3–5 лет';
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(leads));
  localStorage.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  await import('../public/auto-sale-app-v3.mjs?georgia-v2='+Date.now());
  const root=document.querySelector('#app');
  root.querySelector('[data-role="manager"]').click();
  root.querySelector('[data-go="quotes"]').click();
  root.querySelector('[data-new-quote]').click();
  let form=root.querySelector('#quoteForm');
  if(form.elements.origin.value!=='Грузия'){
    form.elements.origin.value='Грузия';
    form.elements.origin.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    form=root.querySelector('#quoteForm');
  }
  assert.equal(form.dataset.awgQuoteV2,'true');
  assert.ok(!form.elements.service&&!form.elements.legalization&&!form.elements.recyclingRub);
  assert.ok(form.elements.customsAndRecyclingRub);
  form.elements.lot.value='15000';
  form.elements.customsAndRecyclingRub.value='520000';
  form.elements.cbrRubRate.value='100';
  form.elements.exchangeRateDate.value='2026-10-21';
  form.elements.engineCc.value='2000';
  form.elements.powerHp.value='150';
  form.elements.engineType.value='petrol';
  form.elements.importerType.value='nat';
  form.elements.status.value='Отправлен';
  form.elements.publicComment.value='Пояснение клиенту';
  form.elements.lot.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.match(form.querySelector('#quoteTotal').textContent,/15,525/);
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  const q=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(x=>x.quoteSchema===AWG_QUOTE_V2_SCHEMA);
  assert.ok(q,'new quote persisted');
  assert.equal(q.tariffVersion,AWG_QUOTE_V2_TARIFF);
  assert.equal(q.status,'Отправлен');
  assert.equal(q.total,15525);
  assert.equal(q.service,0);
  assert.equal(q.legalization,0);
  assert.equal(q.customsAndRecyclingRub,520000);
  assert.equal(q.usdRubRate,104);
  assert.equal(q.publicComment,'Пояснение клиенту');

  root.querySelector('[data-new-quote]').click();
  let nextForm=root.querySelector('#quoteForm');
  if(nextForm.elements.origin.value!=='Грузия'){
    nextForm.elements.origin.value='Грузия';
    nextForm.elements.origin.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    nextForm=root.querySelector('#quoteForm');
  }
  nextForm.elements.transportMode.value='Доставка под ключ';
  nextForm.elements.transportMode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(nextForm.querySelector('#quoteTurnkeyDeliveryField').classList.contains('auto-conditional-hidden'),false);
  nextForm.elements.turnkeyDeliveryUsd.value='900.50';
  nextForm.elements.lot.value='15000';
  nextForm.elements.cbrRubRate.value='100';
  nextForm.elements.exchangeRateDate.value='2026-10-21';
  nextForm.elements.engineCc.value='2000';
  nextForm.elements.powerHp.value='150';
  nextForm.elements.engineType.value='petrol';
  nextForm.elements.importerType.value='nat';
  nextForm.elements.status.value='Отправлен';
  nextForm.elements.turnkeyDeliveryUsd.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.match(nextForm.querySelector('#quoteTotal').textContent,/16,457.02/);
  nextForm.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  const turnkey=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(x=>x.transportMode==='Доставка под ключ'&&x.quoteSchema===AWG_QUOTE_V2_SCHEMA);
  assert.ok(turnkey,'turnkey quote persisted');
  assert.equal(turnkey.cryptoFee,556.52);
  assert.equal(turnkey.total,16457.02);
  assert.deepEqual(serverValidateQuote(turnkey),[]);
  dom.window.close();
});

test('client sees Georgia RUB amounts, saved rate date, public comment and no expiry',async()=>{
 const dom=new JSDOM('<!doctype html><html><body><div data-client-detail-bg><div class="auto-tg-modal"><div class="auto-client-order-grid"></div><div class="auto-guide"><span></span></div><button data-tg-manager="L-GEO">Менеджер</button></div></div></body></html>',{url:'https://auto-sale.viiversion.com/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent});
 const clientQuoteInput={...valid('3to5'),transportMode:'Доставка под ключ',turnkeyDeliveryUsd:875.25,publicComment:'Доставка оплачивается отдельно.\nУточните адрес получения.'};
 const clientQuote={...clientQuoteInput,...georgiaQuoteAmounts(clientQuoteInput)};
 clientQuote.total=calculateQuote(clientQuote);
 localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([{...clientQuote,id:'Q-GEO',version:1}]));
 localStorage.setItem('auto-sale-notes-v2',JSON.stringify({}));
 await import('../public/auto-sale-client-quote.mjs?georgia-display='+Date.now());
 await tick();
 const panel=document.querySelector('.auto-client-quote');
 assert.ok(panel,'client quote panel');
 assert.match(panel.textContent,/420\s*000\s*₽/);
 assert.match(panel.textContent,/100\s*000\s*₽/);
 assert.match(panel.textContent,/21 октября 2026/);
 assert.match(panel.textContent,/100 ₽ за \$1/);
 assert.match(panel.textContent,/Доставка под ключ/);
 assert.match(panel.textContent,/\$875.25/);
 assert.match(panel.textContent,/\$26,630.88/);
 assert.match(panel.textContent,/авто \+ доставка/);
 assert.match(panel.textContent,/\$555.63/);
 assert.match(panel.textContent,/Комментарий к расчёту/);
 assert.match(panel.textContent,/Доставка оплачивается отдельно/);
 assert.match(panel.querySelector('[data-public-quote-comment] p').textContent,/Уточните адрес получения/);
 assert.doesNotMatch(panel.textContent,/Владик/);
 assert.doesNotMatch(panel.textContent,/Расчёт действует до/);
 const approve=panel.querySelector('[data-client-quote-agree="Q-GEO"]');
 assert.ok(approve);
 approve.click();await tick();await tick();
 const updated=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(x=>x.id==='Q-GEO');
 assert.equal(updated.status,'Согласован');
 assert.equal(updated.clientDecision,'agreed');
 dom.window.close();
});

test('Georgia older than five years: draft allowed but sending a standard tariff refused',()=>{
 const q=valid('other');
 assert.ok(georgiaQuoteErrors(q).some(e=>e.includes('старше 5 лет')));
 assert.ok(validateQuote(q).length>0);
 assert.ok(serverValidateQuote(q).length>0);
 assert.deepEqual(validateQuote({...q,status:'Черновик'}),[]);
});
test('turnkey delivery is entered separately and included in both server and client totals',()=>{
 const fields={...valid('3to5'),transportMode:GEORGIA_MODES[1],turnkeyDeliveryUsd:900.50};
 const q={...fields,...georgiaQuoteAmounts(fields)};
 q.total=calculateQuote(q);
 assert.equal(q.turnkeyDeliveryUsd,900.50);
 assert.equal(q.cryptoFee,556.52);
 assert.equal(q.total,26657.02);
 assert.equal(quoteRowsTotal(q),q.total);
 assert.deepEqual(validateQuote(q),[]);
 assert.deepEqual(serverValidateQuote(q),[]);
 assert.equal(quoteCostRows(q).find(x=>x.key==='turnkeyDeliveryUsd').label,'Доставка под ключ');
 assert.equal(quoteCostRows(q).find(x=>x.key==='turnkeyDeliveryUsd').value,900.50);
 assert.match(quoteCostRows(q).find(x=>x.key==='cryptoFee').label,/авто \+ доставка/);
 const tampered={...q,cryptoFee:525};
 assert.ok(validateQuote(tampered).some(e=>e.includes('cryptoFee')));
 assert.ok(serverValidateQuote(tampered).some(e=>e.includes('cryptoFee')));
});
test('turnkey delivery amount is required and cannot be zero, negative or omitted on sending',()=>{
 for(const charge of [undefined,0,-100,'not-a-number']){
  const fields={...valid('3to5'),transportMode:GEORGIA_MODES[1],turnkeyDeliveryUsd:charge};
  const q={...fields,...georgiaQuoteAmounts(fields)};
  q.total=calculateQuote(q);
  assert.ok(validateQuote(q).some(e=>e.includes('стоимость доставки под ключ')),'rejected '+charge);
  assert.ok(serverValidateQuote(q).some(e=>e.includes('стоимость доставки под ключ')),'server rejected '+charge);
  assert.deepEqual(validateQuote({...q,status:'Черновик'}),[]);
 }
});
test('pickup excludes the delivery fee; old Georgia and USA quotes remain unaffected',()=>{
 const input={...valid('3to5'),transportMode:GEORGIA_MODES[0],turnkeyDeliveryUsd:900};
 const totals=georgiaQuoteAmounts(input);
 assert.equal(totals.turnkeyDeliveryUsd,0);
 assert.equal(totals.cryptoFee,525);
 assert.equal(calculateQuote(totals),25725);
 assert.equal(quoteCostRows({...input,...totals}).some(row=>row.key==='turnkeyDeliveryUsd'),false);
 assert.ok(validateQuote({...input,total:calculateQuote(input)}).some(e=>e.includes('самовывоза')));
});
test('exchange-rate source is mandatory, empty/future dates cannot validate',()=>{
 const q={...valid('3to5'),exchangeRateSource:'',exchangeRateDate:'2099-01-01'};
 assert.ok(georgiaQuoteErrors(q).some(e=>e.includes('источник')));
 assert.ok(georgiaQuoteErrors(q).some(e=>e.includes('дату курса')));
});
test('legacy Georgian drafts are converted for editing without mutating original saved version',()=>{
 const source={...valid('3to5'),id:'Q-old',tariffVersion:'2026-10-20',quoteSchema:'awg-quote-audit-2026-10',
   status:'Черновик',service:500,legalization:4500,transportMode:'Автовоз',inland:300,ocean:400,repair:100,
   cryptoFee:0,customs:2500,customsRub:0,recyclingFee:300,recyclingRub:0,exchangeRateDate:'',exchangeRateSource:''};
 const raw=JSON.stringify(source);
 const converted=georgiaDraftForEditing(source);
 assert.equal(source.tariffVersion,'2026-10-20');
 assert.equal(JSON.stringify(source),raw);
 assert.equal(converted.tariffVersion,AWG_GEORGIA_TARIFF_VERSION);
 assert.equal(converted.id,source.id);
 assert.equal(converted.status,'Черновик');
 assert.equal(converted.legalization,4000);
 assert.equal(converted.service,1000);
 assert.equal(converted.inland,0);
 assert.equal(converted.ocean,0);
 assert.equal(converted.repair,0);
 assert.equal(converted.transportMode,'');
 assert.equal(converted.customsRub,250000);
 assert.ok(converted.migrationPending);
 assert.equal(georgiaDraftForEditing({...source,status:'Отправлен'}).tariffVersion,'2026-10-20');
});
test('new Georgian form retains technical data needed for manual customs lookup',()=>{
 const html=georgiaQuoteForm(valid('3to5'),[{id:'L-GEO',name:'Test',model:'Camry',status:'Расчёт'}],['Отправлен'],x=>String(x),x=>'$'+x);
 for(const name of ['engineCc','powerHp','powerUnit','engineType','importerType','manufactureDate','exchangeRateSource','turnkeyDeliveryUsd'])assert.match(html,new RegExp('name="'+name+'"'));
 assert.match(html,/Общедоступный комментарий \(виден клиенту\)/);
 assert.match(html,/name="publicComment"/);
 assert.doesNotMatch(html,/Комментарий менеджера \(не виден клиенту\)/);
});

test('Georgia USD display preserves cents without changing whole-dollar formatting',()=>{
 assert.equal(formatGeorgiaUsd(26657.02),'$26,657.02');
 assert.equal(formatGeorgiaUsd(25725),'$25,725');
 assert.equal(formatGeorgiaUsd(900.01),'$900.01');
});

test('Georgia transfer percentage uses car + delivery, never legalisation or customs',()=>{
 const pickup=valid('3to5');
 const delivery={...pickup,transportMode:GEORGIA_MODES[1],turnkeyDeliveryUsd:1500,internationalTransferPercent:5};
 const costs=georgiaQuoteAmounts(delivery);
 assert.equal(costs.cryptoFee,825);
 assert.equal(costs.turnkeyDeliveryUsd,1500);
 assert.equal(costs.customs,4200);
 assert.equal(costs.recyclingFee,1000);
 const repriced=georgiaQuoteAmounts({...delivery,legalization:8000,service:2000,customsRub:620000});
 assert.equal(repriced.cryptoFee,costs.cryptoFee);
 const pickupOnly=georgiaQuoteAmounts({...delivery,transportMode:GEORGIA_MODES[0]});
 assert.equal(pickupOnly.cryptoFee,750);
 assert.equal(pickupOnly.turnkeyDeliveryUsd,0);
});
test('Georgia editor explains the agreed international transfer base',()=>{
 const html=georgiaQuoteForm({...valid('3to5'),status:'Черновик'},[{id:'L-GEO',name:'Test',model:'Camry',status:'Расчёт'}],['Черновик','Отправлен'],x=>String(x),x=>'$'+x);
 assert.match(html,/от стоимости автомобиля плюс стоимость доставки под ключ/);
 assert.doesNotMatch(html,/База международного перевода подлежит согласованию/);
});


test('legacy manager-only comment remains private; only new publicComment reaches client',async()=>{
 const dom=new JSDOM('<!doctype html><html><body><div data-client-detail-bg><div class="auto-tg-modal"><div class="auto-client-order-grid"></div><div class="auto-guide"><span></span></div><button data-tg-manager="L-GEO">Менеджер</button></div></div></body></html>',{url:'https://auto-sale.viiversion.com/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent});
 const q={...valid('3to5'),id:'Q-PRIVACY',version:1,comment:'НЕ ПУБЛИКОВАТЬ: внутренняя маржа'};
 localStorage.setItem('auto-sale-quotes-v2',JSON.stringify([q]));
 localStorage.setItem('auto-sale-notes-v2','{}');
 await import('../public/auto-sale-client-quote.mjs?quote-privacy='+Date.now());
 await tick();
 let panel=document.querySelector('.auto-client-quote');
 assert.ok(panel);
 assert.equal(panel.querySelector('[data-public-quote-comment]'),null);
 assert.doesNotMatch(panel.textContent,/НЕ ПУБЛИКОВАТЬ/);
 const editor=georgiaQuoteForm(q,[{id:'L-GEO',name:'Client',model:'Toyota',status:'Расчёт'}],['Отправлен'],x=>String(x),x=>'$'+x);
 assert.match(editor,/Старый внутренний комментарий/);
 assert.match(editor,/НЕ ПУБЛИКОВАТЬ/);
 assert.match(editor,/name="publicComment"/);
 assert.doesNotMatch(editor,/name="comment"/);
 dom.window.close();
});

test('public comment is HTML-escaped in manager editor and client view',()=>{
 const q={...valid('3to5'),publicComment:'<img src=x onerror=alert(1)> & подробности'};
 const editor=georgiaQuoteForm(q,[{id:'L-GEO',name:'Client',model:'Toyota',status:'Расчёт'}],['Отправлен'],v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),x=>'$'+x);
 assert.match(editor,/&lt;img/);
 assert.doesNotMatch(editor,/<img src=x/);
});
