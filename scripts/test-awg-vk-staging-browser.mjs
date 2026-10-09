import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const ORIGIN='https://vk-test.awgcars.ru';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const failures=[];
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'ru-RU'});
page.on('pageerror',error=>failures.push(String(error.message||error).slice(0,250)));
try{
  const navigation=await page.goto(ORIGIN,{waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(navigation?.status(),200,'staging homepage HTTP 200');
  await page.locator('[data-go="catalog"]').first().waitFor({state:'visible',timeout:20000});
  await page.locator('[data-go="orders"]').first().waitFor({state:'visible',timeout:20000});
  assert.ok((await page.title()).length>0,'staging page title');
  const publicApi=await page.evaluate(async()=>{
    const [state,config,profile]=await Promise.all([
      fetch('/api/auto-sale/state',{cache:'no-store'}),
      fetch('/api/auto-sale/vk/web/config',{cache:'no-store'}),
      fetch('/api/auto-sale/vk/web/profile',{cache:'no-store'})
    ]);
    return {
      stateStatus:state.status, state:state.ok?await state.json():null,
      configStatus:config.status, config:config.ok?await config.json():null,
      profileStatus:profile.status
    };
  });
  assert.equal(publicApi.stateStatus,200,'public state');
  assert.equal(publicApi.configStatus,200,'VK configuration');
  assert.equal(publicApi.config.enabled,true,'VK login enabled');
  assert.equal(publicApi.config.authenticated,false,'unauthenticated browser remains guest');
  assert.equal(publicApi.profileStatus,401,'VK profile is protected from anonymous browser');
  assert.equal(publicApi.state.leads.length,0,'guest sees zero client requests');
  assert.equal(publicApi.state.team.length,0,'guest sees no staff data');
  assert.ok(publicApi.state.catalog.some(car=>car.model?.includes('тест VK ID')),'staging test catalog fixture visible');

  await page.locator('[data-go="catalog"]').first().click();
  await page.getByText('Toyota Camry — тест VK ID',{exact:false}).first().waitFor({state:'visible',timeout:20000});
  await page.locator('[data-go="orders"]').first().click();
  await page.getByText('Заявки и статус поставки',{exact:false}).first().waitFor({state:'visible',timeout:10000});
  await page.locator('[data-open-request]').first().click();
  const form=page.locator('#requestForm');
  await form.waitFor({state:'visible',timeout:10000});
  assert.equal(await form.locator('[name="name"]').inputValue(),'','guest name is blank');
  assert.equal(await form.locator('[name="contact"]').inputValue(),'','guest contact is blank');
  await page.screenshot({path:'vk-staging-mobile-form.png',fullPage:true});
  console.log('STAGING_BROWSER_PUBLIC_SMOKE_PASS',JSON.stringify({
    origin:ORIGIN,http:200,catalog:true,orders:true,requestForm:true,
    publicState:true,vkConfigEnabled:true,guestProfileDenied:true,
    inspectedWithoutLogin:true,pageErrors:failures
  }));
  assert.equal(failures.length,0,'no JavaScript page errors');
}finally{
  await browser.close();
}
