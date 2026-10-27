import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createTelegramService} from '../server/telegram-bot.mjs';
import {createAdsAttributionService,createMemoryAdsAttributionRepository} from '../server/ads-attribution-core.mjs';
import {createAdsStageBBridge} from '../server/ads-attribution-stage-b.mjs';
import {sanitizeClientOperations,applyManagerLeadClaims} from '../server/auto-sale-access.mjs';
import {summarizeAdsCampaignsFromRepository} from '../server/ads-attribution-report.mjs';
import {isAdsDirector} from '../server/ads-stage-b-director.mjs';

function signedInitData(token,user,authDate){
  const params=new URLSearchParams({
    user:JSON.stringify(user),auth_date:String(authDate),query_id:'synthetic-test'
  });
  const data=[...params.entries()].sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>k+'='+v).join('\n');
  const key=createHmac('sha256','WebAppData').update(token).digest();
  params.set('hash',createHmac('sha256',key).update(data).digest('hex'));
  return params.toString();
}
test('two distinct Telegram campaigns, signed Mini App, CRM leads, manager, director, VK and safe rollback',async()=>{
  const clock=()=>new Date('2026-10-27T09:00:00Z');
  const repository=createMemoryAdsAttributionRepository();
  const service=createAdsAttributionService({repository,
    subjectSecret:'two-campaigns-acceptance-only-test-secret-0123456789',
    clock});
  const bridge=createAdsStageBBridge({enabled:true,service,onFailure:async()=>{}});
  const campaignA=await service.issueCampaign({campaignId:'Ads-A'});
  const campaignB=await service.issueCampaign({campaignId:'Ads-B'});
  const botToken='123456:isolated-stage-b-qa';
  const bot=createTelegramService({token:botToken,now:()=>clock().getTime(),
    adsStartRecorder:bridge.recordBotStart,adsStartStrict:true,
    fetchImpl:async()=>{throw Error('external requests prohibited')}});
  const team=[{id:'TM-1',role:'Менеджер',name:'Дмитрий',active:true,
    telegramUsername:'manager_qa',telegramUserId:'800'}];
  const leads=[];
  const users=[
    {id:10101,username:'qa_a',first_name:'QA_A',campaign:campaignA,leadId:'L-ads-a'},
    {id:20202,username:'qa_b',first_name:'QA_B',campaign:campaignB,leadId:'L-ads-b'}
  ];
  for(let index=0;index<users.length;index++){
    const user=users[index],updateId=1000+index;
    const update={update_id:updateId,message:{
      text:'/start '+user.campaign.token,
      chat:{id:user.id,type:'private'},from:{id:user.id,first_name:user.first_name}
    }};
    assert.equal((await bot.handleWebhookUpdate(update,{webhookReply:true})).handled,'/start');
    assert.equal((await bot.handleWebhookUpdate(update,{webhookReply:true})).handled,'/start');
    const signed=signedInitData(botToken,user,Math.floor(clock().getTime()/1000));
    const identity=bot.validateInitData(signed);
    assert.equal(identity.ok,true);
    const invalid=bot.validateInitData(signed.replace('qa_','tampered_'));
    assert.equal(invalid.ok,false);
    const access={role:'client',authenticated:true,authType:'telegram',
      user:identity.user};
    const raw=[{resource:'lead',operation:'create',id:user.leadId,
      input:{name:user.first_name,model:'BMW',contact:'@'+user.username,
        adsAttribution:{source:'Telegram Ads',lastTouch:{campaignId:'forged'}}}}];
    const sanitized=sanitizeClientOperations({initialized:true,leads:[],catalog:[],quotes:[],
      notes:{},team},raw,identity.user,{provider:'telegram',id:String(user.id)});
    assert.equal(sanitized.ok,true);
    assert.equal(sanitized.operations[0].input.adsAttribution,undefined);
    const stamped=await bridge.enrichLeadOperations(sanitized.operations,access);
    assert.equal(stamped[0].input.adsAttribution.lastTouch.campaignId,user.campaign===campaignA?'Ads-A':'Ads-B');
    const committed={id:user.leadId,...stamped[0].input,status:'Новый'};
    leads.push(committed);
    assert.equal((await bridge.recordCommittedLeads(stamped,access,{committed:false})).recorded,0);
    assert.equal((await bridge.recordCommittedLeads(stamped,access,{committed:true})).recorded,1);
    assert.equal((await bridge.recordCommittedLeads(stamped,access,{committed:true})).recorded,1);
    assert.equal((await bridge.recordMiniAppEvent({access,eventType:'miniapp_open'})).status,'recorded');
    assert.equal((await bridge.recordMiniAppEvent({access,eventType:'vehicle_detail_click',
      carId:'verified',catalog:[{id:'verified',active:true}]})).status,'recorded');
  }
  const manager={role:'admin',authenticated:true,apiKey:false,
    authType:'telegram',user:{id:'800',username:'manager_qa'}};
  const status=applyManagerLeadClaims({team,leads},[
    {resource:'lead',operation:'patch',id:leads[0].id,input:{status:'В работе'}}
  ],manager,{now:()=>clock().toISOString()});
  assert.equal(status.ok,true);
  assert.equal(status.operations[0].input.manager,'Дмитрий');
  Object.assign(leads[0],status.operations[0].input);
  assert.equal((await bridge.reconcilePersistedLead(leads[0])).status,'duplicate');
  const director={role:'admin',authenticated:true,authType:'telegram',
    user:{id:'999'},admin:{telegramUserId:'999'}};
  assert.equal(isAdsDirector(director,'999'),true);
  assert.equal(isAdsDirector({...director,authType:'vk'},'999'),false);
  const report=await summarizeAdsCampaignsFromRepository({repository,pageSize:2,maxPages:30});
  const A=report.find(row=>row.campaignId==='Ads-A');
  const B=report.find(row=>row.campaignId==='Ads-B');
  assert.deepEqual([A.botStarts,A.leadSubmissions,A.managerActions,A.miniappOpens,A.vehicleDetailClicks],[1,1,1,1,1]);
  assert.deepEqual([B.botStarts,B.leadSubmissions,B.managerActions,B.miniappOpens,B.vehicleDetailClicks],[1,1,0,1,1]);
  assert.equal(A.paidClicks,null);assert.equal(B.costPerLead,null);
  const vkOperations=[{resource:'lead',operation:'create',id:'L-vk',input:{model:'Lada'}}];
  const untouched=await bridge.enrichLeadOperations(vkOperations,{
    role:'client',authenticated:true,authType:'vk',user:{id:'10101'}});
  assert.strictEqual(untouched,vkOperations);
  // Rollback by OFF flag is side-effect free; campaign data are preserved.
  const disabled=createAdsStageBBridge({enabled:false});
  const before=(await repository.listEvents({limit:100})).events.length;
  assert.equal((await disabled.recordBotStart({telegramUserId:10101,
    startPayload:campaignB.token,updateId:9000})).status,'disabled');
  assert.strictEqual(await disabled.enrichLeadOperations(vkOperations,{
    role:'client',authenticated:true,authType:'telegram',user:{id:'10101'}}),vkOperations);
  assert.equal((await repository.listEvents({limit:100})).events.length,before);
});
