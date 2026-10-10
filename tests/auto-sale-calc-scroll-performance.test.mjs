import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {startAutoCalcScrollPerformance} from '../public/auto-sale-calc-scroll-performance.mjs';

const css=await readFile(new URL('../public/auto-sale-calc-scroll-performance.css',import.meta.url),'utf8');
const glass=await readFile(new URL('../public/auto-sale-calc-cta-v25.css',import.meta.url),'utf8');
const entry=await readFile(new URL('../index.html',import.meta.url),'utf8');
const bootstrap=await readFile(new URL('../public/auto-sale-bootstrap.mjs',import.meta.url),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const markup=n=>Array.from({length:n},(_,i)=>`<article class="auto-car" id="card-${i}"><div class="auto-card-actions"><button class="auto-btn primary auto-calc-btn" data-request-car="${i}"><span class="auto-calc-glint"></span><span class="auto-calc-label">Рассчитать</span></button></div></article>`).join('');

function setup(n=20){
  const dom=new JSDOM(`<!doctype html><html><body><main id="app">${markup(n)}</main></body></html>`,{url:'https://awgcars.ru/',pretendToBeVisual:true});
  const {window:win}=dom;
  let observer=null;
  class FakeIO{
    constructor(cb,options){this.cb=cb;this.options=options;this.targets=new Set();observer=this}
    observe(target){this.targets.add(target)}
    unobserve(target){this.targets.delete(target)}
    disconnect(){this.targets.clear()}
    emit(cards){this.cb(cards.map(([target,isIntersecting])=>({target,isIntersecting})))}
  }
  const controller=startAutoCalcScrollPerformance({win,doc:win.document,IntersectionObserverImpl:FakeIO,MutationObserverImpl:win.MutationObserver});
  assert.ok(controller);
  return{dom,win,controller,observer};
}

test('v25 button design remains source of truth; only animation sampling pauses',()=>{
  assert.ok(glass.includes('autoCalcPearlWaveV25'));
  assert.ok(glass.includes('autoCalcCounterGlassV25'));
  assert.ok(css.includes('animation-play-state:paused!important'));
  assert.ok(css.includes('animation-play-state:running!important'));
  assert.ok(css.includes('will-change:auto!important'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  for(const property of ['background:','box-shadow:','border-radius:','font-size:','padding:'])assert.ok(!css.includes(property),'perf layer must not change button appearance: '+property);
  assert.ok(entry.includes('auto-sale-calc-cta-v25.css'));
  assert.ok(entry.includes('auto-sale-calc-scroll-performance.css?v=20261010-scroll-v1'));
  assert.ok(bootstrap.includes("await import('./auto-sale-calc-scroll-performance.mjs?v=20261010-scroll-v1')"));
  assert.ok(entry.includes('auto-sale-bootstrap.mjs?v=20261010-scroll-v1'));
});

test('only intersecting catalog cards may animate, regardless of catalog size',()=>{
  const {dom,win,controller,observer}=setup(125);
  assert.equal(observer.targets.size,125);
  assert.equal(observer.options.threshold,0);
  assert.ok(win.document.documentElement.classList.contains('auto-calc-perf-ready'));
  const cards=[...win.document.querySelectorAll('.auto-car')];
  observer.emit([[cards[0],true],[cards[1],true],[cards[2],false],[cards[124],false]]);
  assert.equal(controller.getStats().visible,2);
  assert.ok(cards[0].classList.contains('auto-calc-inview'));
  assert.ok(!cards[124].classList.contains('auto-calc-inview'));
  observer.emit([[cards[0],false],[cards[3],true]]);
  assert.equal(controller.getStats().visible,2);
  controller.stop();dom.window.close();
});

test('scroll pauses catalog animation without a per-card loop, then restores at idle',async()=>{
  const {dom,win,controller,observer}=setup(20);
  const card=win.document.getElementById('card-0');
  observer.emit([[card,true]]);
  assert.equal(controller.getStats().scrolling,false);
  win.dispatchEvent(new win.Event('scroll'));
  assert.equal(controller.getStats().scrolling,true);
  await wait(60);
  win.dispatchEvent(new win.Event('scroll'));
  await wait(130);
  assert.equal(controller.getStats().scrolling,true,'debounce extends across repeated scroll events');
  await wait(110);
  assert.equal(controller.getStats().scrolling,false);
  controller.stop();
  assert.ok(!win.document.documentElement.classList.contains('auto-calc-perf-ready'));
  dom.window.close();
});

test('catalog SPA rerenders are watched without leaking old card targets',async()=>{
  const {dom,win,controller,observer}=setup(5);
  const first=win.document.getElementById('card-0');
  observer.emit([[first,true]]);
  win.document.getElementById('app').innerHTML=markup(9);
  await wait(80);
  assert.equal(observer.targets.size,9);
  assert.equal(controller.getStats().tracked,9);
  assert.equal(controller.getStats().visible,0);
  assert.ok(!first.classList.contains('auto-calc-inview'));
  controller.stop();
  assert.equal(observer.targets.size,0);
  dom.window.close();
});

test('unsupported observer has safe legacy fallback without intercepting catalog actions',()=>{
  const dom=new JSDOM('<div id="app"></div>',{url:'https://awgcars.ru/'});
  const controller=startAutoCalcScrollPerformance({win:dom.window,doc:dom.window.document,IntersectionObserverImpl:null,MutationObserverImpl:dom.window.MutationObserver});
  assert.equal(controller,null);
  assert.ok(!dom.window.document.documentElement.classList.contains('auto-calc-perf-ready'));
  dom.window.close();
});
