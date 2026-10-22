// Built-site browser regression. All API calls are mocked, no production data or messages.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {once} from 'node:events';
import {chromium} from 'playwright';

const car={id:'AWG-TRAIL-SELECTED',brand:'Chevrolet',model:'Trailblazer',origin:'Грузия',year:2023,
 mileage:'44 000 км',engine:'1,3l на 155HP',drive:'FWD',image:'https://example.invalid/vehicle.jpg',
 priceRub:1770000,price:0,active:true,delivery:'5–10 дней'};
const root=resolve('dist');
const out=resolve('awg-catalog-selection-browser-evidence');
await mkdir(out,{recursive:true});
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript',
 '.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+'/'))throw Error('forbidden');
  const metadata=await stat(file);if(!metadata.isFile())throw Error('not-file');
  res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});
  res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('not found');}
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.AWG_CHROME_BIN?{executablePath:process.env.AWG_CHROME_BIN}:{}),args:['--no-sandbox']});
try{
 for(const platform of ['vk','telegram']){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
   deviceScaleFactor:1,locale:'ru-RU',serviceWorkers:'block'});
  await context.addInitScript(car=>{
   localStorage.setItem('auto-sale-catalog-v1',JSON.stringify([car]));
   if(new URLSearchParams(location.search).has('tgWebAppVersion'))
    window.Telegram={WebApp:{initData:'synthetic-qa-only',initDataUnsafe:{user:{id:999999887,first_name:'Test'}},
      ready(){},expand(){},platform:'android',MainButton:{show(){},hide(){}},BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{impactOccurred(){}}}};
  },car);
  let resumeState;
  const hold=new Promise(resolve=>{resumeState=resolve;});
  const writes=[],pageErrors=[];
  const page=await context.newPage();
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin){await route.abort();return;}
   if(url.pathname==='/api/auto-sale/state'){
    await hold;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      initialized:true,revision:108,leads:[],quotes:[],orders:[],notes:{},team:[],catalog:[car],
      _access:{role:'public',authenticated:false,member:null},_rowVersions:{lead:{},catalog:{},quote:{},order:{},team:{}}
    })});
    return;
   }
   if(url.pathname==='/api/auto-sale/entities/batch'){
    const body=JSON.parse(route.request().postData()||'{}');
    writes.push(...body.operations||[]);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,revision:109,rowVersions:{}})});
    return;
   }
   if(url.pathname.startsWith('/api/')){
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false,messagingEnabled:false})});
    return;
   }
   await route.continue();
  });
  const url=origin+(platform==='vk'?'/?vk_app_id=54810434&vk_user_id=999999887&sign=synthetic':'/?tgWebAppVersion=8.0&tgWebAppPlatform=android');
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('[data-go="catalog"]').first().waitFor({state:'visible',timeout:25000});
  await page.locator('[data-go="catalog"]').first().click();
  await page.locator('[data-request-car="'+car.id+'"]').first().click();
  const form=page.locator('#requestForm');
  await form.waitFor({state:'visible'});
  assert.equal(await form.locator('[name="carId"]').inputValue(),car.id);
  assert.equal(await form.locator('[name="catalogIntent"]').inputValue(),'catalog');
  await form.locator('[name="name"]').fill('Browser Test');
  await form.locator('[name="contact"]').fill('@synthetic');
  await form.locator('[name="note"]').fill('Same exact catalog car after state reload');
  await page.screenshot({path:join(out,platform+'-before-sync.png')});
  resumeState();
  await page.waitForFunction(()=>window.__AUTO_SALE_SERVER__?.revision===108,null,{timeout:18000});
  await page.waitForTimeout(350);
  const again=page.locator('#requestForm');
  await again.waitFor({state:'visible',timeout:7000});
  assert.equal(await again.locator('[name="catalogIntent"]').inputValue(),'catalog');
  assert.equal(await again.locator('[name="carId"]').inputValue(),car.id);
  assert.equal(await again.locator('[name="name"]').inputValue(),'Browser Test');
  assert.equal(await again.locator('[name="contact"]').inputValue(),'@synthetic');
  assert.equal(await again.locator('[name="note"]').inputValue(),'Same exact catalog car after state reload');
  assert.equal(await again.locator('[name="year"]').inputValue(),'2023');
  assert.equal(await again.locator('[name="mileage"]').inputValue(),'44 000 км');
  await page.screenshot({path:join(out,platform+'-after-sync.png')});
  await again.locator('[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#requestForm')===null,null,{timeout:15000});
  const created=writes.find(w=>w.resource==='lead'&&w.operation==='create');
  assert.ok(created,'client lead was persisted via entity batch');
  assert.equal(created.input.carId,car.id);
  assert.equal(created.input.catalogVehicle.id,car.id);
  assert.equal(created.input.catalogRequest,true);
  assert.equal(created.input.requestFlow,'catalog_card');
  assert.equal(created.input.requestCarId,car.id);
  assert.equal(created.input.requestUiVersion,'20261022-catalog-binding-v3');
  assert.equal(created.input.year,'2023');
  assert.equal(created.input.mileage,'44 000 км');
  assert.equal(created.input.engine,'1,3l на 155HP');
  assert.equal(pageErrors.length,0,'JavaScript browser errors: '+JSON.stringify(pageErrors));
  const x=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
  assert.ok(x.documentWidth<=x.width+3,'unexpected horizontal overflow '+JSON.stringify(x));
  console.log('AWG_CATALOG_SELECTION_BROWSER_OK',JSON.stringify({platform,carId:created.input.carId,snapshot:created.input.catalogVehicle.id,year:created.input.year,mileage:created.input.mileage}));
  await context.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
