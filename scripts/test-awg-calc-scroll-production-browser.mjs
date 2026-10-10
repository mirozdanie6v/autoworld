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
 await page.locator('[data-vk-status-widget]').waitFor({state:'visible',timeout:25000});
 assert.equal(await page.locator('[data-vk-status-widget]').count(),1,'ordinary web VK login badge preserved');
 const btn=page.locator('[data-go="catalog"]').first();
 await btn.click({timeout:20000});
 await page.locator('.auto-car .auto-calc-glint').first().waitFor({state:'attached',timeout:22000});
 // The first production cards can be completed auctions with disabled CTAs.
 // Scroll to a genuinely available Calculate button before testing its motion.
 const enabledButton=page.locator('.auto-car .auto-calc-btn:not(:disabled):not([aria-disabled="true"])').first();
 await enabledButton.waitFor({state:'attached',timeout:22000});
 await enabledButton.scrollIntoViewIfNeeded({timeout:18000});
 await page.waitForFunction(()=>{
   const button=document.querySelector('.auto-car .auto-calc-btn:not(:disabled):not([aria-disabled="true"])');
   return !document.documentElement.classList.contains('auto-calc-is-scrolling')&&
     button?.closest('.auto-car')?.classList.contains('auto-calc-inview')===true;
 },{timeout:12000});
 await page.waitForTimeout(300);
 const before=await page.evaluate(()=>{
   const all=[...document.querySelectorAll('.auto-car .auto-calc-glint')];
   const active=all.filter(el=>el.closest('.auto-car').classList.contains('auto-calc-inview'));
   const enabled=active.filter(el=>!el.closest('button')?.disabled&&el.closest('button')?.getAttribute('aria-disabled')!=='true');
   const running=enabled.filter(el=>getComputedStyle(el,'::before').animationPlayState==='running');
   const other=all.filter(el=>!el.closest('.auto-car').classList.contains('auto-calc-inview'));
   return {total:all.length,active:active.length,enabled:enabled.length,running:running.length,
     disabled:active.length-enabled.length,
     offscreen:other.length,allOffscreenPaused:other.every(el=>getComputedStyle(el,'::before').animationPlayState==='paused'),
     glassAnimationName:enabled[0]?getComputedStyle(enabled[0],'::before').animationName:null,
     perfReady:document.documentElement.classList.contains('auto-calc-perf-ready'),
     scrolling:document.documentElement.classList.contains('auto-calc-is-scrolling')};
 });
 console.log('AWG_CATALOG_SCROLL_PROD_DIAGNOSTIC',JSON.stringify(before));
 assert.ok(before.total>=3,'production catalog available with calculate buttons');
 assert.equal(before.perfReady,true);
 assert.ok(before.active>0);
 assert.ok(before.enabled>0,'production catalog has active calculation button');
 assert.equal(before.running,before.enabled,'idle visible available buttons preserve animation');
 assert.equal(before.allOffscreenPaused,true);
 assert.equal(before.glassAnimationName,'autoCalcPearlWaveV25','original glass animation design remains');
 await page.evaluate(()=>window.scrollBy(0,650));
 await page.waitForFunction(()=>document.documentElement.classList.contains('auto-calc-is-scrolling'),{timeout:4000});
 const scrolling=await page.evaluate(()=>[...document.querySelectorAll('.auto-car.auto-calc-inview .auto-calc-glint')].every(el=>getComputedStyle(el,'::before').animationPlayState==='paused'));
 assert.equal(scrolling,true,'scroll freezes active reflections');
 await page.waitForTimeout(300);
 const resumed=await page.evaluate(()=>!document.documentElement.classList.contains('auto-calc-is-scrolling')&&[...document.querySelectorAll('.auto-car.auto-calc-inview .auto-calc-glint')].filter(el=>!el.closest('button')?.disabled&&el.closest('button')?.getAttribute('aria-disabled')!=='true').every(el=>getComputedStyle(el,'::before').animationPlayState==='running'));
 assert.equal(resumed,true,'glass animation resumes at rest');
 assert.equal(errors.length,0,'no production JavaScript runtime errors');
 console.log('AWG_CATALOG_SCROLL_PROD_BROWSER_VERIFIED',JSON.stringify({before,scrollPaused:scrolling,resumed,jsErrors:errors.length}));
 await page.screenshot({path:'awg-catalog-scroll-production-mobile.png',fullPage:false});
}finally{await browser.close()}
