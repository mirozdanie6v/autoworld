import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveNs, resolve4, resolveCname} from 'node:dns/promises';

const exec = promisify(execFile);
const folder = process.env.YC_FOLDER_ID;
async function yc(args) {
  try {
    const {stdout} = await exec('yc', [...args, '--format', 'json'], {timeout: 45000, maxBuffer: 2_000_000});
    return JSON.parse(stdout);
  } catch (error) {
    return {error: String(error.stderr || error.message).slice(0, 1200)};
  }
}
const results = await Promise.allSettled([
  yc(['dns', 'zone', 'list', '--folder-id', folder]),
  yc(['certificate-manager', 'certificate', 'list', '--folder-id', folder]),
  yc(['cdn', 'resource', 'list', '--folder-id', folder]),
  yc(['serverless', 'api-gateway', 'get', '--name', process.env.AWG_GATEWAY_NAME, '--folder-id', folder]),
  yc(['storage', 'bucket', 'get', '--name', process.env.AWG_STATIC_BUCKET]),
  yc(['resource-manager', 'folder', 'list-access-bindings', folder]),
]);
const names = ['dnsZones', 'certificates', 'cdnResources', 'gateway', 'staticBucket', 'deployRoles'];
for (let i = 0; i < results.length; i++) {
  const result = results[i];
  let value = result.status === 'fulfilled' ? result.value : {error: result.reason.message};
  if (i === 5 && Array.isArray(value)) value = value.filter(x => x.subject?.id === process.env.YC_DEPLOY_SA_ID);
  console.log(JSON.stringify({section: names[i], value}));
}
const zones = results[0].status === 'fulfilled' ? results[0].value : [];
for (const zone of Array.isArray(zones) ? zones : []) {
  const records = await yc(['dns', 'zone', 'list-records', '--id', zone.id]);
  console.log(JSON.stringify({section: 'dnsRecords', zone: zone.id, value: Array.isArray(records) ? records.filter(x => ['A', 'AAAA', 'ANAME', 'CNAME', 'NS', 'CAA', 'SOA'].includes(x.type)) : records}));
}
for (const [name, fn] of [['NS', resolveNs], ['A', resolve4], ['CNAME', resolveCname]]) {
  try { console.log(JSON.stringify({section: 'publicDns', name, value: await fn('awgcars.ru')})); }
  catch (error) { console.log(JSON.stringify({section: 'publicDns', name, error: error.code})); }
}

const container = await yc(['serverless', 'container', 'get', '--name', process.env.YC_CONTAINER_NAME, '--folder-id', folder]);
console.log(JSON.stringify({section: 'container', value: {id: container.id, url: container.url, name: container.name, status: container.status, error: container.error}}));
if (container.id) {
  const revisions = await yc(['serverless', 'container', 'revision', 'list', '--container-id', container.id]);
  console.log(JSON.stringify({section: 'containerRevisions', value: Array.isArray(revisions) ? revisions.map(x => ({id: x.id, status: x.status, created_at: x.created_at, image: x.image?.image_url, concurrency: x.concurrency, execution_timeout: x.execution_timeout})) : revisions}));
}
const gateway = results[3].value;
const probes = [
  {name: 'custom-root-get', url: 'https://awgcars.ru/'},
  {name: 'custom-health', url: 'https://awgcars.ru/api/health'},
  {name: 'custom-root-head', url: 'https://awgcars.ru/', head: true},
  {name: 'gateway-root-get', url: 'https://' + gateway.domain + '/'},
  {name: 'gateway-health', url: 'https://' + gateway.domain + '/api/health'},
  {name: 'www-root-get', url: 'https://www.awgcars.ru/'},
  {name: 'storage-private-object', url: 'https://storage.yandexcloud.net/' + process.env.AWG_STATIC_BUCKET + '/index.html'},
];
if (container.url) probes.push({name: 'container-health', url: container.url.replace(/\/$/, '') + '/api/health', authorized: true});
await Promise.all(probes.map(async probe => {
  const args = ['-4', '-sS', '--connect-timeout', '8', '--max-time', '20', '-o', '/dev/null', '-w', '%{http_code} %{time_starttransfer} %{time_total} %{remote_ip}'];
  if (probe.head) args.push('-I');
  if (probe.authorized) args.push('-H', 'Authorization: Bearer ' + process.env.YC_IAM_TOKEN);
  args.push(probe.url);
  try {
    const {stdout} = await exec('curl', args, {timeout: 25000});
    console.log(JSON.stringify({section: 'networkProbe', name: probe.name, result: stdout}));
  } catch (error) {
    // Do not print child-process command args: the container probe includes an IAM header.
    console.log(JSON.stringify({section: 'networkProbe', name: probe.name, result: error.stdout, error: error.stderr, code: error.code}));
  }
}));
