import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../public/auto-sale-process-responsive.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const base=readFileSync(new URL('../public/auto-sale.css',import.meta.url),'utf8');
const responsive=readFileSync(new URL('../public/auto-sale-responsive.css',import.meta.url),'utf8');
const desktop=readFileSync(new URL('../public/auto-sale-desktop-fluid.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/auto-sale-app-v3.mjs',import.meta.url),'utf8');

test('baseline: five process cards are hard-coded into an inflexible grid',()=>{
  assert.match(base,/\.auto-process\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(app,/function process\(\)\{const steps=\[/);
  const start=app.indexOf('function process(){const steps=[');
  const stop=app.indexOf('function carCard(',start);
  const markup=app.slice(start,stop);
  assert.match(markup,/Выкуп и доставка/);
  assert.match(markup,/steps\.map/);
  assert.match(markup,/class="auto-step"/);
});

test('compact desktop uses balanced 3+2 centered grid with no orphan fifth step',()=>{
  assert.match(css,/@media\s*\(min-width:901px\)\s*and\s*\(max-width:1550px\)/);
  assert.match(css,/\.auto-process-section \.auto-process\s*\{[^}]*repeat\(6,minmax\(0,1fr\)\)/s);
  assert.match(css,/\.auto-process-section \.auto-process>\.auto-step\s*\{[^}]*grid-column:span 2/s);
  assert.match(css,/\.auto-process-section \.auto-process>\.auto-step:nth-child\(4\)\s*\{[^}]*grid-column:2\/span 2/s);
  assert.match(css,/\.auto-process-section \.auto-process>\.auto-step:nth-child\(5\)\s*\{[^}]*grid-column:4\/span 2/s);
  assert.match(css,/font-size:clamp\(21px,1\.8vw,25px\)/);
});

test('styles only affect process cards on 901-1550px and preserve all adjacent views',()=>{
  assert.doesNotMatch(css,/100vw|overflow-x:hidden|overflow:hidden|!important/);
  assert.doesNotMatch(css,/(^|\s)\.auto-grid\b/);
  assert.doesNotMatch(css,/(^|\s)\.auto-bottom\b/);
  assert.match(responsive,/@media\(max-width:720px\)/);
  assert.match(base,/@media\(max-width:900px\)/);
  assert.match(base.slice(base.indexOf('@media(max-width:900px)')), /\.auto-process\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(base,/@media\(max-width:620px\)/);
  assert.match(base.slice(base.indexOf('@media(max-width:620px)')), /\.auto-process\{grid-template-columns:1fr\}/);
  assert.match(desktop,/@media\s*\(min-width:1025px\)/);
});

test('process CSS loads last after desktop and mobile CSS without disturbing existing app',()=>{
  const order=['auto-sale.css?v=20261028-required-deposit-v1',
    'auto-sale-responsive.css?v=20260926-calc-cta-v1',
    'auto-sale-desktop-fluid.css?v=20261015-fluid-v1',
    'auto-sale-process-responsive.css?v=20261015-process-v2'];
  let last=-1;
  for(const path of order){
    const index=html.indexOf(path);
    assert.ok(index>last,'CSS loading order invalid for '+path);
    last=index;
  }
  assert.match(html,/auto-sale-bootstrap\.mjs\?v=20261028-required-deposit-v1/);
  assert.match(html,/auto-sale-scroll-top\.mjs\?v=20261015-scrolltop-v1/);
});

test('Cyrillic titles have enough line-height to avoid glyph clipping at all widths',()=>{
  assert.match(css,/\.auto-process-section \.auto-process \.auto-step b\s*\{[^}]*line-height:1\.34;/s);
});
