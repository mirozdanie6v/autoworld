// Candidate browser smoke: built artifact in Chromium; external providers + API are isolated fixtures.
// No requests to production, real Telegram or VK. Remote staging data is separately tested with YDB.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {join,extname,resolve} from 'node:path';
import {once} from 'node:events';
import {chromium} from 'playwright';

const root=resolve('dist'),out=resolve('awg-georgia-browser-evidence');
await mkdir(out,{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=resolve(root,'.'+(path==='/'?'/index.html':path));
    if(!target.startsWith(root+'/')&&target!==root)throw Error('path_forbidden');
    const st=await stat(target);
    if(!st.isFile())throw Error('not_file');
    res.writeHead(200,{'content-type':mime[extname(target)]||'application/octet-stream','cache-control':'no-store'});
    res.end(await readFile(target));
  }catch{res.writeHead(404);res.end('not found')}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.AWG_CHROME_BIN?{executablePath:process.env.AWG_CHROME_BIN}:{}),args:['--no-sandbox']});
const quoteInput={
 id:'Q-AWG-GEO-BROWSER',leadId:'L-AWG-GEO-BROWSER',version:1,model:'Toyota Camry',
 origin:'Грузия',tariffVersion:'2026-10-21-georgia',quoteSchema:'awg-quote-georgia-2026-10-21',
 status:'Отправлен',transportMode:'Доставка под ключ',ageCategory:'3to5',
 manufactureDate:'2023-02',engineCc:2000,powerHp:150,powerInput:150,powerUnit:'ps',
 engineType:'petrol',importerType:'nat',lot:15000,turnkeyDeliveryUsd:900.5,
 legalization:4000,service:1000,internationalTransferPercent:3.5,cryptoFee:556.52,
 customsRub:420000,recyclingRub:100000,usdRubRate:100,exchangeRateDate:'2026-10-21',
 exchangeRateSource:'cbr',customs:4200,recyclingFee:1000,auction:0,inland:0,ocean:0,
 repair:0,partsCost:0,georgiaDelivery:0,total:26657.02,updatedAt:'2026-10-21T14:00:00.000Z'
};
const lead={id:quoteInput.leadId,name:'Клиент тестового расчёта',contact:'@test_client',
 model:'Toyota Camry',origin:'Грузия',status:'Ожидает клиента',manager:'Дмитрий',
 priority:'Средний',source:'Mini App',nextAction:'2026-10-22',budget:15000,ageRange:'3–5 лет',
 clientCreated:true,clientProvider:'vk',clientProviderUserId:'999999887',clientIdentityKey:'vk:999999887'};
const team=[{id:'T-1',name:'Дмитрий',role:'Менеджер',active:true,telegramUsername:'test_manager',telegramUserId:'800'}];
const variants=[
 {name:'manager-mobile',role:'admin',platform:'web',size:{width:390,height:844}},
 {name:'manager-desktop',role:'admin',platform:'web',size:{width:1366,height:900}},
 {name:'client-vk-mobile',role:'client',platform:'vk',size:{width:390,height:844}},
 {name:'client-telegram-mobile',role:'client',platform:'telegram',size:{width:390,height:844}}
];
const results={};
async function runVariant(variant){
  const db={revision:23,initialized:true,leads:[{...lead,clientProvider:variant.platform==='telegram'?'telegram':'vk',
    clientProviderUserId:variant.platform==='telegram'?'999999887':'999999887',clientIdentityKey:(variant.platform==='telegram'?'telegram':'vk')+':999999887'}],
    quotes:variant.role==='client'?[{...quoteInput}]:[],orders:[],notes:{},team:variant.role==='admin'?team:[],catalog:[]};
  const errors=[],writes=[];
  const context=await browser.newContext({viewport:variant.size,isMobile:variant.size.width<600,hasTouch:variant.size.width<600,
    locale:'ru-RU',deviceScaleFactor:1,serviceWorkers:'block'});
  if(variant.platform==='telegram')await context.addInitScript(()=>{
    window.Telegram={WebApp:{initData:'qa-synthetic-telegram-init',initDataUnsafe:{user:{id:999999887,username:'synthetic_awg_client',first_name:'Test'}},
      ready(){},expand(){},close(){},MainButton:{show(){},hide(){}},BackButton:{show(){},hide(){},onClick(){}},
      HapticFeedback:{impactOccurred(){}},openTelegramLink(){},openLink(){},platform:'android'}};
  });
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(String(e.message||e).slice(0,280)));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){await route.abort();return}
    if(!url.pathname.startsWith('/api/')){await route.continue();return}
    const method=route.request().method();
    if(url.pathname==='/api/auto-sale/state'&&method==='GET'){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        ...db,_rowVersions:{lead:{[lead.id]:db.revision},quote:{[quoteInput.id]:db.revision},order:{},team:{},catalog:{}},
        _access:{role:variant.role,authenticated:true,member:variant.role==='admin'?{name:'Дмитрий',role:'Менеджер'}:null}
      })});return;
    }
    if(url.pathname==='/api/auto-sale/entities/batch'&&method==='POST'){
      const body=JSON.parse(route.request().postData()||'{}');
      writes.push(body.operations);
      for(const op of body.operations||[]){
        const key=({lead:'leads',quote:'quotes',order:'orders',team:'team',catalog:'catalog'})[op.resource];
        if(op.resource==='note')continue;
        if(!key)continue;
        const items=db[key],index=items.findIndex(x=>x.id===op.id);
        if(op.operation==='create'&&index<0)items.push({...op.input});
        else if(op.operation==='patch'&&index>=0)items[index]={...items[index],...op.input};
      }
      db.revision++;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        ok:true,revision:db.revision,rowVersions:Object.fromEntries((body.operations||[])
          .filter(x=>x.resource!=='note').map(x=>[x.resource+':'+x.id,db.revision]))
      })});return;
    }
    if(url.pathname==='/api/auto-sale/vk/config'){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false})});return;
    }
    if(url.pathname==='/api/auto-sale/vk/web/config'){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false})});return;
    }
    await route.fulfill({status:401,contentType:'application/json',body:'{"error":"isolated_mock"}'});
  });
  const suffix=variant.platform==='vk'?'?vk_app_id=54810434&vk_user_id=999999887&sign=synthetic-only':
    variant.platform==='telegram'?'?tgWebAppVersion=8.0&tgWebAppPlatform=android':'';
  const response=await page.goto(origin+'/'+suffix,{waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(response?.status(),200,'candidate build response');
  await page.locator('[data-go]').first().waitFor({state:'visible',timeout:25000});
  await page.waitForFunction((role)=>window.__AUTO_SALE_ACCESS__?.role===role,variant.role,{timeout:15000});
  // Allow initial async identity and cache hydration to settle before opening a transient dialog.
  await page.waitForTimeout(1100);
  if(variant.role==='admin'){
    await page.locator('[data-go="quotes"]').first().click();
    await page.locator('[data-new-quote]').click();
    let form=page.locator('#quoteForm');
    await form.waitFor({state:'visible'});
    if(await form.getAttribute('data-georgia-quote')!=='true'){
      await form.locator('[name="origin"]').selectOption('Грузия');
      await form.waitFor({state:'detached'});
      form=page.locator('#quoteForm');
      await form.waitFor({state:'visible'});
    }
    assert.equal(await form.getAttribute('data-georgia-quote'),'true','new Georgian manager editor displayed');
    assert.equal(await form.locator('[name="legalization"]').inputValue(),'4000');
    assert.equal(await form.locator('[name="service"]').inputValue(),'1000');
    await form.locator('[name="transportMode"]').selectOption({label:'Доставка под ключ'});
    await form.locator('[name="turnkeyDeliveryUsd"]').fill('900.50');
    await form.locator('[name="lot"]').fill('15000');
    await form.locator('[name="customsRub"]').fill('420000');
    await form.locator('[name="recyclingRub"]').fill('100000');
    await form.locator('[name="usdRubRate"]').fill('100');
    await form.locator('[name="exchangeRateDate"]').fill('2026-10-21');
    await form.locator('[name="exchangeRateSource"]').selectOption('cbr');
    await form.locator('[name="engineCc"]').fill('2000');
    await form.locator('[name="powerHp"]').fill('150');
    await form.locator('[name="engineType"]').selectOption('petrol');
    await form.locator('[name="importerType"]').selectOption('nat');
    await form.locator('[name="ageCategory"]').selectOption('3to5');
    await form.locator('[name="status"]').selectOption('Отправлен');
    assert.equal(await form.locator('#quoteTotal').innerText(),'$26,657.02','browser calculates car plus delivery transfer');
    assert.equal(await form.locator('#quoteTurnkeyDeliveryField').isVisible(),true,'delivery amount input appears');
    await page.screenshot({path:join(out,variant.name+'-editor.png'),fullPage:false});
    await form.locator('button[type="submit"]').click();
    await page.locator('.auto-quote-card').first().waitFor({timeout:10000});
    assert.equal(db.quotes.length,1,'manager quote saved through entity batch API');
    assert.equal(db.quotes[0].total,26657.02);
    assert.equal(db.quotes[0].cryptoFee,556.52);
    assert.match(await page.locator('.auto-quote-card').first().innerText(),/26,657.02/);
    assert.match(await page.locator('.auto-quote-card').first().innerText(),/900.50/);
    assert.ok(writes.some(ops=>ops.some(x=>x.resource==='quote'&&x.operation==='create')),'entity persisted');
    await page.screenshot({path:join(out,variant.name+'-saved.png'),fullPage:false});
    results[variant.name]={quoteSaved:true,total:db.quotes[0].total,fee:db.quotes[0].cryptoFee};
  }else{
    await page.locator('[data-go="orders"]').first().click();
    const card=page.locator('.auto-order-card[data-client-lead]').first();
    await card.waitFor({state:'visible',timeout:15000});
    await card.click();
    const panel=page.locator('.auto-client-quote');
    await panel.waitFor({state:'visible',timeout:15000});
    const quoteText=await panel.innerText();
    assert.match(quoteText,/26,657.02/);
    assert.match(quoteText,/900.50/);
    assert.match(quoteText,/556.52/);
    assert.match(quoteText,/авто \+ доставка/);
    assert.equal(await panel.getByText('Согласовать расчёт').isVisible(),true);
    await page.screenshot({path:join(out,variant.name+'-quote.png'),fullPage:false});
    page.once('dialog',dialog=>dialog.accept());
    await panel.locator('[data-client-quote-agree]').click();
    await page.waitForFunction(()=>document.querySelector('.auto-client-quote')?.textContent.includes('Расчёт согласован'),null,{timeout:15000});
    assert.equal(db.quotes[0].status,'Согласован','client approval saved through entity batch');
    assert.equal(db.quotes[0].total,26657.02,'approved total retained');
    assert.ok(writes.some(ops=>ops.some(x=>x.resource==='quote'&&x.operation==='patch'&&x.input.clientDecision==='agreed')));
    await page.screenshot({path:join(out,variant.name+'-approved.png'),fullPage:false});
    results[variant.name]={clientApproved:true,total:db.quotes[0].total};
  }
  const overflow=await page.evaluate(()=>({screen:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(overflow.scroll<=overflow.screen+3,'viewport horizontal overflow: '+JSON.stringify(overflow));
  assert.equal(errors.length,0,'candidate browser errors '+JSON.stringify(errors));
  await context.close();
}
try{
  for(const variant of variants)await runVariant(variant);
  console.log('AWG_GEORGIA_CANDIDATE_BROWSER_OK',JSON.stringify(results));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
