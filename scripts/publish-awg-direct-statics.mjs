import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {renderStaticEntry, staticContentType} from './render-awg-static-entry.mjs';

const exec = promisify(execFile);
const bucket = process.env.AWG_STATIC_BUCKET;
const release = process.env.GITHUB_SHA;
const appUrl = 'https://awgcars.ru/';
assert.equal(bucket, 'viiversion-autoworld-awg-static-b1g8u8vqkgehvtbj8n13', 'only the dedicated AWG frontend bucket can be published');
assert.match(release, /^[a-f0-9]{40}$/);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const temp = process.env.RUNNER_TEMP;
assert.ok(temp, 'RUNNER_TEMP is required for rollback files');
const base = `https://storage.yandexcloud.net/${bucket}/releases/${release}/`;
const stagedEntry = path.join(temp, 'awg-direct-index.html');
const backup = path.join(temp, 'awg-index-before-direct.html');

async function yc(...args) {
  const {stdout} = await exec('yc', args, {timeout: 90000, maxBuffer: 2_000_000});
  return stdout;
}
async function copy(from, key, cache) {
  await yc('storage', 's3', 'cp', from, `s3://${bucket}/${key}`,
    '--content-type', staticContentType(key), '--cache-control', cache, '--only-show-errors');
}
let probeSequence = 0;
async function request(url, origin) {
  const output = path.join(temp, 'awg-static-probe-' + probeSequence++);
  const args = ['-4', '-L', '-sS', '--connect-timeout', '10', '--max-time', '30',
    '--retry', '2', '--retry-all-errors', '--retry-delay', '1',
    '-D', output + '.headers', '-o', output + '.body', '-w', '%{http_code} %{time_starttransfer}'];
  if (origin) args.push('-H', 'Origin: ' + origin);
  args.push(url);
  const {stdout} = await exec('curl', args, {timeout: 110000, maxBuffer: 100000});
  const [status, ttfb] = stdout.trim().split(/\s+/).slice(-2);
  const headers = new Map((await readFile(output + '.headers', 'utf8')).split(/\r?\n/)
    .filter(line => line.indexOf(':') > 0)
    .map(line => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
  return {status: Number(status), ttfbMs: Math.round(Number(ttfb) * 1000), headers, body: await readFile(output + '.body', 'utf8')};
}
async function health() {
  const response = await request(appUrl + 'api/health');
  assert.equal(response.status, 200, 'production API health status');
  const json = JSON.parse(response.body);
  assert.equal(json.ok, true);
  assert.equal(json.vkAuth, 'enabled', 'VK auth must remain enabled');
  assert.equal(json.vkMessaging, 'enabled', 'VK notifications must remain enabled');
  return {buildSha: json.buildSha, vkAuth: json.vkAuth, vkMessaging: json.vkMessaging};
}
await yc('storage', 's3', 'cp', `s3://${bucket}/index.html`, backup, '--only-show-errors');
await copy(backup, `rollbacks/${release}/index.html`, 'no-cache, no-store, must-revalidate');
const files = (await readdir(dist, {recursive: true, withFileTypes: true})).filter(x => x.isFile()).map(x => path.join(x.parentPath, x.name));
let cursor = 0;
await Promise.all(Array.from({length: 8}, async () => {
  while (cursor < files.length) {
    const file = files[cursor++];
    const key = path.relative(dist, file).split(path.sep).join('/');
    if (key === 'index.html') continue;
    await copy(file, `releases/${release}/${key}`, 'public, max-age=31536000, immutable');
  }
}));
await writeFile(stagedEntry, renderStaticEntry(await readFile(path.join(dist, 'index.html'), 'utf8'), base));
await copy(stagedEntry, `releases/${release}/index.html`, 'no-cache, no-store, must-revalidate');
await yc('storage', 'bucket', 'update', '--name', bucket,
  '--public-read', '--public-list=false', '--public-config-read=false',
  '--cors', 'allowed-methods=[method-get,method-head],allowed-origins=[*],allowed-headers=[*],expose-headers=[ETag,Content-Type,Cache-Control],max-age-seconds=3600');

// Probe actual CORS and MIME from the app origin before touching the entrypoint.
for (const [file, type] of [['auto-sale-bootstrap.mjs', 'javascript'], ['auto-sale-app-v3.mjs', 'javascript'], ['auto-sale.css', 'text/css']]) {
  let response;
  for (let attempt = 0; attempt < 12; attempt++) {
    response = await request(base + file, appUrl.slice(0, -1));
    if (response.status === 200 && response.headers.get('access-control-allow-origin') === '*') break;
    if (attempt < 11) {
      console.log(JSON.stringify({waitingForStaticCors: file, attempt: attempt + 1}));
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  assert.equal(response.status, 200, file);
  assert.ok(response.headers.get('content-type')?.includes(type), file + ' MIME');
  assert.equal(response.headers.get('access-control-allow-origin'), '*', file + ' CORS');
  assert.ok(response.headers.get('cache-control')?.includes('immutable'), file + ' immutable cache');
  const content = response.body;
  assert.ok(content.length > 100, file + ' body');
  console.log(JSON.stringify({directStaticProbe: file, ttfbMs: response.ttfbMs, contentType: response.headers.get('content-type')}));
}
const smokeScript = path.join(root, 'scripts', 'smoke-awg-browser.mjs');
async function smoke(entryFile) {
  const {stdout, stderr} = await exec(process.execPath, [smokeScript], {env: {...process.env, AWG_SMOKE_URL: appUrl, AWG_SMOKE_ENTRY_FILE: entryFile || ''}, timeout: 180000, maxBuffer: 2_000_000});
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}
await smoke(stagedEntry);
// Static staging is independently reviewable even if the old gateway is down.
// Require live API health immediately before moving the production pointer.
const before = await health();
let switched = false;
try {
  // The root HTML is the sole mutable pointer; assets are already immutable.
  // Set the rollback guard before the write in case the upload result is ambiguous.
  switched = true;
  await copy(stagedEntry, 'index.html', 'no-cache, no-store, must-revalidate');
  await smoke();
  const after = await health();
  assert.deepEqual(after, before, 'backend revision/features changed during static-only deployment');
  const response = await request(appUrl + 'api/auto-sale/state');
  assert.equal(response.status, 200);
  const state = JSON.parse(response.body);
  assert.equal(state._access?.role, 'public');
  for (const key of ['leads', 'quotes', 'orders', 'team']) assert.equal(state[key]?.length, 0, 'public state boundary: ' + key);
  console.log(JSON.stringify({directStaticDeployment: 'verified', release, backend: after, rollbackKey: `rollbacks/${release}/index.html`}));
} catch (error) {
  if (switched) {
    await copy(backup, 'index.html', 'no-cache, no-store, must-revalidate');
    console.error('Restored previous production entrypoint after failed direct-static smoke');
  }
  throw error;
}
