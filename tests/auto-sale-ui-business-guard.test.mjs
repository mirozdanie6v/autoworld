import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {seedLeads,seedQuotes,seedOrders,seedTeam} from './fixtures/auto-sale-business.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function setup(tag,{custom=false,clientStatus='',orderDelivery=false}={}){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://auto-sale.viiversion.com/'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;globalThis.sessionStorage=dom.window.sessionStorage;globalThis.FormData=dom.window.FormData;globalThis.Event=dom.window.Event;globalThis.CustomEvent=dom.window.CustomEvent;globalThis.MutationObserver=dom.window.MutationObserver;globalThis.HTMLFormElement=dom.window.HTMLFormElement;
  const ls=dom.window.localStorage;
  ls.setItem('auto-sale-leads-v2',JSON.stringify(seedLeads()));
  ls.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));
  ls.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  ls.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  if(custom){
    const l=seedLeads();l.push({id:'L-999',name:'Guard Test',contact:'demo',model:'Audi Q5',budget:40000,source:'Сайт',manager:'Анна',status:'Ожидает клиента',priority:'Средний',createdAt:'2026-09-12T00:00:00Z',nextAction:'2026-09-13',note:'',deposit:0});
    const q=seedQuotes();q.push({id:'Q-999',leadId:'L-999',model:'Audi Q5',lot:25000,auction:1000,inland:800,ocean:2500,customs:6000,repair:1000,service:1500,total:37800,status:'Согласован',version:1,validUntil:'2026-09-20',updatedAt:'2026-09-12T00:00:00Z'});
    ls.setItem('auto-sale-leads-v2',JSON.stringify(l));ls.setItem('auto-sale-quotes-v2',JSON.stringify(q));ls.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()));
  }
  if(clientStatus){const l=seedLeads();l.push({id:'L-998',name:'Client Edit',contact:'@client_edit',model:'BMW X3',budget:39000,source:'Mini App',manager:'Дмитрий',status:clientStatus,priority:'Средний',createdAt:'2026-09-12T00:00:00Z',nextAction:'2026-09-13',note:'Первичная заявка',clientCreated:true,yearFrom:'2021',yearTo:'2024',mileageMax:'60000',deliveryCity:'Москва'});ls.setItem('auto-sale-leads-v2',JSON.stringify(l));ls.setItem('auto-sale-quotes-v2',JSON.stringify(seedQuotes()));ls.setItem('auto-sale-orders-v2',JSON.stringify(seedOrders()))}
  if(orderDelivery){const o=seedOrders().map(x=>x.id==='O-2303'?{...x,stage:'Доставка',paid:40000,payments:[{id:'PAY-1',amount:40000,date:'2026-09-10',method:'Банк',note:'Оплачено'}],risk:'Нет',riskType:'Нет',riskNote:''}:x);ls.setItem('auto-sale-orders-v2',JSON.stringify(o))}
  await import(`../public/auto-sale-app-v3.mjs?guard-app=${tag}-${Date.now()}-${Math.random()}`);
  if(clientStatus)await import(`../public/auto-sale-telegram.mjs?guard-tg=${tag}-${Date.now()}-${Math.random()}`);
  await import(`../public/auto-sale-ui-business-guard.mjs?guard=${tag}-${Date.now()}-${Math.random()}`);
  await import(`../public/auto-sale-quote-save-fix.mjs?quote-save=${tag}-${Date.now()}-${Math.random()}`);
  await import(`../public/auto-sale-lead-status-fix.mjs?lead-status=${tag}-${Date.now()}-${Math.random()}`);
  await tick();
  return{dom,root:document.querySelector('#app')};
}

test('existing quote keeps its original lead locked and included in form data',async()=>{
  const {dom,root}=await setup('quote-lock');root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="quotes"]').click();root.querySelector('[data-quote="Q-501"]').click();await tick();
  const form=root.querySelector('#quoteForm'),select=form.querySelector('select[name="leadId"]'),hidden=form.querySelector('input[type="hidden"][name="leadId"]');assert.equal(select.disabled,false);assert.equal(select.dataset.lockedValue,'L-101');assert.equal(hidden,null);assert.equal(Object.fromEntries(new dom.window.FormData(form).entries()).leadId,'L-101');assert.match(form.textContent,/зафиксирован для этой версии расчёта/i);assert.match(form.textContent,/Что дальше/i);dom.window.close();
});

test('save quote button persists an edited existing quote',async()=>{
  const {dom,root}=await setup('quote-save-button');root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="quotes"]').click();root.querySelector('[data-quote="Q-501"]').click();await tick();
  const form=root.querySelector('#quoteForm');assert.ok(form);form.elements.model.value='BMW X5 xDrive40i 2022 TEST';const button=form.querySelector('button[type="submit"]');assert.ok(button);button.click();await tick();
  const quote=JSON.parse(localStorage.getItem('auto-sale-quotes-v2')).find(x=>x.id==='Q-501');assert.equal(quote.model,'BMW X5 xDrive40i 2022 TEST');assert.equal(root.querySelector('#quoteForm'),null);assert.match(root.textContent,/Расчёты/i);dom.window.close();
});

test('new quote excludes new deal and refused leads',async()=>{
  const {dom,root}=await setup('quote-new');root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="quotes"]').click();root.querySelector('[data-new-quote]').click();await tick();
  const ids=[...root.querySelector('#quoteForm select[name="leadId"]').options].map(x=>x.value);assert.equal(ids.includes('L-106'),false);assert.equal(ids.includes('L-104'),false);assert.equal(ids.includes('L-107'),false);assert.ok(ids.includes('L-101'));dom.window.close();
});

test('new lead explains why quote creation is disabled',async()=>{
  const {dom,root}=await setup('new-lead-quote');root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="leads"]').click();root.querySelector('[data-lead="L-106"]').click();await tick();
  const button=root.querySelector('[data-create-quote="L-106"]');assert.equal(button.disabled,true);assert.match(root.textContent,/В работе/i);assert.match(root.textContent,/Сначала принять в работу/i);dom.window.close();
});

test('selecting work status immediately activates save and save-plus-quote actions',async()=>{
  const {dom,root}=await setup('work-activates-actions');root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="leads"]').click();root.querySelector('[data-lead="L-106"]').click();await tick();
  const form=root.querySelector('#leadEditForm'),status=form.elements.status,save=form.querySelector('button[type="submit"]'),create=root.querySelector('[data-create-quote="L-106"]');
  assert.equal(create.disabled,true);status.value='В работе';status.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
  assert.equal(save.disabled,false);assert.equal(create.disabled,false);assert.match(create.textContent,/Сохранить и создать расчёт/i);dom.window.close();
});

test('saving work status keeps quote creation active without reload',async()=>{
  const {dom,root}=await setup('work-save-quote');root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="leads"]').click();root.querySelector('[data-lead="L-106"]').click();await tick();
  let form=root.querySelector('#leadEditForm');form.elements.status.value='В работе';form.elements.status.dispatchEvent(new dom.window.Event('change',{bubbles:true}));form.querySelector('button[type="submit"]').click();await tick();
  const lead=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(x=>x.id==='L-106');assert.equal(lead.status,'В работе');form=root.querySelector('#leadEditForm');assert.ok(form);const create=root.querySelector('[data-create-quote="L-106"]');assert.equal(create.disabled,false);create.click();await tick();
  const quoteForm=root.querySelector('#quoteForm');assert.ok(quoteForm);assert.equal(quoteForm.elements.leadId.value,'L-106');dom.window.close();
});

test('create quote from pending work status saves lead first and opens quote',async()=>{
  const {dom,root}=await setup('work-direct-quote');root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="leads"]').click();root.querySelector('[data-lead="L-106"]').click();await tick();
  const form=root.querySelector('#leadEditForm');form.elements.status.value='В работе';form.elements.status.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();const create=root.querySelector('[data-create-quote="L-106"]');assert.equal(create.disabled,false);create.click();await tick();await tick();
  const lead=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(x=>x.id==='L-106');assert.equal(lead.status,'В работе');const quoteForm=root.querySelector('#quoteForm');assert.ok(quoteForm);assert.equal(quoteForm.elements.leadId.value,'L-106');dom.window.close();
});

test('deposit above agreed quote is stopped before base submit handler',async()=>{
  const {dom,root}=await setup('deposit-cap',{custom:true});root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="leads"]').click();root.querySelector('[data-lead="L-999"]').click();await tick();
  const form=root.querySelector('#leadEditForm'),deposit=form.querySelector('[name="deposit"]');assert.ok(deposit);deposit.value='40000';form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  const lead=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(x=>x.id==='L-999');assert.equal(Number(lead.deposit)||0,0);assert.match(form.textContent,/превышает согласованную стоимость/);dom.window.close();
});

test('client can edit only a new request and sees what happens after save',async()=>{
  const {dom,root}=await setup('client-edit',{clientStatus:'Новый'});root.querySelector('[data-go="orders"]').click();await tick();const card=[...root.querySelectorAll('.auto-order-card')].find(x=>x.dataset.clientLead==='L-998');assert.ok(card);card.click();await tick();
  const edit=document.querySelector('[data-client-edit="L-998"]');assert.ok(edit);assert.equal(edit.disabled,false);assert.match(document.body.textContent,/Что дальше/i);edit.click();await tick();const form=document.querySelector('#clientEditForm');assert.ok(form);form.elements.model.value='BMW X5';form.elements.budget.value='47000';form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  const lead=JSON.parse(localStorage.getItem('auto-sale-leads-v2')).find(x=>x.id==='L-998');assert.equal(lead.model,'BMW X5');assert.equal(lead.budget,47000);assert.equal(lead.status,'Новый');dom.window.close();
});

test('client edit is locked after manager starts work and reason is visible',async()=>{
  const {dom,root}=await setup('client-lock',{clientStatus:'В работе'});root.querySelector('[data-go="orders"]').click();await tick();const card=[...root.querySelectorAll('.auto-order-card')].find(x=>x.dataset.clientLead==='L-998');assert.ok(card);card.click();await tick();const edit=document.querySelector('[data-client-edit="L-998"]');assert.ok(edit);assert.equal(edit.disabled,true);assert.match(document.body.textContent,/Почему нельзя редактировать/i);assert.match(document.body.textContent,/Менеджер уже начал подбор/i);dom.window.close();
});

test('delivery cannot advance to handoff until final payment is entered',async()=>{
  const {dom,root}=await setup('handoff-payment',{orderDelivery:true});root.querySelector('[data-role="manager"]').click();root.querySelector('[data-go="shipping"]').click();root.querySelector('[data-order="O-2303"]').click();await tick();const form=root.querySelector('#orderForm'),button=root.querySelector('[data-order-next="O-2303"]');assert.ok(button);assert.equal(button.disabled,true);assert.match(form.textContent,/оставшуюся оплату \$3,800/i);form.elements.paymentAmount.value='3800';form.elements.paymentAmount.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await tick();assert.equal(button.disabled,false);assert.match(form.textContent,/Можно переходить в «Выдача»/i);dom.window.close();
});
