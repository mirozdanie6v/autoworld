import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {renderStaticEntry, staticContentType} from '../scripts/render-awg-static-entry.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const base = 'https://storage.yandexcloud.net/viiversion-autoworld-awg-static-b1g8u8vqkgehvtbj8n13/releases/' + 'a'.repeat(40) + '/';

test('all startup scripts/styles are immutable direct-storage URLs without changing document origin', () => {
  const dom = new JSDOM(renderStaticEntry(html, base), {url: 'https://awgcars.ru/?vk_app_id=1&vk_user_id=2&sign=test'});
  const doc = dom.window.document;
  assert.equal(doc.querySelector('base'), null);
  for (const el of doc.querySelectorAll('script[src],link[rel="stylesheet"]')) {
    const url = el.getAttribute(el.tagName === 'SCRIPT' ? 'src' : 'href');
    assert.ok(url.startsWith(base), url);
    assert.equal(el.getAttribute('crossorigin'), 'anonymous');
  }
  assert.equal(new URL('/api/auto-sale/state', doc.baseURI).href, 'https://awgcars.ru/api/auto-sale/state');
  assert.equal(dom.window.location.search, '?vk_app_id=1&vk_user_id=2&sign=test');
  assert.equal(new URL('./auto-sale-vk.mjs', doc.querySelector('script[type="module"]').src).origin, 'https://storage.yandexcloud.net');
  assert.equal(doc.querySelectorAll('link[rel="modulepreload"]').length, 2);
  assert.ok(doc.querySelector('.auto-startup-shell'));
  dom.window.close();
});

test('static entry cannot redirect assets to arbitrary hosts or escape the release directory', () => {
  for (const unsafe of [base.replace('https:', 'http:'), base.replace('storage.yandexcloud.net', 'evil.example'), base.replace('/releases/', '/other/'), base + '?token=secret']) {
    assert.throws(() => renderStaticEntry(html, unsafe), /invalid_static_release_base/);
  }
  assert.throws(() => renderStaticEntry('<script src="./../escape.mjs"></script>', base), /static_path_escape/);
  assert.throws(() => renderStaticEntry('<base href="https://evil.example">', base), /unexpected_document_base/);
});

test('module and stylesheet MIME types remain browser compatible', () => {
  assert.match(staticContentType('auto-sale-bootstrap.mjs'), /^text\/javascript/);
  assert.match(staticContentType('auto-sale.css'), /^text\/css/);
  assert.match(staticContentType('index.html'), /^text\/html/);
  assert.equal(staticContentType('auto-sale-logo.webp'), 'image/webp');
});

test('future CDN API routing cannot cache client data or loop back to the public domain', async () => {
  const config = JSON.parse(await readFile(new URL('../infra/yandex/awg-cdn-plan.json', import.meta.url), 'utf8'));
  const match = new RegExp(config.apiRule.rulePattern);
  for (const route of ['/api', '/api/health', '/api/auto-sale/state', '/api/auto-sale/leads/123']) assert.equal(match.test(route), true);
  for (const route of ['/', '/auto-sale-bootstrap.mjs', '/apiary']) assert.equal(match.test(route), false);
  assert.equal(config.apiRule.options.disableCache.value, true);
  assert.equal(config.apiRule.options.staticHeaders.value['Cache-Control'], 'private, no-store');
  assert.ok(config.apiRule.options.allowedHttpMethods.value.includes('POST'));
  assert.ok(config.apiRule.options.allowedHttpMethods.value.includes('OPTIONS'));
  assert.equal(config.apiRule.options.hostOptions.host.value, config.apiOriginGroup.origins[0].source);
  assert.notEqual(config.apiOriginGroup.origins[0].source, config.resource.cname);
  assert.equal(config.htmlRule.options.disableCache.value, true);
});
