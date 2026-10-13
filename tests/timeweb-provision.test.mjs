import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTimeweb,chooseTimewebPreset,timewebCloudInit} from '../scripts/prepare-awg-timeweb.mjs';

const preset={id:1,location:'ru-1',price:1080,cpu:2,ram:4096,disk:51200,disk_type:'nvme'};
function fakeApi(servers=[]){
  const calls=[];
  return{calls,fetchImpl:async(url,options)=>{
    calls.push({url,options});
    const path=url.replace('https://api.timeweb.cloud/api/v1','');
    const data=options.method==='POST'?{server:{id:42,status:'installing',root_password:'must-never-appear'}}:
      path==='/servers'?{servers}:path==='/presets/servers'?{server_presets:[preset]}:{servers_os:[{id:99,name:'Ubuntu',version:'24.04'}]};
    return{ok:true,json:async()=>data};
  }};
}
test('Timeweb plan is read only and cannot silently choose a higher price or foreign region',async()=>{
  const api=fakeApi(),result=await prepareTimeweb({token:'fixture',...api});
  assert.ok(api.calls.every(call=>call.options.method==='GET'));
  assert.equal(result.created,false);assert.equal(result.plan.baseMonthlyPrice,1080);
  assert.throws(()=>chooseTimewebPreset([{...preset,price:2000}]),/permitted/);
  assert.throws(()=>chooseTimewebPreset([{...preset,location:'ams-1'}]),/permitted/);
});
test('server creation happens once and server credentials are excluded from reports',async()=>{
  const api=fakeApi(),result=await prepareTimeweb({token:'fixture',create:true,publicKey:'ssh-ed25519 AAAABBBB fixture',...api});
  assert.equal(api.calls.filter(call=>call.options.method==='POST').length,1);
  assert.equal(result.serverId,42);assert.ok(!JSON.stringify(result).includes('must-never-appear'));
  assert.ok(timewebCloudInit('ssh-ed25519 AAAABBBB fixture').includes('ssh_pwauth'));
});
test('a rerun reuses the owned staging server without creating a second billable instance',async()=>{
  const api=fakeApi([{id:42,name:'awg-timeweb-staging',comment:'VIIVERSION AWG isolated staging'}]);
  const result=await prepareTimeweb({token:'fixture',create:true,...api});
  assert.equal(result.existingServerId,42);assert.ok(api.calls.every(call=>call.options.method==='GET'));
  const wrong=fakeApi([{id:42,name:'awg-timeweb-staging',comment:'someone else'}]);
  await assert.rejects(prepareTimeweb({token:'fixture',create:true,...wrong}),/not owned/);
});
