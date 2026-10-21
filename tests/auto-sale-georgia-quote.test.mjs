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
 assert.ok(form.elements.engineCc);
 assert.ok(form.elements.powerHp);
 assert.equal(form.elements.legalization.value,'4000');
 form.elements.customsRub.dispatchEvent(new dom.window.Event('focusin',{bubbles:true}));
 assert.equal(form.elements.customsRub.value,'');
 form.elements.lot.value='15000';
 form.elements.customsRub.value='420000';
 form.elements.recyclingRub.value='100000';
 form.elements.usdRubRate.value='100';
 form.elements.exchangeRateSource.value='cbr';
 form.elements.engineCc.value='2000';form.elements.powerHp.value='150';
 form.elements.engineType.value='petrol';form.elements.importerType.value='nat';
 form.elements.exchangeRateDate.value='2026-10-21';
 form.elements.status.value='Отправлен';
 form.elements.lot.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.match(form.querySelector('#quoteTotal').textContent,/25,725/);
 assert.equal(form.querySelector('#quoteTurnkeyDeliveryField').classList.contains('auto-conditional-hidden'),true);
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
 assert.equal(q.turnkeyDeliveryUsd,0);

 root.querySelector('[data-new-quote]').click();
 let nextForm=root.querySelector('#quoteForm');
 if(nextForm.dataset.georgiaQuote!=='true'){
  nextForm.elements.origin.value='Грузия';
  nextForm.elements.origin.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  nextForm=root.querySelector('#quoteForm');
 }
 assert.equal(nextForm.dataset.georgiaQuote,'true');
 nextForm.elements.transportMode.value='Доставка под ключ';
 nextForm.elements.transportMode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.equal(nextForm.querySelector('#quoteTurnkeyDeliveryField').classList.contains('auto-conditional-hidden'),false);
 nextForm.elements.turnkeyDeliveryUsd.value='900.50';
 nextForm.elements.lot.value='15000';
 nextForm.elements.customsRub.value='420000';
 nextForm.elements.recyclingRub.value='100000';
 nextForm.elements.usdRubRate.value='100';
 nextForm.elements.exchangeRateDate.value='2026-10-21';
 nextForm.elements.exchangeRateSource.value='cbr';
 nextForm.elements.engineCc.value='2000';
 nextForm.elements.powerHp.value='150';
 nextForm.elements.engineType.value='petrol';
 nextForm.elements.importerType.value='nat';
 nextForm.elements.status.value='Отправлен';
 nextForm.elements.turnkeyDeliveryUsd.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(nextForm.querySelector('#quoteTotal').textContent,'$26,625.50');
 nextForm.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await tick();await tick();
 const turnkey=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(x=>x.transportMode==='Доставка под ключ'&&x.tariffVersion===AWG_GEORGIA_TARIFF_VERSION);
 assert.ok(turnkey,'turnkey quote saved');
 assert.equal(turnkey.turnkeyDeliveryUsd,900.50);
 assert.equal(turnkey.total,26625.50);
 assert.deepEqual(serverValidateQuote(turnkey),[]);
 assert.match(root.querySelector('.auto-quote-list').textContent,/\$900.50/);
 assert.match(root.querySelector('.auto-quote-list').textContent,/\$26,625.50/);
 dom.window.close();
});

test('client sees Georgia RUB amounts, saved rate date, comment and no expiry',async()=>{
 const dom=new JSDOM('<!doctype html><html><body><div data-client-detail-bg><div class="auto-tg-modal"><div class="auto-client-order-grid"></div><div class="auto-guide"><span></span></div><button data-tg-manager="L-GEO">Менеджер</button></div></div></body></html>',{url:'https://auto-sale.viiversion.com/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,MutationObserver:dom.window.MutationObserver,CustomEvent:dom.window.CustomEvent});
 const clientQuoteInput={...valid('3to5'),transportMode:'Доставка под ключ',turnkeyDeliveryUsd:875.25};
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
 assert.match(panel.textContent,/\$26,600.25/);
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
 assert.equal(q.total,26625.50);
 assert.equal(quoteRowsTotal(q),q.total);
 assert.deepEqual(validateQuote(q),[]);
 assert.deepEqual(serverValidateQuote(q),[]);
 assert.equal(quoteCostRows(q).find(x=>x.key==='turnkeyDeliveryUsd').label,'Доставка под ключ');
 assert.equal(quoteCostRows(q).find(x=>x.key==='turnkeyDeliveryUsd').value,900.50);
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
 assert.match(html,/не виден клиенту/);
});

test('Georgia USD display preserves cents without changing whole-dollar formatting',()=>{
 assert.equal(formatGeorgiaUsd(26625.5),'$26,625.50');
 assert.equal(formatGeorgiaUsd(25725),'$25,725');
 assert.equal(formatGeorgiaUsd(900.01),'$900.01');
});
