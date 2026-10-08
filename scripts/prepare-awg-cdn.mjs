import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const folder = 'b1g8u8vqkgehvtbj8n13';
const bucket = 'viiversion-autoworld-awg-static-b1g8u8vqkgehvtbj8n13';
const release = 'e98fa766421f9fe97211d6aa3a8795114a38bf73';
const temp = process.env.RUNNER_TEMP;
assert.equal(process.env.YC_FOLDER_ID, folder);
assert.ok(process.env.YC_IAM_TOKEN && temp);
const plan = JSON.parse(await readFile(new URL('../infra/yandex/awg-cdn-plan.json', import.meta.url), 'utf8'));
assert.equal(plan.resource.cname, 'awgcars.ru');
assert.equal(plan.resource.folderId, folder);
assert.equal(plan.resource.origin.originSourceParams.meta.website.name, bucket);
let sequence = 0;
async function api(url, method = 'GET', body) {
  const file = path.join(temp, 'awg-cloud-' + sequence++);
  const args = ['-4', '-sS', '--connect-timeout', '10', '--max-time', '60', '-X', method,
    '-H', 'Authorization: Bearer ' + process.env.YC_IAM_TOKEN, '-H', 'Content-Type: application/json',
    '-o', file + '.response', '-w', '%{http_code}'];
  if (body) {
    await writeFile(file + '.request', JSON.stringify(body));
    args.push('--data-binary', '@' + file + '.request');
  }
  args.push(url);
  let result;
  try { result = await exec('curl', args, {timeout: 65000, maxBuffer: 100000}); }
  catch (error) { throw new Error('Cloud request transport failed: ' + (error.stderr || 'curl error')); }
  const json = JSON.parse(await readFile(file + '.response', 'utf8'));
  if (Number(result.stdout) >= 300) throw new Error(`${method} ${new URL(url).pathname}: HTTP ${result.stdout}: ${json.message || JSON.stringify(json)}`);
  return json;
}
async function operation(value) {
  if (!value.id || !Object.hasOwn(value, 'done')) return value;
  for (let attempt = 0; !value.done && attempt < 36; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    value = await api('https://operation.api.cloud.yandex.net/operations/' + value.id);
  }
  assert.ok(value.done, 'cloud operation did not complete');
  if (value.error) throw new Error('Cloud operation: ' + JSON.stringify(value.error));
  return value.response;
}
// Retry fresh REST credentials as a separate check from the CLI diagnostic.
try {
  const dns = await api('https://dns.api.cloud.yandex.net/dns/v1/zones/dnsblnbac98i1bk1n392:listRecordSets?pageSize=1000');
  console.log(JSON.stringify({dnsRecordAccess: 'verified', records: dns.recordSets.filter(x => ['A','AAAA','ANAME','CNAME','NS','SOA','CAA'].includes(x.type))}));
} catch (error) { console.log(JSON.stringify({dnsRecordAccess: 'blocked', error: error.message})); }
const cdn = 'https://cdn.api.cloud.yandex.net/cdn/v1';
let resource = (await api(cdn + '/resources?folderId=' + folder)).resources?.find(x => x.cname === plan.resource.cname);
if (resource) assert.equal(resource.labels?.managed_by, 'awg-direct-static', 'existing CDN resource must be reviewed before mutation');
await operation(await api('https://storage.api.cloud.yandex.net/storage/v1/buckets/' + bucket, 'PATCH', {
  updateMask: 'websiteSettings', websiteSettings: {index: 'index.html'},
}));
if (!resource) {
  resource = await operation(await api(cdn + '/resources', 'POST', {
    ...plan.resource, labels: {managed_by: 'awg-direct-static'},
  }));
}
console.log(JSON.stringify({cdnResource: resource.id, providerCname: resource.providerCname, sslCertificate: resource.sslCertificate}));
let group = (await api(cdn + '/originGroups?folderId=' + folder)).originGroups?.find(x => x.name === plan.apiOriginGroup.name);
if (!group) group = await operation(await api(cdn + '/originGroups', 'POST', {...plan.apiOriginGroup, providerType: 'ourcdn'}));
assert.equal(group.origins[0].source, plan.apiOriginGroup.origins[0].source);
const rules = (await api(cdn + '/rules?resourceId=' + resource.id)).rules || [];
// The CDN candidate uses a versioned HTML object, leaving the live gateway's
// index pointer intact until API and browser checks prove this route works.
const desiredRules = [
  {...plan.apiRule, resourceId: resource.id, originsGroupId: group.id},
  {...plan.htmlRule, resourceId: resource.id, options: {
    ...plan.htmlRule.options,
    rewrite: {enabled: true, body: '^/(?:index\\.html)?$ /releases/' + release + '/index.html', flag: 'LAST'},
  }},
];
for (const rule of desiredRules) {
  const existing = rules.find(x => x.name === rule.name);
  await operation(await api(cdn + '/rules' + (existing ? '/' + existing.id : ''), existing ? 'PATCH' : 'POST', rule));
  console.log(JSON.stringify({cdnRule: rule.name, originGroup: rule.originsGroupId || resource.originGroupId}));
}
resource = await api(cdn + '/resources/' + resource.id);
await writeFile(path.join(temp, 'awg-cdn-prepared.json'), JSON.stringify({resource, release, groupId: group.id}, null, 2));
console.log(JSON.stringify({cdnPrepared: true, resourceId: resource.id, providerCname: resource.providerCname, release, publicDnsChanged: false}));
