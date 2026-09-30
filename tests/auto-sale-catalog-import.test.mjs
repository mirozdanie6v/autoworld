import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=name=>readFile(new URL('../'+name,import.meta.url),'utf8');

test('catalog import uses a dedicated restricted credential',async()=>{
  const server=await root('server/yandex-server.mjs');
  assert.ok(server.includes('AUTO_SALE_CATALOG_IMPORT_KEY'));
  assert.ok(server.includes("x-auto-sale-catalog-import-key"));
  assert.ok(server.includes("/api/auto-sale/admin/catalog-import"));
  assert.ok(server.includes("unsupported_catalog_source"));
  assert.ok(server.includes("sourceName!=='AutoWorld_Georgia'"));
});

test('catalog import mutates normalized catalog entities only',async()=>{
  const server=await root('server/yandex-server.mjs');
  assert.ok(server.includes("resource:'catalog',operation:'create'"));
  assert.ok(server.includes("resource:'catalog',operation:'patch'"));
  assert.ok(server.includes("resource:'catalog',operation:'delete'"));
  assert.ok(server.includes('mutateAutoSaleEntityBatch'));
  assert.ok(!server.includes("AUTO_SALE_CATALOG_IMPORT_KEY=req.headers['x-auto-sale-key']"));
});

test('catalog scraper can upload new media with the restricted key',async()=>{
  const scraper=await root('scripts/scrape-autoworld-georgia.py');
  assert.ok(scraper.includes('AUTO_SALE_CATALOG_IMPORT_KEY'));
  assert.ok(scraper.includes('x-auto-sale-catalog-import-key'));
  assert.ok(scraper.includes('old.get("image")'));
  assert.ok(scraper.includes('old.get("otherPhotos"'));
});

test('catalog sync client never writes the legacy whole state endpoint',async()=>{
  const sync=await root('scripts/sync-autoworld-catalog.mjs');
  assert.ok(sync.includes('/api/auto-sale/admin/catalog-import'));
  assert.ok(sync.includes('x-auto-sale-catalog-import-key'));
  assert.ok(!sync.includes('/api/auto-sale/state'));
  assert.ok(!sync.includes("method:'PUT'"));
});
