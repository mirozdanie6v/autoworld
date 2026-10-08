import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
const bootstrap=await readFile(new URL('../public/auto-sale-bootstrap.mjs',import.meta.url),'utf8');
const app=await readFile(new URL('../public/auto-sale-app-v3.mjs',import.meta.url),'utf8');
const gateway=await readFile(new URL('../infra/yandex/awg-production-gateway.yaml',import.meta.url),'utf8');
const deploy=await readFile(new URL('../.github/workflows/deploy-awg-production.yml',import.meta.url),'utf8');

test('critical HTML path excludes Telegram SDK, tracker and audit scripts',()=>{
  assert.equal(index.includes('https://telegram.org/js/telegram-web-app.js'),false);
  assert.equal(index.includes('dashboard.viiversion.com/tracker.js'),false);
  assert.equal(index.includes('auto-sale-layout-audit.js'),false);
  assert.equal(index.includes('auto-sale-api-audit.js'),false);
  assert.ok(index.includes('auto-startup-shell'));
});

test('bootstrap hydrates state asynchronously and loads Telegram only in Telegram context',()=>{
  assert.ok(bootstrap.includes('function telegramLaunchDetected()'));
  assert.ok(bootstrap.includes('async function ensureTelegramSdk()'));
  assert.ok(bootstrap.includes('const initialStatePromise=pullInitialState();'));
  assert.ok(bootstrap.includes('isolateBootstrapCache()'));
  assert.ok(bootstrap.includes('scheduleNonCriticalScripts()'));
  assert.ok(bootstrap.includes("window.dispatchEvent(new CustomEvent('auto-sale-server-synced'"));
});

test('app re-renders from authoritative server cache when hydration finishes',()=>{
  assert.ok(app.includes('function refreshRuntimeFromServer()'));
  assert.ok(app.includes("window.addEventListener('auto-sale-server-synced'"));
  assert.ok(app.includes('reloadFromCache();'));
  assert.ok(app.includes('hasAdminAccess=access.role===\'admin\''));
});

test('production gateway separates static frontend from API runtime',()=>{
  assert.ok(gateway.includes('type: object_storage'));
  assert.ok(gateway.includes('/api/{proxy+}:'));
  assert.ok(gateway.includes('type: serverless_containers'));
  assert.ok(gateway.includes('object: index.html'));
  assert.ok(gateway.includes("object: '{proxy}'"));
});

test('production deploy uploads static build before updating gateway routing',()=>{
  assert.ok(deploy.includes('Publish static frontend to Yandex Object Storage'));
  assert.ok(deploy.includes('yc storage s3 cp dist/'));
  assert.ok(deploy.includes('Route static frontend through Object Storage'));
  assert.ok(deploy.includes('yc serverless api-gateway update'));
  assert.ok(deploy.includes('AWG_STATIC_BUCKET'));
});
