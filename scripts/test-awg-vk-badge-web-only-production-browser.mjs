import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const origin='https://awgcars.ru';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const result=[];
try{
  for(const scenario of [
    {mode:'plain-web',url:origin+'/',expected:true},
    {mode:'vk-mini-app',url:origin+'/?vk_app_id=54811927&vk_user_id=777&sign=fake',expected:false},
    {mode:'telegram-mini-app',url:origin+'/?tgWebAppVersion=9.0&tgWebAppPlatform=android',expected:false},
    {mode:'telegram-fragment-launch',url:origin+'/#tgWebAppData=mock&tgWebAppVersion=9.0',expected:false}
  ]){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ru-RU'});
    const page=await context.newPage();
    try{
      const response=await page.goto(scenario.url,{waitUntil:'domcontentloaded',timeout:55000});
      assert.equal(response.status(),200,scenario.mode+' page loads');
      if(scenario.expected){
        await page.locator('[data-vk-status-widget]').waitFor({state:'visible',timeout:25000});
        await page.locator('[data-vk-status="out"]').waitFor({timeout:18000});
        assert.equal(await page.locator('[data-vk-status-widget]').count(),1);
      }else{
        await page.waitForTimeout(2800);
        assert.equal(await page.locator('[data-vk-status-widget]').count(),0,scenario.mode+' must hide VK ID widget');
        assert.equal(await page.locator('[data-vk-status-style]').count(),0,scenario.mode+' must not load VK web widget stylesheet');
      }
      result.push({mode:scenario.mode,visible:scenario.expected,passed:true});
      await page.screenshot({path:'awg-vk-badge-'+scenario.mode+'.png',fullPage:false});
    }finally{
      await context.close();
    }
  }
  console.log('AWG_VK_BADGE_WEB_ONLY_PRODUCTION_BROWSER_VERIFIED',JSON.stringify({origin,results:result}));
}finally{await browser.close()}
