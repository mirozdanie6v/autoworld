import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createTelegramService} from '../server/telegram-bot.mjs';

const token='123456:synthetic-test-only';
const now=1793376000000;
function signed(){
  const params=new URLSearchParams({auth_date:String(now/1000),user:JSON.stringify({id:999000001,first_name:'QA'})});
  const check=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  params.set('hash',createHmac('sha256',secret).update(check).digest('hex'));
  return params;
}
const service=createTelegramService({token,now:()=>now});
test('valid signed Telegram identity remains accepted',()=>{
  assert.equal(service.validateInitData(signed().toString()).ok,true);
});
test('malformed SHA256 encodings never authenticate',()=>{
  const params=signed(),hash=params.get('hash');
  for(const malformed of [hash+'x',hash+'0',hash+'00',hash.slice(0,-1),hash.slice(0,32)+'zz'+hash.slice(34)]){
    params.set('hash',malformed);
    assert.equal(service.validateInitData(params.toString()).ok,false,malformed.length+' characters');
  }
});
