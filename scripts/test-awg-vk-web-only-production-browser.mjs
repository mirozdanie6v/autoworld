import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Read-only acceptance for the CURRENT production static release.
// Fake mini-app launch parameters validate UI gating only: they are not identities.
const origin='https://awgcars.ru';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const cases=[
  {name:'ordinary-web',url:origin+'/',expectWidget:true},
  {name:'vk-mini-app',url:origin+'/?vk_app_id=54811927&vk_user_id=777777&sign=untrusted',expectWidget:false},
  {name:'vk-mini-before-auth',url:origin+'/?vk_app_id=54811927',expectWidget:false},
  {name:'telegram-mini-query',url:origin+'/?tgWebAppVersion=8.0&tgWebAppPlatform=android',expectWidget:false},
  {name:'telegram-mini-fragment',url:origin+'/#tgWebAppData=query_id%3Dtest&tgWebAppPlatform=android',expectWidget:false}
];
try{
 const pages=[];
 for(const item of cases){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ru-RU'});
  const page=await context.newPage();
  const widgetRequests=[];
  page.on('request',req=>{if(req.url().includes('/auto-sale-vk-status-widget.mjs'))widgetRequests.push(req.url())});
  const response=await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(response?.status(),200,item.name+' page status');
  await page.waitForFunction(()=>typeof window.__AUTO_SALE_AUTH_HEADERS__==='function',null,{timeout:35000});
  if(item.expectWidget){
   await page.locator('[data-vk-status-widget]').waitFor({state:'visible',timeout:30000});
   await page.locator('[data-vk-status-widget][data-vk-status="out"]').waitFor({state:'visible',timeout:20000});
   assert.equal(await page.locator('[data-vk-status-widget]').count(),1,'web badge exactly once');
   assert.ok(widgetRequests.length>=1,'web widget imported');
  }else{
   // Allow async bootstrap / VK bridge a few seconds to run and render the header.
   await page.waitForTimeout(3000);
   assert.equal(await page.locator('[data-vk-status-widget]').count(),0,item.name+' must not create VK ID widget');
   assert.equal(widgetRequests.length,0,item.name+' must not import VK ID widget');
  }
  const status=await page.evaluate(()=>({
   bootstrap:typeof window.__AUTO_SALE_AUTH_HEADERS__==='function',
   widget:document.querySelectorAll('[data-vk-status-widget]').length,
   loginButtons:document.querySelectorAll('.auto-vk-status-trigger').length,
   shell:!!document.querySelector('#app .auto-shell')
  }));
  if(item.expectWidget){
   await page.screenshot({path:'awg-web-only-production-browser.png',fullPage:false});
  }
  pages.push({scenario:item.name,expectedWidget:item.expectWidget,found:status.widget,imports:widgetRequests.length,shell:status.shell});
  await context.close();
 }
 const html=await (await browser.newContext()).request.get(origin+'/');
 assert.equal(html.status(),200);
 const markup=await html.text();
 const scriptMatch=markup.match(/<script[^>]+src="([^"]*auto-sale-bootstrap\.mjs[^"]*)"/);
 assert.ok(scriptMatch,'actual production HTML references bootstrap');
 const bootstrapUrl=new URL(scriptMatch[1],origin).toString();
 const boot=await (await browser.newContext()).request.get(bootstrapUrl);
 assert.equal(boot.status(),200);
 const source=await boot.text();
 assert.ok(source.includes('telegramLaunchDetected()&&!telegramInitData()'),'production bootstrap hides widget in Telegram');
 assert.ok(source.includes("has('vk_app_id')"),'production bootstrap hides widget in VK');
 console.log('AWG_WEB_ONLY_VK_BADGE_PRODUCTION_VERIFIED',JSON.stringify({origin,sourceGuardVerified:true,cases:pages}));
}finally{await browser.close()}
