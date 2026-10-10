import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const glass=await readFile(new URL('../public/auto-sale-calc-cta-v25.css',import.meta.url),'utf8');
const perf=await readFile(new URL('../public/auto-sale-calc-scroll-performance.css',import.meta.url),'utf8');
const motion=await readFile(new URL('../public/auto-sale-calc-scroll-performance.mjs',import.meta.url),'utf8');
const cards=n=>Array.from({length:n},(_,i)=>`<article class="auto-car" data-card="${i}" style="height:260px;margin:10px 0;box-sizing:border-box"><div class="auto-card-actions"><button class="auto-btn primary auto-calc-btn" data-request-car="${i}"><span class="auto-calc-glint"></span><span class="auto-calc-label">Рассчитать</span></button></div></article>`).join('');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 await page.setContent(`<!doctype html><html><head><style>body{margin:0;background:#090e17;color:white}.auto-calc-btn{height:54px;width:100%}</style></head><body><div id="app">${cards(45)}</div></body></html>`);
 await page.addStyleTag({content:glass});
 await page.addStyleTag({content:perf});
 await page.addScriptTag({type:'module',content:motion});
 await page.waitForFunction(()=>Boolean(window.__AUTO_SALE_CALC_SCROLL_PERF__&&document.querySelector('.auto-calc-inview')),{timeout:10000});
 const initial=await page.evaluate(()=>{
   const a=document.querySelector('[data-card="0"] .auto-calc-glint'),off=document.querySelector('[data-card="44"] .auto-calc-glint');
   const get=x=>getComputedStyle(x,'::before');
   return{visibleName:get(a).animationName,visible:get(a).animationPlayState,offscreen:get(off).animationPlayState,visibleCount:document.querySelectorAll('.auto-calc-inview').length,tracked:window.__AUTO_SALE_CALC_SCROLL_PERF__.getStats().tracked};
 });
 console.log('AWG_CALC_SCROLL_DIAGNOSTIC_INITIAL',JSON.stringify(initial));
 assert.equal(initial.visibleName,'autoCalcPearlWaveV25','v25 reflection unchanged');
 assert.equal(initial.visible,'running');
 assert.equal(initial.offscreen,'paused');
 assert.ok(initial.visibleCount<8&&initial.tracked===45,'offscreen cards never animate');
 await page.evaluate(()=>window.scrollTo(0,700));
 await page.waitForFunction(()=>document.documentElement.classList.contains('auto-calc-is-scrolling'));
 const scrolling=await page.evaluate(()=>({
  scrollFlag:document.documentElement.classList.contains('auto-calc-is-scrolling'),
  states:[...document.querySelectorAll('.auto-car.auto-calc-inview .auto-calc-glint')].map(el=>getComputedStyle(el,'::before').animationPlayState)
 }));
 assert.ok(scrolling.states.length>0&&scrolling.states.every(s=>s==='paused'),'scroll should pause all visible glass animations');
 await page.waitForTimeout(250);
 const after=await page.evaluate(()=>({
  states:[...document.querySelectorAll('.auto-car.auto-calc-inview .auto-calc-glint')].map(el=>getComputedStyle(el,'::before').animationPlayState),
  scrolling:document.documentElement.classList.contains('auto-calc-is-scrolling')
 }));
 assert.ok(!after.scrolling&&after.states.length>0&&after.states.every(s=>s==='running'),'visible reflection resumes after scroll idle');
 await page.screenshot({path:'awg-calc-scroll-performance-mobile.png',fullPage:false});
 console.log('AWG_CALC_SCROLL_BROWSER_TEST_PASSED',JSON.stringify({initial,scrolling,after,cardCount:45}));
}finally{await browser.close()}
