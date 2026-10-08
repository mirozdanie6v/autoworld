import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(path.join(process.env.AWG_PLAYWRIGHT_DIR, 'package.json'));
const {chromium} = require('playwright');
const url = process.env.AWG_SMOKE_URL || 'https://awgcars.ru/';
const stagedHtml = process.env.AWG_SMOKE_ENTRY_FILE ? await readFile(process.env.AWG_SMOKE_ENTRY_FILE, 'utf8') : null;
const args = ['--no-sandbox'];
if (process.env.AWG_CDN_IP) {
  assert.match(process.env.AWG_CDN_IP, /^\d{1,3}(?:\.\d{1,3}){3}$/);
  args.push('--host-resolver-rules=MAP awgcars.ru ' + process.env.AWG_CDN_IP + ', MAP www.awgcars.ru ' + process.env.AWG_CDN_IP);
}
const browser = await chromium.launch({executablePath: process.env.AWG_CHROME_BIN, args, headless: true});
try {
  for (const [name, viewport] of [['desktop', {width: 1280, height: 800}], ['mobile', {width: 390, height: 844}]]) {
    const context = await browser.newContext({viewport});
    const page = await context.newPage();
    const errors = [];
    const staticTtfbMs = [];
    page.on('requestfinished', request => {
      if (['script', 'stylesheet'].includes(request.resourceType()) && request.url().includes('storage.yandexcloud.net/')) {
        const timing = request.timing();
        if (timing.requestStart >= 0 && timing.responseStart >= timing.requestStart) staticTtfbMs.push(Math.round(timing.responseStart - timing.requestStart));
      }
    });
    page.on('response', response => {
      const request = response.request();
      if (!['script', 'stylesheet'].includes(request.resourceType()) || !response.url().includes('storage.yandexcloud.net/')) return;
      const type = response.headers()['content-type'] || '';
      const expected = request.resourceType() === 'script' ? 'javascript' : 'text/css';
      if (response.status() !== 200 || !type.includes(expected)) errors.push(response.url() + ': HTTP/MIME mismatch');
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => {
      if (['script', 'stylesheet'].includes(request.resourceType()) && request.url().includes('storage.yandexcloud.net/')) {
        errors.push(request.url() + ': ' + request.failure()?.errorText);
      }
    });
    if (stagedHtml) {
      // Stage only the entry document under the real app origin. Storage/CORS
      // and /api requests still use the actual production servers.
      await page.route(requestUrl => requestUrl.href === new URL(url).href,
        route => route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: stagedHtml}));
    }
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 45000});
    await page.locator('#app .auto-shell').waitFor({state: 'visible', timeout: 45000});
    assert.equal(await page.locator('.auto-startup-shell').count(), 0, 'startup shell did not resolve');
    const report = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource');
      const staticResources = resources.filter(x => x.name.includes('storage.yandexcloud.net/') && /\.(m?js|css)(\?|$)/.test(x.name));
      return {
        uiReadyMs: Math.round(performance.now()),
        fcpMs: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0),
        directStaticCount: staticResources.length,
        gatewayStaticCount: resources.filter(x => new URL(x.name).origin === location.origin && /\.(m?js|css)(\?|$)/.test(x.name)).length,
        release: document.querySelector('meta[name="auto-sale-static-release"]')?.content,
      };
    });
    assert.ok(report.directStaticCount >= 10, 'critical modules/styles did not load directly');
    assert.equal(report.gatewayStaticCount, 0, 'critical JS/CSS still use the gateway');
    if (process.env.GITHUB_SHA) assert.ok(report.release?.includes('/releases/' + process.env.GITHUB_SHA + '/'), 'unexpected production static release');
    await page.locator('button[data-go="catalog"]').first().click();
    await page.locator('#app .auto-shell').waitFor({state: 'visible'});
    assert.deepEqual(errors, [], 'browser script or CORS errors');
    console.log(JSON.stringify({browserSmoke: name, staged: Boolean(stagedHtml), ...report, staticTtfbMs}));
    await context.close();
  }
} finally {
  await browser.close();
}
