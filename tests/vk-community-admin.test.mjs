import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedUrl, groupIsAdmin, existingSiteLink, pinStatus, runAdminSetup} from '../scripts/vk-community-admin.mjs';

const mockResponse = (data) => ({ok:true, json:async()=>data});
function client({admin=true, failMethod=null, prelinked=false, prepinned=false}={}) {
  const calls=[]; let linked=prelinked, pinned=prepinned;
  const responses={
    'users.get':()=>[{id:42}],
    'groups.getById':()=>({groups:[{id:242103542,is_admin:admin?1:0,links:linked?[{url:'https://awgcars.ru/'}]:[]}]}),
    'wall.get':()=>({items:[{id:1,is_pinned:pinned?1:0},{id:2}]}),
    'wall.pin':()=>{pinned=true;return 1},
    'groups.addLink':()=>{linked=true;return {id:7}}
  };
  return {calls,fetchImpl:async(url,opts)=>{
    const method=String(url).split('/').pop();
    assert.match(String(opts.body),/access_token=secret/);
    calls.push(method);
    if(method===failMethod)return mockResponse({error:{error_code:27,error_msg:'denied'}});
    return mockResponse({response:responses[method]()});
  }};
}
const logger={log() {}};
test('URL equivalence and reject javascript scheme',()=>{
  assert.equal(normalizedUrl('https://www.awgcars.ru'),normalizedUrl('https://awgcars.ru/'));
  assert.ok(existingSiteLink([{url:'https://awgcars.ru'}]));
  assert.equal(normalizedUrl('javascript:alert(1)'),'');
});
test('must be admin of the exact community',()=>{
  assert.ok(groupIsAdmin({id:242103542,is_admin:1}));
  assert.equal(groupIsAdmin({id:242103542,is_admin:0}),false);
  assert.equal(groupIsAdmin({id:1,is_admin:1}),false);
});
test('pinned detection',()=>{
  assert.equal(pinStatus({items:[{id:1,is_pinned:1}]}),'pinned');
  assert.equal(pinStatus({items:[{id:1}]}),'unpinned');
});
test('dry-run makes no changes',async()=>{
  const mock=client();
  const result=await runAdminSetup({token:'secret',fetchImpl:mock.fetchImpl,logger});
  assert.equal(result.mode,'dry-run');
  assert.deepEqual(mock.calls,['users.get','groups.getById','wall.get']);
});
test('apply changes exactly once then verifies',async()=>{
  const mock=client();
  const result=await runAdminSetup({token:'secret',apply:true,fetchImpl:mock.fetchImpl,logger});
  assert.deepEqual(result.verified,{site_link_present:true,welcome_pinned:true});
  assert.equal(mock.calls.filter(x=>x==='wall.pin').length,1);
  assert.equal(mock.calls.filter(x=>x==='groups.addLink').length,1);
});
test('existing links and pins cause no writes',async()=>{
  const mock=client({prelinked:true,prepinned:true});
  await runAdminSetup({token:'secret',apply:true,fetchImpl:mock.fetchImpl,logger});
  assert.ok(!mock.calls.includes('wall.pin'));
  assert.ok(!mock.calls.includes('groups.addLink'));
});
test('non-admin blocked before write',async()=>{
  const mock=client({admin:false});
  await assert.rejects(runAdminSetup({token:'secret',apply:true,fetchImpl:mock.fetchImpl,logger}),/not an admin/);
  assert.ok(!mock.calls.includes('wall.pin'));
});
test('VK access error stops before write',async()=>{
  const mock=client({failMethod:'wall.get'});
  await assert.rejects(runAdminSetup({token:'secret',apply:true,fetchImpl:mock.fetchImpl,logger}),/code 27/);
  assert.ok(!mock.calls.includes('wall.pin'));
});
