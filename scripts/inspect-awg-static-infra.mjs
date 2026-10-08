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
