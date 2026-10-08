import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve4} from 'node:dns/promises';
import path from 'node:path';

const exec = promisify(execFile);
const temp = process.env.RUNNER_TEMP;
const prepared = JSON.parse(await readFile(path.join(temp, 'awg-cdn-prepared.json'), 'utf8'));
const target = prepared.resource.providerCname;
assert.match(target, /^[a-f0-9]+\.topology\.gslb\.yccdn\.ru$/);
const ip = (await resolve4(target))[0];
let sequence = 0;
async function request(route, method = 'GET', headers = []) {
  const file = path.join(temp, 'awg-cdn-smoke-' + sequence++);
  const args = ['-4', '-sS', '--connect-timeout', '8', '--max-time', '15',
    '--connect-to', 'awgcars.ru:443:' + target + ':443', '-X', method,
    '-D', file + '.headers', '-o', file + '.body', '-w', '%{http_code} %{time_starttransfer} %{time_connect} %{time_appconnect}'];
  for (const header of headers) args.push('-H', header);
  args.push('https://awgcars.ru' + route);
  let output;
  try { output = (await exec('curl', args, {timeout: 20000})).stdout; }
  catch (error) { return {status: 0, error: String(error.stderr), body: '', headers: new Map()}; }
  const [status, ttfb, tcp, tls] = output.trim().split(/\s+/).map(Number);
  const responseHeaders = new Map((await readFile(file + '.headers', 'utf8')).split(/\r?\n/).filter(line => line.indexOf(':') > 0).map(line => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
  return {status, ttfbMs: Math.round(ttfb * 1000), tcpMs: Math.round(tcp * 1000), tlsMs: Math.round(tls * 1000), body: await readFile(file + '.body', 'utf8'), headers: responseHeaders};
}
let root;
for (let attempt = 0; attempt < 24; attempt++) {
  root = await request('/');
  if (root.status === 200 && root.body.includes('/releases/' + prepared.release + '/')) break;
  console.log(JSON.stringify({cdnPropagation: attempt + 1, status: root.status, error: root.error}));
  if (attempt < 23) await new Promise(resolve => setTimeout(resolve, 10000));
}
assert.equal(root.status, 200, 'CDN HTML HTTP status');
assert.ok(root.headers.get('content-type')?.includes('text/html'), 'CDN HTML MIME');
assert.ok(root.body.includes('/releases/' + prepared.release + '/'), 'CDN must serve candidate release HTML');
console.log(JSON.stringify({cdnHtml: 'verified', target, ip, ttfbMs: root.ttfbMs, cacheControl: root.headers.get('cache-control')}));
const {stdout, stderr} = await exec(process.execPath, [path.resolve('scripts/smoke-awg-browser.mjs')], {
  env: {...process.env, GITHUB_SHA: prepared.release, AWG_CDN_IP: ip, AWG_SMOKE_ENTRY_FILE: '', AWG_SMOKE_URL: 'https://awgcars.ru/'}, timeout: 180000, maxBuffer: 2_000_000,
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
const issues = [];
for (const [route, method, headers] of [
  ['/api/health', 'GET', []],
  ['/api/auto-sale/state', 'GET', []],
  ['/api/auto-sale/vk/config', 'GET', []],
  ['/api/auto-sale/nonexistent-cdn-probe', 'OPTIONS', ['Origin: https://awgcars.ru', 'Access-Control-Request-Method: POST', 'Access-Control-Request-Headers: content-type,x-vk-launch-params,x-telegram-init-data']],
  ...['POST', 'PUT', 'PATCH', 'DELETE'].map(method => ['/api/auto-sale/nonexistent-cdn-probe', method, ['Content-Type: application/json']]),
]) {
  const response = await request(route, method, headers);
  let body;
  try { body = JSON.parse(response.body); } catch {}
  const report = {cdnApi: method + ' ' + route, status: response.status, ttfbMs: response.ttfbMs, cacheControl: response.headers.get('cache-control'), error: response.error};
  if (route === '/api/health') {
    report.backend = {buildSha: body?.buildSha, vkAuth: body?.vkAuth, vkMessaging: body?.vkMessaging};
    if (response.status !== 200 || !body?.ok || body.buildSha !== 'd7ab181874e62feae1891abdd34b2e225b925de6' || body.vkAuth !== 'enabled' || body.vkMessaging !== 'enabled') issues.push('API health/revision/features');
  } else if (route.endsWith('/state')) {
    if (response.status !== 200 || body?._access?.role !== 'public' || !['leads','quotes','orders','team'].every(key => body[key]?.length === 0)) issues.push('anonymous state boundary');
  } else if (route.endsWith('/vk/config')) {
    if (response.status !== 200 || body?.enabled !== true || body?.messagingEnabled !== true) issues.push('VK config');
  } else if (method === 'OPTIONS') {
    if (response.status !== 204 || !response.headers.get('access-control-allow-headers')?.includes('x-vk-launch-params')) issues.push('API preflight');
  } else if (response.status !== 404 || body?.error !== 'not_found') issues.push(method + ' API routing');
  if (!response.headers.get('cache-control')?.includes('no-store')) issues.push(method + ' API no-store');
  if (Number(response.headers.get('age') || 0) > 0) issues.push(method + ' API was cached');
  console.log(JSON.stringify(report));
}
assert.deepEqual(issues, [], 'CDN API gate failed; keep production DNS unchanged');
console.log(JSON.stringify({cdnSmoke: 'verified', resourceId: prepared.resource.id, publicDnsChanged: false}));
