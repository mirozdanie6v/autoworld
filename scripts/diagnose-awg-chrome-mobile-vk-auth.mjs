import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Only read-only login-page diagnostics: no user credentials, no OAuth completion.
const APP='54811927';
const SITE='https://awgcars.ru';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const ua='Mozilla/5.0 (Linux; Android 14; 22101316UG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const results=[];
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:ua,locale:'en-US'});
  for(const variant of ['chrome-ui-redirect','direct-with-referer','direct-without-referer','direct-with-origin']){
    const page=await context.newPage();
    try{
      let navigation=null;
      if(variant==='chrome-ui-redirect'){
        await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:50000});
        const badge=page.locator('[data-vk-status-widget]');
        await badge.waitFor({state:'visible',timeout:20000});
        await page.locator('[data-vk-status="out"]').waitFor({timeout:20000});
        await badge.locator('[data-vk-status-trigger]').click();
        await page.waitForURL(/id\.vk\.ru\/authorize\?/,{timeout:35000});
        navigation=await page.waitForLoadState('domcontentloaded',{timeout:35000}).catch(()=>null);
      }else{
        const start=await context.request.get(SITE+'/api/auto-sale/vk/web/start',{maxRedirects:0,timeout:30000});
        assert.equal(start.status(),302);
        const target=new URL(start.headers().location);
        assert.equal(target.searchParams.get('client_id'),APP);
        if(variant==='direct-with-origin')target.searchParams.set('origin',SITE);
        const referer=variant==='direct-with-referer'?SITE+'/':undefined;
        await page.goto(target.toString(),{referer,waitUntil:'domcontentloaded',timeout:50000});
      }
      await page.waitForTimeout(2500);
      const content=await page.locator('body').innerText().catch(()=>'');
      const txt=content.toLowerCase();
      results.push({variant,host:new URL(page.url()).hostname,hasDomainError:txt.includes('base domain')||txt.includes('базовый домен'),hasLoginForm:txt.includes('phone')||txt.includes('телефон'),preview:content.replace(/\s+/g,' ').slice(0,170)});
    }catch(e){results.push({variant,error:String(e.message).slice(0,190)});}
    finally{await page.close();}
  }
  console.log('AWG_ANDROID_CHROME_VK_AUTH_DIAGNOSTIC',JSON.stringify(results));
  assert.equal(results.length,4);
}finally{await browser.close()}
