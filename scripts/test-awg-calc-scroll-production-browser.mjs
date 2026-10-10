import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ru-RU'});
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e.message)));
 const response=await page.goto('https://awgcars.ru/',{waitUntil:'domcontentloaded',timeout:55000});
 assert.equal(response.status(),200);
 await page.locator('#app .auto-shell').waitFor({state:'visible',timeout:45000});
 await page.waitForFunction(()=>Boolean(window.__AUTO_SALE_CALC_SCROLL_PERF__),{timeout:30000});
 assert.equal(await page.locator('[data-vk-status-widget]').count(),1,'ordinary web VK login badge preserved');
 const btn=page.locator('[data-go="catalog"]').first();
 await btn.click({timeout:20000});
 await page.locator('.auto-car .auto-calc-glint').first().waitFor({state:'attached',timeout:22000});
 await page.waitForTimeout(300);
 const before=await page.evaluate(()=>{
   const all=[...document.querySelectorAll('.auto-car .auto-calc-glint')];
   const active=all.filter(el=>el.closest('.auto-car').classList.contains('auto-calc-inview'));
   const idle=active.map(el=>getComputedStyle(el,'::before').animationPlayState);
   const other=all.filter(el=>!el.closest('.auto-car').classList.contains('auto-calc-inview'));
   return {total:all.length,active:active.length,running:idle.filter(s=>s==='running').length,
     offscreen:other.length,allOffscreenPaused:other.every(el=>getComputedStyle(el,'::before').animationPlayState==='paused'),
     glassAnimationName:active[0]?getComputedStyle(active[0],'::before').animationName:null,
     perfReady:document.documentElement.classList.contains('auto-calc-perf-ready')};
 });
 assert.ok(before.total>=3,'production catalog available with calculate buttons');
 assert.equal(before.perfReady,true);
 assert.ok(before.active>0);
 assert.equal(before.running,before.active,'idle visible animation preserved');
 assert.equal(before.allOffscreenPaused,true);
 assert.equal(before.glassAnimationName,'autoCalcPearlWaveV25','original glass animation design remains');
 await page.evaluate(()=>window.scrollBy(0,650));
 await page.waitForFunction(()=>document.documentElement.classList.contains('auto-calc-is-scrolling'),{timeout:4000});
 const scrolling=await page.evaluate(()=>[...document.querySelectorAll('.auto-car.auto-calc-inview .auto-calc-glint')].every(el=>getComputedStyle(el,'::before').animationPlayState==='paused'));
 assert.equal(scrolling,true,'scroll freezes active reflections');
 await page.waitForTimeout(300);
 const resumed=await page.evaluate(()=>!document.documentElement.classList.contains('auto-calc-is-scrolling')&&[...document.querySelectorAll('.auto-car.auto-calc-inview .auto-calc-glint')].every(el=>getComputedStyle(el,'::before').animationPlayState==='running'));
 assert.equal(resumed,true,'glass animation resumes at rest');
 assert.equal(errors.length,0,'no production JavaScript runtime errors');
 console.log('AWG_CATALOG_SCROLL_PROD_BROWSER_VERIFIED',JSON.stringify({before,scrollPaused:scrolling,resumed,jsErrors:errors.length}));
 await page.screenshot({path:'awg-catalog-scroll-production-mobile.png',fullPage:false});
}finally{await browser.close()}
