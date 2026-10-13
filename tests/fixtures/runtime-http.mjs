import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHmac} from 'node:crypto';

export async function verifyPostgresRuntimeHttp(databaseUrl){
  const delivered=[];
  const provider=http.createServer(async(req,res)=>{
    const parts=[];for await(const chunk of req)parts.push(chunk);
    const body=Buffer.concat(parts).toString();
    if(req.url.includes('/bot')){
      delivered.push({channel:'telegram',...JSON.parse(body)});
      res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:{message_id:delivered.length}}));
    }else{
      delivered.push({channel:'vk',...Object.fromEntries(new URLSearchParams(body))});
      res.setHeader('content-type','application/json');res.end(JSON.stringify({response:delivered.length}));
    }
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');
  const providerBase=`http://127.0.0.1:${provider.address().port}`;
  const portReservation=http.createServer();portReservation.listen(0,'127.0.0.1');await once(portReservation,'listening');
  const port=portReservation.address().port;await new Promise(resolve=>portReservation.close(resolve));
  const base=`http://127.0.0.1:${port}`,apiKey='runtime-test-only-key',vkSecret='runtime-test-only-vk';
  const child=spawn(process.execPath,['server/yandex-server.mjs'],{cwd:new URL('../../',import.meta.url),stdio:['ignore','pipe','pipe'],env:{...process.env,
    PORT:String(port),AUTO_SALE_PERSISTENCE:'postgres',DATABASE_URL:databaseUrl,AUTO_SALE_API_KEY:apiKey,AUTO_SALE_LEGACY_STATE_WRITE:'false',AUTO_SALE_PUBLIC_DEMO_WRITE:'false',
    AUTO_SALE_NOTIFICATION_PUMP_ENABLED:'false',AUTO_SALE_MEDIA_BUCKET:'',AUTO_SALE_MEDIA_PROVIDER:'s3',AUTO_SALE_BUILD_SHA:'runtime-ci-test',
    AUTO_SALE_TELEGRAM_BOT_TOKEN:'runtime-test-only-token',AUTO_SALE_MANAGER_CHAT_IDS:'12345,12346,12347',AUTO_SALE_TELEGRAM_API_BASE_URL:providerBase,AUTO_SALE_TELEGRAM_RELAY_URL:'',
    AUTO_SALE_TELEGRAM_APP_URL:'https://timeweb-staging.viiversion.com/',AUTO_SALE_VK_ENABLED:'true',AUTO_SALE_VK_APP_ID:'777001',AUTO_SALE_VK_APP_SECRET:vkSecret,
    AUTO_SALE_VK_GROUP_ID:'888001',AUTO_SALE_VK_COMMUNITY_TOKEN:'runtime-test-only-community',AUTO_SALE_VK_API_BASE_URL:providerBase,AUTO_SALE_VK_WEB_ENABLED:'false'}});
  let logs='';child.stdout.on('data',x=>{logs+=x});child.stderr.on('data',x=>{logs+=x});
  async function request(path,{method='GET',body,headers={}}={}){
    const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
    return{status:r.status,data:await r.json()};
  }
  try{
    let ready=false;
    for(let n=0;n<100;n++){
      if(child.exitCode!==null)throw new Error('Runtime exited before ready: '+logs);
      try{const h=await request('/api/health');if(h.status===200){assert.equal(h.data.persistence,'postgresql');assert.equal(h.data.buildSha,'runtime-ci-test');ready=true;break}}catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(ready,'runtime health must be ready');
    assert.equal((await request('/api/auto-sale/leads',{method:'POST',body:{id:'L-UNSIGNED'}})).status,401);
    const params=new URLSearchParams({vk_app_id:'777001',vk_user_id:'666',vk_ts:String(Math.floor(Date.now()/1000)),vk_platform:'android',vk_language:'ru'});
    params.set('sign',createHmac('sha256',vkSecret).update(new URLSearchParams([...params].sort(([a],[b])=>a.localeCompare(b))).toString()).digest('base64url'));
    const clientHeaders={'x-vk-launch-params':params.toString()};
    const created=await request('/api/auto-sale/entities/batch',{method:'POST',headers:clientHeaders,body:{operations:[{resource:'lead',operation:'create',id:'L-RUNTIME-VK',input:{id:'L-RUNTIME-VK',name:'Runtime client',contact:'+70000000000',model:'BMW X5',status:'Новый',nextAction:'2026-10-14',source:'Mini App'}}]}});
    assert.equal(created.status,200,JSON.stringify(created.data));
    const view=await request('/api/auto-sale/state',{headers:clientHeaders});
    assert.equal(view.status,200);
    assert.ok(view.data.leads.some(x=>x.id==='L-RUNTIME-VK'));
    assert.ok(!view.data.leads.some(x=>x.id==='L-1'));
    for(let n=0;n<100&&delivered.length<4;n++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.deepEqual([...new Set(delivered.filter(x=>x.channel==='telegram').map(x=>String(x.chat_id)))].sort(),['12345','12346','12347']);
    assert.ok(delivered.some(x=>x.channel==='vk'&&x.peer_id==='666'));
    const removed=await request('/api/auto-sale/leads/L-RUNTIME-VK',{method:'DELETE',headers:{'x-auto-sale-key':apiKey,'x-auto-sale-skip-notifications':'1'},body:{baseRowVersion:created.data.revision}});
    assert.equal(removed.status,200,JSON.stringify(removed.data));
  }finally{
    if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}
    await new Promise(resolve=>provider.close(resolve));
  }
}
