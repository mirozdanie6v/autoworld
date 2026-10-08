import {JSDOM} from 'jsdom';

// Keep the document on awgcars.ru: absolute static URLs must not change /api,
// Telegram/VK launch parameters, fragment links, or the browser's local storage.
export function renderStaticEntry(html, releaseBase) {
  const base = new URL(releaseBase);
  if (base.protocol !== 'https:' || base.hostname !== 'storage.yandexcloud.net' ||
      !/^\/viiversion-autoworld-awg-static-[a-z0-9]+\/releases\/[a-f0-9]{40}\/$/.test(base.pathname) ||
      base.username || base.password || base.search || base.hash) {
    throw new Error('invalid_static_release_base');
  }
  const dom = new JSDOM(html);
  const document = dom.window.document;
  if (document.querySelector('base')) throw new Error('unexpected_document_base');
  for (const element of document.querySelectorAll('script[src], link[href]')) {
    const attribute = element.tagName === 'SCRIPT' ? 'src' : 'href';
    const value = element.getAttribute(attribute);
    if (!value.startsWith('./')) continue;
    const target = new URL(value, base);
    if (!target.pathname.startsWith(base.pathname)) throw new Error('static_path_escape');
    element.setAttribute(attribute, target.href);
    element.setAttribute('crossorigin', 'anonymous');
  }
  const preconnect = document.createElement('link');
  preconnect.rel = 'preconnect';
  preconnect.href = base.origin;
  preconnect.crossOrigin = 'anonymous';
  document.head.prepend(preconnect);
  for (const file of ['auto-sale-app-v3.mjs?v=20260929-entity-cutover-1', 'auto-sale-vk.mjs?v=20261008-vk-v3']) {
    const preload = document.createElement('link');
    preload.rel = 'modulepreload';
    preload.href = new URL(file, base).href;
    preload.crossOrigin = 'anonymous';
    document.head.append(preload);
  }
  const marker = document.createElement('meta');
  marker.name = 'auto-sale-static-release';
  marker.content = base.pathname;
  document.head.append(marker);
  const result = dom.serialize();
  dom.window.close();
  return result;
}

export function staticContentType(key) {
  const extension = key.split('.').at(-1).toLowerCase();
  return ({html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8', js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8', svg: 'image/svg+xml',
    webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    woff2: 'font/woff2'})[extension] || 'application/octet-stream';
}
