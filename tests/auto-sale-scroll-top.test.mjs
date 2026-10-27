import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {initializeScrollTop} from '../public/auto-sale-scroll-top.mjs';

function createPage(url='https://awgcars.ru/'){
  const dom=new JSDOM('<!doctype html><html><body><div id="app"><nav class="auto-bottom"></nav></div></body></html>',{url});
  const {window}=dom;
  let offset=0;
  Object.defineProperty(window,'scrollY',{get:()=>offset,configurable:true});
  const scrollCalls=[];
  window.scrollTo=options=>{
    scrollCalls.push(options);
    if(options.top===0){offset=0;window.dispatchEvent(new window.Event('scroll'))}
  };
  return {
    window,doc:window.document,dom,scrollCalls,
    setScroll(y){offset=y;window.dispatchEvent(new window.Event('scroll'))},
    close(){dom.window.close()}
  };
}

test('Scroll-to-top control is unique, hidden near top and keyboard-accessible after scrolling',()=>{
  const page=createPage();
  try{
    const a=initializeScrollTop(page.window,page.doc);
    const b=initializeScrollTop(page.window,page.doc);
    assert.equal(a,b,'rerenders must never create a duplicate button');
    assert.equal(page.doc.querySelectorAll('#autoScrollTop').length,1);
    assert.equal(a.parentElement,page.doc.body,'outside application root to survive re-render');
    assert.equal(a.type,'button');
    assert.equal(a.getAttribute('aria-label'),'Прокрутить наверх');
    assert.equal(a.getAttribute('aria-hidden'),'true');
    assert.equal(a.tabIndex,-1);
    assert.equal(a.classList.contains('is-visible'),false);

    page.setScroll(420);
    assert.equal(a.classList.contains('is-visible'),false,'threshold is exclusive');
    page.setScroll(480);
    assert.equal(a.classList.contains('is-visible'),true);
    assert.equal(a.getAttribute('aria-hidden'),'false');
    assert.equal(a.tabIndex,0);
    a.click();
    assert.deepEqual(page.scrollCalls,[{top:0,behavior:'smooth'}]);
    assert.equal(a.classList.contains('is-visible'),false);
    assert.equal(a.tabIndex,-1);
  }finally{page.close()}
});

test('Scroll-to-top honors reduced motion and document scroll offset on mini app',()=>{
  const page=createPage('https://awgcars.ru/?vk_app_id=54810434&vk_user_id=42&sign=fake');
  try{
    page.window.matchMedia=()=>({matches:true});
    const button=initializeScrollTop(page.window,page.doc);
    page.doc.documentElement.scrollTop=600;
    page.window.dispatchEvent(new page.window.Event('scroll'));
    assert.equal(button.classList.contains('is-visible'),true);
    button.click();
    assert.deepEqual(page.scrollCalls,[{top:0,behavior:'instant'}]);
  }finally{page.close()}
});

test('Frosted glass styling stays above fixed bottom tabs, respects safe areas and dialogs',()=>{
  const css=readFileSync(new URL('../public/auto-sale-scroll-top.css',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(css,/backdrop-filter:blur\(/);
  assert.match(css,/background:linear-gradient\([^;]*rgba\(/);
  assert.match(css,/env\(safe-area-inset-bottom,0px\)/);
  assert.match(css,/bottom:calc\(104px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(css,/z-index:55/);
  assert.match(css,/body:has\(\.auto-modal-bg/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/focus-visible/);
  assert.match(html,/auto-sale-scroll-top\.css\?v=20261015-scrolltop-v1/);
  assert.match(html,/auto-sale-scroll-top\.mjs\?v=20261015-scrolltop-v1/);
  assert.match(html,/auto-sale-bootstrap\.mjs\?v=20261027-source-price-v3/,
    'do not disturb existing Mini App auth and notification scripts');
});
