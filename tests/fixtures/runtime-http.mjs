import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHmac} from 'node:crypto';
import {AWG_GEORGIA_TARIFF_VERSION,AWG_GEORGIA_QUOTE_SCHEMA,georgiaQuoteAmounts} from '../../public/auto-sale-georgia-quote.mjs';
import {calculateQuote} from '../../public/auto-sale-core.mjs';

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
    // Isolated PostgreSQL runtime: manager publishes a priced Georgian quote,
    // the VK client reads and approves it, and the quote is removed with the synthetic lead.
    const adminHeaders={'x-auto-sale-key':apiKey,'x-auto-sale-skip-notifications':'1'};
    const qid='Q-RUNTIME-GEORGIA';
    const detail={id:qid,leadId:'L-RUNTIME-VK',model:'Toyota Camry staging',origin:'Грузия',
      tariffVersion:AWG_GEORGIA_TARIFF_VERSION,quoteSchema:AWG_GEORGIA_QUOTE_SCHEMA,
      status:'Отправлен',version:1,transportMode:'Доставка под ключ',ageCategory:'3to5',
      manufactureDate:'2023-02',engineCc:2000,powerHp:150,engineType:'petrol',importerType:'nat',
      lot:15000,turnkeyDeliveryUsd:900.50,legalization:4000,service:1000,
      customsRub:420000,recyclingRub:100000,usdRubRate:100,exchangeRateDate:'2026-10-21',exchangeRateSource:'cbr',
      internationalTransferPercent:3.5,comment:'INTERNAL_ONLY_RUNTIME_TEST'};
    const amounts=georgiaQuoteAmounts(detail);
    const quote={...detail,...amounts,total:calculateQuote(amounts)};
    assert.equal(quote.cryptoFee,556.52);
    assert.equal(quote.total,26657.02);
    const invalid=await request('/api/auto-sale/entities/batch',{method:'POST',headers:adminHeaders,
      body:{operations:[{resource:'quote',operation:'create',id:qid,input:{...quote,cryptoFee:525}}]}});
    assert.equal(invalid.status,400,JSON.stringify(invalid.data));
    assert.equal(invalid.data.error,'invalid_quote');
    const published=await request('/api/auto-sale/entities/batch',{method:'POST',headers:adminHeaders,
      body:{operations:[{resource:'quote',operation:'create',id:qid,input:quote}]}});
    assert.equal(published.status,200,JSON.stringify(published.data));
    const quoteVersion=published.data.rowVersions?.['quote:'+qid];
    assert.ok(Number(quoteVersion)>0,'quote row version persisted');
    const visible=await request('/api/auto-sale/state',{headers:clientHeaders});
    assert.equal(visible.status,200);
    const clientQuote=visible.data.quotes?.find(x=>x.id===qid);
    assert.ok(clientQuote,'VK client can read own Georgian quote');
    assert.equal(clientQuote.total,26657.02);
    assert.equal(clientQuote.turnkeyDeliveryUsd,900.50);
    assert.equal(clientQuote.cryptoFee,556.52);
    const foreign=new URLSearchParams(params);
    foreign.set('vk_user_id','667');
    foreign.delete('sign');
    foreign.set('sign',createHmac('sha256',vkSecret).update(new URLSearchParams([...foreign].sort(([a],[b])=>a.localeCompare(b))).toString()).digest('base64url'));
    const foreignView=await request('/api/auto-sale/state',{headers:{'x-vk-launch-params':foreign.toString()}});
    assert.equal(foreignView.status,200);
    assert.ok(!foreignView.data.quotes?.some(x=>x.id===qid),'other VK client cannot see quote');
    const approved=await request('/api/auto-sale/entities/batch',{method:'POST',headers:clientHeaders,
      body:{operations:[{resource:'quote',operation:'patch',id:qid,baseRowVersion:quoteVersion,
        input:{clientDecision:'agreed',cryptoFee:0,turnkeyDeliveryUsd:0,total:1}}]}});
    assert.equal(approved.status,200,JSON.stringify(approved.data));
    const adminView=await request('/api/auto-sale/state',{headers:adminHeaders});
    assert.equal(adminView.status,200);
    const agreed=adminView.data.quotes?.find(x=>x.id===qid);
    assert.ok(agreed,'approved quote persisted to PostgreSQL');
    assert.equal(agreed.status,'Согласован');
    assert.equal(agreed.clientDecision,'agreed');
    assert.equal(agreed.total,26657.02,'client cannot modify previously offered total');
    assert.equal(agreed.cryptoFee,556.52,'server protects transfer fee from client tampering');
    assert.equal(agreed.turnkeyDeliveryUsd,900.50,'server protects delivery from client tampering');
    const leadVersion=adminView.data._rowVersions?.['lead:L-RUNTIME-VK']||created.data.revision;
    const removed=await request('/api/auto-sale/leads/L-RUNTIME-VK?cascade=1',{method:'DELETE',headers:adminHeaders,body:{baseRowVersion:leadVersion}});
    assert.equal(removed.status,200,JSON.stringify(removed.data));
    assert.ok(removed.data.deleted?.quotes?.includes(qid),'synthetic quote cascades with lead');
  }finally{
    if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}
    await new Promise(resolve=>provider.close(resolve));
  }
}
