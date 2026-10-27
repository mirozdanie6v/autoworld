import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../public/auto-sale-desktop-fluid.css',import.meta.url),'utf8');
const base=readFileSync(new URL('../public/auto-sale.css',import.meta.url),'utf8');
const responsive=readFileSync(new URL('../public/auto-sale-responsive.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('desktop fills available viewport, overriding the historical 1180px cap',()=>{
  assert.match(base,/\.auto-shell\{max-width:1180px;/,'audit baseline must remain explicit');
  assert.match(css,/@media\s*\(min-width:\s*1025px\)/);
  assert.match(css,/\.auto-shell\s*\{[^}]*width:100%;[^}]*max-width:none;[^}]*margin-inline:0;/s);
  assert.match(css,/padding-inline:clamp\(20px,2\.5vw,56px\)/);
  assert.doesNotMatch(css,/100vw/,'avoid overflow from 100vw with visible scrollbar');
});

test('the catalog grows to 4–5 columns at wide desktop without breaking cards',()=>{
  assert.match(base,/\.auto-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.auto-grid\s*\{[^}]*repeat\(auto-fit,minmax\(min\(100%,300px\),1fr\)\)/s);
});

test('tablet, mobile, bottom navbar and safe-area rules are unchanged',()=>{
  assert.match(responsive,/@media\(max-width:900px\)/);
  assert.match(responsive,/@media\(max-width:720px\)/);
  assert.match(responsive,/@media\(max-width:480px\)/);
  assert.match(responsive,/\.auto-bottom\.manager-five/);
  assert.doesNotMatch(css,/(?:^|[\s])\.auto-bottom|(?:^|[\s])\.auto-topbar/);
  assert.doesNotMatch(css,/(?:^|[\s])body\s*\{[^}]*overflow-x:\s*hidden/s);
});

test('vertical scrollbar stays scrollable and visually blends with dark canvas',()=>{
  assert.match(css,/scrollbar-color:#344154 #07090c/);
  assert.match(css,/html::-webkit-scrollbar-track\s*\{\s*background:#07090c;/);
  assert.doesNotMatch(css,/scrollbar-width:none|display:none/);
});

test('the new desktop stylesheet loads last, without losing previous nav and auth scripts',()=>{
  const existing=html.indexOf('auto-sale-scroll-top.css?v=20261015-scrolltop-v1');
  const desktop=html.indexOf('auto-sale-desktop-fluid.css?v=20261015-fluid-v1');
  const script=html.indexOf('auto-sale-bootstrap.mjs?v=20261027-order-advance50-v1');
  assert.ok(existing>=0&&desktop>existing&&script>desktop);
});
