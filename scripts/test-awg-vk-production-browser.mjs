import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Read-only real browser smoke. No OAuth completion, client identity or writes.
const origin='https://awgcars.ru';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
const page=await browser.newPage({
  viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'ru-RU'
});
page.on('pageerror',error=>errors.push(String(error.message||error).slice(0,300)));
try{
  const navigation=await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(navigation?.status(),200,'production site responds HTTP 200');
  const badge=page.locator('[data-vk-status-widget]');
  await badge.waitFor({state:'visible',timeout:25000});
  await page.locator('[data-vk-status="out"]').waitFor({timeout:20000});
  assert.equal(await badge.locator('[data-vk-status-caption]').innerText(),'Войти');
  const r=await badge.boundingBox();
  assert.ok(r&&r.width>20&&r.width<180&&r.x>=0&&r.x+r.width<=392,'compact status visible inside mobile viewport');
  const state=await page.evaluate(async()=>{
    const [health,config,profile,data]=await Promise.all([
      fetch('/api/health',{cache:'no-store'}),
      fetch('/api/auto-sale/vk/web/config',{credentials:'same-origin',cache:'no-store'}),
      fetch('/api/auto-sale/vk/web/profile',{credentials:'same-origin',cache:'no-store'}),
      fetch('/api/auto-sale/state',{cache:'no-store'})
    ]);
    return {
      healthStatus:health.status,health:health.ok?await health.json():null,
      configStatus:config.status,config:config.ok?await config.json():null,
      profileStatus:profile.status,
      publicStatus:data.status,publicState:data.ok?await data.json():null
    };
  });
  assert.equal(state.healthStatus,200);
  assert.equal(state.health?.ok,true);
  assert.equal(state.health?.vkAuth,'enabled');
  assert.equal(state.health?.vkMessaging,'enabled');
  assert.ok(Number(state.health?.telegramRoutableManagers)>=2);
  assert.equal(state.configStatus,200);
  assert.equal(state.config?.enabled,true);
  assert.equal(state.config?.authenticated,false);
  assert.equal(state.profileStatus,401,'guest cannot access verified VK profile');
  assert.equal(state.publicStatus,200);
  assert.ok(Array.isArray(state.publicState?.catalog),'public catalogue visible');
  assert.equal(state.publicState?.leads?.length,0,'guest cannot see customer leads');
  assert.equal(state.publicState?.team?.length,0,'guest cannot see staff directory');
  const trigger=badge.locator('[data-vk-status-trigger]');
  assert.match(await trigger.getAttribute('aria-label'),/нажмите, чтобы войти/);
  // Signed-out trigger navigates straight to VK ID, rather than opening a panel.
  // Inspect the real HTTP redirect without following it or signing in.
  const start=await page.request.get(origin+'/api/auto-sale/vk/web/start',{maxRedirects:0,timeout:30000});
  assert.equal(start.status(),302,'VK ID authorization endpoint redirects');
  const destination=start.headers()['location']||'';
  assert.match(destination,/^https:\/\/id\.vk\.ru\/authorize\?/);
  assert.ok(destination.includes('awgcars.ru'),'OAuth callback returns to production host');
  await page.screenshot({path:'awg-vk-production-mobile-login.png',fullPage:false});
  await page.locator('[data-go="catalog"]').first().click();
  assert.ok(await page.locator('[data-vk-status-widget]').isVisible(),'widget remains after SPA navigation');
  await page.locator('[data-go="orders"]').first().click();
  await page.locator('[data-open-request]').first().click();
  await page.locator('#requestForm').waitFor({state:'visible',timeout:15000});
  assert.equal(await page.locator('[data-vk-status-widget]').count(),1,'no duplicate widget after SPA rerenders');
  await page.screenshot({path:'awg-vk-production-mobile-request.png',fullPage:false});
  assert.equal(errors.length,0,'no uncaught JS errors in production browser');
  console.log('AWG_PRODUCTION_VK_BROWSER_SMOKE_SUCCESS',JSON.stringify({
    origin,liveBrowser:true,mobile:true,verifiedVkWebEnabled:true,
    anonymousLoginBadge:true,profileProtected:true,publicLeadIsolation:true,
    telegramAndVkExistingHealth:true,catalog:true,requestForm:true,pageErrors:errors
  }));
}finally{
  await browser.close();
}
