import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync('index.html','utf8');
const base = fs.readFileSync('public/auto-sale-responsive.css','utf8');
const admin = fs.readFileSync('public/auto-sale-mobile-admin.css','utf8');
const clientBase = fs.readFileSync('public/auto-sale.css','utf8');

test('responsive hardening styles are loaded after base/admin styles',()=>{
  const basePos=index.indexOf('./auto-sale.css');
  const adminPos=index.indexOf('./auto-sale-admin.css');
  const responsivePos=index.indexOf('./auto-sale-responsive.css');
  const mobileAdminPos=index.indexOf('./auto-sale-mobile-admin.css');
  assert.ok(basePos>=0 && adminPos>basePos && responsivePos>adminPos && mobileAdminPos>responsivePos);
});

test('mobile navigation fits four role actions without horizontal scrolling',()=>{
  assert.match(base,/max-width:720px/);
  assert.match(base,/\.auto-bottom\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(base,/\.auto-bottom button\{min-width:0/);
  assert.match(base,/\.auto-role-switch\{[^}]*display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('mobile cards and modals prevent common narrow-screen overflow',()=>{
  assert.match(base,/overflow-x:clip/);
  assert.match(base,/\.auto-car-top,.auto-order-head\{display:grid;grid-template-columns:1fr/);
  assert.match(base,/max-height:calc\(100dvh - 8px\)/);
  assert.match(base,/\.auto-form input,.auto-form select,.auto-form textarea\{font-size:var\(--type-body\)\}/);
});

test('manager and director wide tables collapse into mobile cards',()=>{
  assert.match(admin,/\.auto-data-head\{display:none!important\}/);
  assert.match(admin,/min-width:0!important/);
  assert.match(admin,/\.auto-data-table\.finance/);
  assert.match(admin,/\.auto-data-table\.orders/);
  assert.match(admin,/content:'Себестоимость'/);
  assert.match(admin,/content:'ETA'/);
});

test('very narrow and landscape breakpoints are explicitly covered',()=>{
  assert.match(base,/max-width:380px/);
  assert.match(base,/max-width:340px/);
  assert.match(base,/orientation:landscape/);
});

test('safe areas cover all screen edges and iPhone landscape fields avoid zoom',()=>{
  assert.match(clientBase,/--safe-top:env\(safe-area-inset-top,0px\)/);
  assert.match(clientBase,/--safe-right:env\(safe-area-inset-right,0px\)/);
  assert.match(clientBase,/--safe-bottom:env\(safe-area-inset-bottom,0px\)/);
  assert.match(clientBase,/--safe-left:env\(safe-area-inset-left,0px\)/);
  assert.match(base,/max\(12px,var\(--safe-left\)\)/);
  assert.match(base,/orientation:landscape/);
  assert.match(base,/orientation:landscape[^}]*\}[\s\S]*?\.auto-form input,.auto-form select,.auto-form textarea\{font-size:var\(--type-body\)\}/);
});

test('mobile primary touch targets are at least 44px tall',()=>{
  assert.match(base,/\.auto-role-switch button\{min-width:0;min-height:44px/);
  assert.match(base,/\.auto-card-actions \.auto-btn\{width:100%;min-height:44px/);
  assert.match(base,/\.auto-brand\{min-height:44px\}/);
  assert.match(base,/\.auto-btn\.small\{min-height:44px\}/);
  assert.match(base,/\.auto-role-switch button,.auto-card-actions \.auto-btn,.auto-btn\.small\{min-height:44px\}/);
});

test('mobile brand fills the available header width',()=>{
  assert.match(base,/\.auto-brand\{width:100%;max-width:none\}/);
  assert.match(base,/\.auto-brand-image\{[^}]*display:block;width:100%;max-width:none;min-height:0\}/);
  assert.match(base,/\.auto-brand-logo\{display:block;width:100%;height:auto;max-height:none;object-fit:contain;object-position:center\}/);
});

