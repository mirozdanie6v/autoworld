import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

function installDom(){
  const dom=new JSDOM('<!doctype html><html><body><button data-go="catalog">Каталог</button><button data-detail="car_123">Подробнее</button><select id="brandFilter"><option>BMW</option></select><form id="requestForm"><input name="carId" value="car_123"></form></body></html>',{
    url:'https://staging.example.test/',pretendToBeVisual:true
  });
  const prior={document:globalThis.document,window:globalThis.window,Element:globalThis.Element,fetch:globalThis.fetch};
  globalThis.document=dom.window.document;globalThis.window=dom.window;globalThis.Element=dom.window.Element;
  return{dom,restore(){for(const [key,value] of Object.entries(prior)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}dom.window.close()}};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('feature-off config never sends events or disrupts customer UI',async()=>{
  const scope=installDom(),posts=[];
  globalThis.window.__AUTO_SALE_ACCESS__={role:'client',authenticated:true};
  globalThis.window.__AUTO_SALE_AUTH_HEADERS__=opts=>({...opts,'x-telegram-init-data':'signed-test-only'});
  globalThis.fetch=async(url,options={})=>{
    if(String(url).endsWith('/config'))return{ok:true,json:async()=>({enabled:false})};
    posts.push({url,options});return{ok:true};
  };
  try{
    const analytics=await import('../public/auto-sale-visitor-analytics.mjs?ui-disabled');
    await analytics.ensureVisitorTracking();
    analytics.trackVisitorEvent('car_open','car_123');
    scope.dom.window.document.querySelector('[data-detail]').click();
    await wait(75);
    assert.equal(posts.length,0);
  }finally{scope.restore()}
});
test('signed session sends whitelisted minimal client events; admin reads report',async()=>{
  const scope=installDom(),posts=[],getRequests=[];
  const doc=scope.dom.window.document;
  globalThis.window.__AUTO_SALE_ACCESS__={role:'client',authenticated:true};
  globalThis.window.__AUTO_SALE_AUTH_HEADERS__=opts=>({...opts,'x-telegram-init-data':'signed-test-only'});
  globalThis.fetch=async(url,options={})=>{
    if(String(url).endsWith('/config'))return{ok:true,json:async()=>({enabled:true})};
    if(String(url).endsWith('/events')){posts.push(JSON.parse(options.body));return{ok:true,status:202}}
    getRequests.push(String(url));
    return{ok:true,json:async()=>({
      ok:true,days:7,sessions:1,counts:{app_open:1,car_open:1,photo_view:1,request_success:1},
      topCars:[{carId:'car_123',views:1}],sources:[{source:'telegram',opens:1}],
      recentSessions:[{sessionId:'12345678',events:[{type:'car_open',carId:'car_123'}]}]
    })};
  };
  try{
    const analytics=await import('../public/auto-sale-visitor-analytics.mjs?ui-enabled');
    await analytics.ensureVisitorTracking();
    doc.querySelector('[data-detail]').click();
    doc.querySelector('[data-go="catalog"]').click();
    doc.querySelector('#brandFilter').dispatchEvent(new scope.dom.window.Event('change',{bubbles:true}));
    analytics.trackVisitorEvent('request_success','car_123');
    await wait(1400);
    assert.equal(posts.length,1);
    assert.equal(posts[0].events.length,5);
    assert.deepEqual(posts[0].events.map(x=>x.type),['app_open','car_open','catalog_open','filter_change','request_success']);
    assert.equal(posts[0].events.every(e=>Object.keys(e).sort().join(',')==='carId,eventId,type'),true);
    assert.equal(posts[0].events.some(e=>'contact'in e||'userId'in e),false);
    globalThis.window.__AUTO_SALE_ACCESS__={role:'admin',authenticated:true};
    doc.body.innerHTML=analytics.visitorAnalyticsPanelShell();
    await analytics.hydrateVisitorAnalytics(doc);
    assert.match(doc.body.textContent,/Активность в Mini App/);
    assert.match(doc.body.textContent,/Популярные автомобили/);
    assert.match(doc.body.textContent,/car_123/);
    assert.equal(getRequests.some(u=>u.includes('/report?days=7')),true);
  }finally{scope.restore()}
});
