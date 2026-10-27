import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {seedLeads,seedTeam} from './fixtures/auto-sale-business.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

async function setup(origin,tag){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://awgcars.ru/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    FormData:dom.window.FormData,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,
    MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,
    HTMLFormElement:dom.window.HTMLFormElement,Element:dom.window.Element,
    EventTarget:dom.window.EventTarget,Storage:dom.window.Storage});
  window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true,member:{name:'Дмитрий'}};
  const order={id:'O-TRANSITION-'+tag,leadId:'L-103',customer:'Тестовый клиент',model:'Toyota RAV4',
    origin,manager:'Дмитрий',source:'Telegram',stage:'Выкуп',total:30000,cost:28000,paid:0,
    lot:origin==='США'?'123456':'',vin:'JH4KA9650MC001234',eta:'2026-11-25',
    location:origin==='США'?'США, дилер':'Грузия, Тбилиси',riskType:'Нет',riskNote:'',risk:'Нет',
    paymentPlan:[],payments:[],updatedAt:'2026-10-27T06:00:00Z'};
  const leads=seedLeads().filter(x=>x.id==='L-103').map(x=>({...x,origin,status:'Сделка'}));
  localStorage.setItem('auto-sale-leads-v2',JSON.stringify(leads));
  localStorage.setItem('auto-sale-orders-v2',JSON.stringify([order]));
  localStorage.setItem('auto-sale-quotes-v2','[]');
  localStorage.setItem('auto-sale-team-v1',JSON.stringify(seedTeam()));
  localStorage.setItem('auto-sale-notes-v2','{}');
  localStorage.setItem('auto-sale-catalog-v1','[]');
  await import('../public/auto-sale-app-v3.mjs?order-next-'+tag);
  await import('../public/auto-sale-ui-business-guard.mjs?order-next-'+tag);
  const root=document.querySelector('#app');
  root.querySelector('[data-go="shipping"]').click();
  const card=root.querySelector('[data-order="'+order.id+'"]');
  assert.ok(card,origin+': order visible in manager logistics');
  card.click();
  await tick();
  assert.ok(root.querySelector('#orderForm'));
  return {dom,root,order};
}

for(const origin of ['США','Грузия']){
  test(origin+': server sync keeps active order and edits; FIRST Check and advance saves once',async()=>{
    const {dom,root,order}=await setup(origin,origin==='США'?'us':'georgia');
    const form=root.querySelector('#orderForm');
    assert.equal(form.elements.id.value,order.id);
    if(origin==='США')assert.equal(form.elements.lot.type,'text');
    else assert.equal(form.elements.lot.type,'hidden');
    form.elements.stage.value='Подготовка к отправке';
    form.elements.location.value=origin==='США'?'Лос-Анджелес, готов к отправке':'Тбилиси, готов к отправке';
    form.elements.eta.value='2026-12-02';
    form.elements.vin.focus();
    // Reproduce the asynchronous initial server response that previously
    // discarded order modals and returned the manager to Last Enquiries.
    window.dispatchEvent(new dom.window.CustomEvent('auto-sale-server-synced'));
    await tick();await tick();
    let live=root.querySelector('#orderForm');
    assert.ok(live,origin+': order must stay open during server sync');
    assert.equal(live.elements.id.value,order.id);
    assert.equal(live.elements.stage.value,'Подготовка к отправке');
    assert.equal(live.elements.location.value,form.elements.location.value);
    assert.equal(live.elements.eta.value,'2026-12-02');
    assert.equal(document.activeElement.name,'vin');
    assert.ok(root.querySelector('[data-order-next="'+order.id+'"]'));

    const writes=[];
    window.__AUTO_SALE_ENTITY_BATCH__=async operations=>{
      writes.push(operations);
      const patch=operations.find(x=>x.resource==='order');
      assert.equal(patch.input.stage,writes.length===1?'Подготовка к отправке':'В пути');
      assert.equal(patch.input.location,origin==='США'?'Лос-Анджелес, готов к отправке':'Тбилиси, готов к отправке');
      // The app receives another server snapshot while the first click is saving;
      // it must update the live record, not a detached pre-refresh object.
      if(writes.length===1){
        window.dispatchEvent(new dom.window.CustomEvent('auto-sale-server-synced'));
        await tick();
        assert.ok(root.querySelector('#orderForm'),origin+': no modal loss while save pending');
      }
      return {ok:true,revision:writes.length};
    };

    const first=root.querySelector('[data-order-next="'+order.id+'"]');
    assert.equal(first.disabled,false,origin+': no unnecessary disabled gate');
    first.click();first.click();
    await tick();await tick();await tick();
    assert.equal(writes.length,1,origin+': first click sends ONE batch, not two');
    assert.equal(JSON.parse(localStorage.getItem('auto-sale-orders-v2'))[0].stage,'Подготовка к отправке');
    live=root.querySelector('#orderForm');
    assert.ok(live,origin+': modal remains open after first click');
    assert.equal(live.elements.stage.value,'Подготовка к отправке');
    assert.equal(live.elements.location.value,origin==='США'?'Лос-Анджелес, готов к отправке':'Тбилиси, готов к отправке');
    assert.match(root.textContent,/Проверить и перейти: В пути/);

    const second=root.querySelector('[data-order-next="'+order.id+'"]');
    assert.equal(second.disabled,false);
    second.click();
    await tick();await tick();
    assert.equal(writes.length,2);
    assert.equal(JSON.parse(localStorage.getItem('auto-sale-orders-v2'))[0].stage,'В пути');
    assert.ok(root.querySelector('#orderForm'));
    assert.equal(root.querySelector('#orderForm').elements.stage.value,'В пути');
    assert.equal(JSON.parse(localStorage.getItem('auto-sale-leads-v2'))[0].status,'Сделка');
    delete window.__AUTO_SALE_ENTITY_BATCH__;
    dom.window.close();
  });
}

test('Telegram and VK entrypoints use the refreshed order-transition scripts',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../public/auto-sale-bootstrap.mjs',import.meta.url),'utf8');
  assert.ok(html.includes('auto-sale-bootstrap.mjs?v=20261027-payment-conflict-v1'));
  assert.ok(bootstrap.includes('auto-sale-app-v3.mjs?v=20261027-payment-conflict-v1'));
});
