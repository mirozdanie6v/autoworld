import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const serverName='awg-timeweb-staging';
export function chooseTimewebPreset(presets,{maxPrice=1940}={}){
  const candidates=presets.filter(p=>p.location==='ru-1'&&p.cpu===1&&p.ram===2048&&p.disk>=30000&&p.disk<=32000&&['ssd','nvme'].includes(p.disk_type)&&Number(p.price)<=maxPrice);
  candidates.sort((a,b)=>Number(a.price)-Number(b.price)||a.id-b.id);
  if(!candidates[0])throw new Error('No 1 CPU / 2 GB / 30 GB Russian preset within the permitted base price');
  return candidates[0];
}
export function timewebCloudInit(publicKey){
  if(!/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]*)?$/.test(publicKey))throw new Error('A valid single-line Ed25519 public key is required');
  return '#cloud-config\n'+JSON.stringify({package_update:true,packages:['docker.io','docker-compose-v2','ca-certificates','curl','ufw'],
    users:[{name:'root',ssh_authorized_keys:[publicKey]}],disable_root:false,ssh_pwauth:false,
    runcmd:[['systemctl','enable','--now','docker'],['install','-d','-m','0700','/opt/awg/staging'],['ufw','default','deny','incoming'],['ufw','allow','22/tcp'],['ufw','allow','80/tcp'],['ufw','allow','443/tcp'],['ufw','--force','enable']]});
}
export async function prepareTimeweb({token,create=false,publicKey,maxPrice=1940,fetchImpl=fetch}={}){
  if(!token)throw new Error('TIMEWEB_CLOUD_TOKEN is required');
  async function request(path,method='GET',body){
    const response=await fetchImpl('https://api.timeweb.cloud/api/v1'+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Timeweb ${method} ${path} failed with HTTP ${response.status}`);
    return response.json();
  }
  const [servers,tariffs,systems]=await Promise.all([request('/servers'),request('/presets/servers'),request('/os/servers')]);
  const matches=(servers.servers||[]).filter(s=>s.name===serverName);
  if(matches.length>1)throw new Error('Duplicate staging server names: inspect before any mutation');
  const preset=chooseTimewebPreset(tariffs.server_presets||[],{maxPrice});
  const os=(systems.servers_os||[]).find(s=>/ubuntu/i.test(s.name||s.family||'')&&String(s.version).startsWith('24.04'));
  if(!os)throw new Error('Ubuntu 24.04 is not offered by the live API');
  const plan={name:serverName,availabilityZone:'spb-3',presetId:preset.id,baseMonthlyPrice:Number(preset.price),cpu:preset.cpu,ramMb:preset.ram,diskMb:preset.disk,osId:os.id,
    extraCosts:'IPv4, backups and media storage are billed separately',dnsChanges:false,productionWebhookChanges:false};
  if(matches[0]){
    if(matches[0].comment!=='VIIVERSION AWG isolated staging')throw new Error('Existing server name is not owned by this staging workflow');
    return{ok:true,created:false,existingServerId:matches[0].id,status:matches[0].status,plan};
  }
  if(!create)return{ok:true,created:false,plan};
  const cloudInit=timewebCloudInit(publicKey);
  // Never retry an uncertain POST: a repeated request could create another billable server.
  const response=await request('/servers','POST',{name:serverName,comment:'VIIVERSION AWG isolated staging',preset_id:preset.id,os_id:os.id,
    availability_zone:'spb-3',bandwidth:1000,is_ddos_guard:false,cloud_init:cloudInit});
  const server=response.server;
  if(!server?.id)throw new Error('Uncertain server creation result: inspect the server list before retrying');
  return{ok:true,created:true,serverId:server.id,status:server.status,plan};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const report=await prepareTimeweb({token:process.env.TIMEWEB_CLOUD_TOKEN,create:process.argv.includes('--create'),publicKey:String(process.env.AWG_TIMEWEB_SSH_PUBLIC_KEY||'').trim(),maxPrice:1940});
  const output=process.env.AWG_TIMEWEB_PLAN_OUTPUT;
  if(output)await writeFile(output,JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report));
}
