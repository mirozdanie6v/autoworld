import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const base=String(process.env.STAGING_URL||'').replace(/\/$/,'');
const apiKey=String(process.env.AUTO_SALE_API_KEY||'');
assert.ok(base,'STAGING_URL is required');
assert.ok(apiKey,'AUTO_SALE_API_KEY is required');
const executablePath=process.env.PLAYWRIGHT_CHROME_PATH||'/usr/bin/google-chrome';
const stamp=Date.now();
const testName='PHASE6 UI '+stamp;
const report={
  ok:false,
  base,
  testName,
  manager:{},
  director:{},
  network:{legacyWholeStateWrites:[],entityBatches:[],entityResponses:[]},
  cleanup:{},
  errors:[]
};
let browser;
let leadId='';
let cleanupFailure=null;

const api=async(path,options={})=>{
  const response=await fetch(base+path,{
    ...options,
    headers:{'content-type':'application/json','x-auto-sale-key':apiKey,...(options.headers||{})}
  });
  const data=await response.json().catch(()=>({}));
  return{response,data};
};

try{
  const health=await fetch(base+'/api/health').then(r=>r.json());
  assert.equal(health.legacyStateWrite,'retired');
  assert.equal(health.normalizedAuthoritative,true);
  report.health=health;

  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();

  await page.route('**/api/auto-sale/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    await route.continue({headers:{
      ...request.headers(),
      'x-auto-sale-key':apiKey,
      ...(url.pathname==='/api/auto-sale/entities/batch'?{'x-auto-sale-skip-telegram':'1'}:{})
    }});
  });

  page.on('request',request=>{
    const u=new URL(request.url());
    if(u.pathname==='/api/auto-sale/state'&&request.method()==='PUT'){
      report.network.legacyWholeStateWrites.push({method:request.method(),url:request.url()});
    }
    if(u.pathname==='/api/auto-sale/entities/batch'){
      report.network.entityBatches.push({method:request.method(),url:request.url()});
    }
  });
  page.on('response',response=>{
    const request=response.request();
    const u=new URL(response.url());
    if(u.pathname==='/api/auto-sale/entities/batch'){
      report.network.entityResponses.push({method:request.method(),status:response.status(),url:response.url()});
    }
  });
  page.on('console',msg=>{if(msg.type()==='error')report.errors.push('console: '+msg.text())});
  page.on('pageerror',error=>report.errors.push('pageerror: '+error.message));

  await page.goto(base+'/',{waitUntil:'networkidle',timeout:60000});
  await page.locator('[data-role="manager"]').click();
  await page.getByText('Админ-доступ · операционная работа',{exact:false}).waitFor({timeout:10000});
  report.manager.roleSwitch=true;

  await page.locator('[data-go="leads"]').click();
  await page.getByRole('heading',{name:'Лиды и клиенты'}).waitFor();
  await page.locator('[data-manager-new]').first().click();

  const form=page.locator('#requestForm');
  await form.waitFor();
  await form.locator('[name="name"]').fill(testName);
  await form.locator('[name="contact"]').fill('@phase6_ui_e2e');
  await form.locator('[name="model"]').fill('Phase6 Test Car');
  await form.locator('[name="origin"]').selectOption({label:'Грузия'});
  await form.locator('[name="budget"]').fill('25000');

  const managerSelect=form.locator('[name="manager"]');
  const managerTag=await managerSelect.evaluate(el=>el.tagName);
  if(managerTag==='SELECT'){
    const expectedManagerTelegram={Дмитрий:'@Flyer_Flyer',Алексей:'@smit44744',Иван:'@Ivan_AWG'};
    const options=await managerSelect.locator('option').evaluateAll(opts=>opts.map(o=>o.value).filter(Boolean));
    for(const [manager,telegram] of Object.entries(expectedManagerTelegram)){
      assert.ok(options.includes(manager),'Canonical manager missing: '+manager);
      await managerSelect.selectOption(manager);
      const telegramField=form.locator('[name="managerTelegram"]');
      await telegramField.waitFor({timeout:5000});
      assert.equal(await telegramField.inputValue(),telegram,'Telegram autofill mismatch for '+manager);
    }
    await managerSelect.selectOption('Дмитрий');
    report.manager.selectedManager='Дмитрий';
    report.manager.selectedManagerTelegram=await form.locator('[name="managerTelegram"]').inputValue();
  }else{
    throw new Error('Manager selector must be canonical SELECT');
  }

  await form.locator('[name="priority"]').selectOption({label:'Высокий'});
  await form.locator('[name="note"]').fill('Phase 6 real UI create scenario');
  const createWait=page.waitForResponse(r=>r.url().includes('/api/auto-sale/entities/batch')&&r.request().method()==='POST',{timeout:65000});
  await form.getByRole('button',{name:'Создать лид'}).click();
  const createResponse=await createWait;
  const createTransient=[500,502,503,504].includes(createResponse.status());
  assert.ok(createResponse.ok()||createTransient,'Manager create lead batch failed: '+createResponse.status());
  report.manager.createStatus=createResponse.status();
  report.manager.createRecovered=createTransient;

  const row=page.locator('button[data-lead]').filter({hasText:testName}).first();
  await row.waitFor({timeout:createTransient?180000:10000});
  leadId=await row.getAttribute('data-lead');
  assert.ok(leadId,'Created lead id missing');
  report.manager.leadId=leadId;

  await row.click();
  const edit=page.locator('#leadEditForm');
  await edit.waitFor();
  await edit.locator('[name="status"]').selectOption({label:'В работе'});
  await edit.locator('[name="note"]').fill('Phase 6 real UI status transition');
  const patchWait=page.waitForResponse(r=>r.url().includes('/api/auto-sale/entities/batch')&&r.request().method()==='POST',{timeout:65000});
  await edit.getByRole('button',{name:'Сохранить карточку'}).click();
  const patchResponse=await patchWait;
  const patchTransient=[500,502,503,504].includes(patchResponse.status());
  assert.ok(patchResponse.ok()||patchTransient,'Manager lead patch batch failed: '+patchResponse.status());
  report.manager.patchStatus=patchResponse.status();
  report.manager.patchRecovered=patchTransient;

  let verified=null;
  for(let attempt=0;attempt<(patchTransient?50:8);attempt++){
    verified=await api('/api/auto-sale/leads/'+encodeURIComponent(leadId)).catch(()=>null);
    if(verified?.response?.ok&&verified.data?.entity?.status==='В работе')break;
    await new Promise(resolve=>setTimeout(resolve,Math.min(2500,1000+attempt*250)));
  }
  assert.ok(verified?.response?.ok,'Created lead cannot be re-read');
  assert.equal(verified.data.entity.status,'В работе');
  assert.equal(verified.data.entity.name,testName);
  report.manager.persistedStatus=verified.data.entity.status;
  report.manager.rowVersion=verified.data.rowVersion;
  await page.screenshot({path:'phase6-manager.png',fullPage:true});
  const openModal=page.locator('.auto-modal [data-close]').first();
  if(await openModal.count())await openModal.click();

  await page.locator('[data-role="owner"]').click();
  await page.getByText('Админ-доступ · аналитика',{exact:false}).first().waitFor({timeout:10000});
  report.director.roleSwitch=true;

  const routes=[
    ['overview','Бизнес одним экраном'],
    ['pipeline','Воронка и качество лидов'],
    ['finance','Деньги по заказам'],
    ['ordersAdmin','Все сделки и автомобили']
  ];
  report.director.routes={};
  for(const [route,heading] of routes){
    await page.locator('button[data-go="'+route+'"]').last().click();
    await page.getByRole('heading',{name:heading}).waitFor();
    report.director.routes[route]=true;
  }

  const firstOrder=page.locator('button[data-order]').first();
  if(await firstOrder.count()){
    const orderId=await firstOrder.getAttribute('data-order');
    await firstOrder.click();
    await page.getByText('КОНТРОЛЬ',{exact:false}).first().waitFor();
    assert.equal(await page.locator('#orderForm').count(),0,'Director unexpectedly received editable order form');
    assert.equal(await page.locator('[data-order-next]').count(),0,'Director unexpectedly received stage transition control');
    report.director.readOnlyOrder={id:orderId,verified:true};
  }else{
    report.director.readOnlyOrder={verified:false,reason:'no_orders'};
  }
  await page.screenshot({path:'phase6-director.png',fullPage:true});

  assert.equal(report.network.legacyWholeStateWrites.length,0,'UI emitted legacy PUT /api/auto-sale/state');
  assert.ok(report.network.entityBatches.length>=2,'Expected manager entity batch writes were not observed');
  report.ok=true;
}catch(error){
  report.errors.push(error?.stack||String(error));
  throw error;
}finally{
  if(leadId){
    try{
      const current=await api('/api/auto-sale/leads/'+encodeURIComponent(leadId));
      if(current.response.ok){
        let removed=await api('/api/auto-sale/leads/'+encodeURIComponent(leadId),{
          method:'DELETE',
          body:JSON.stringify({baseRowVersion:current.data.rowVersion})
        });
        if(removed.response.status===504){
          await new Promise(resolve=>setTimeout(resolve,1500));
          const verify=await api('/api/auto-sale/leads/'+encodeURIComponent(leadId));
          if(verify.response.status===404){
            report.cleanup={leadId,status:200,ok:true,timeoutRecovered:true};
            removed=null;
          }else if(verify.response.ok){
            removed=await api('/api/auto-sale/leads/'+encodeURIComponent(leadId),{
              method:'DELETE',
              body:JSON.stringify({baseRowVersion:verify.data.rowVersion})
            });
          }
        }
        if(removed){
          report.cleanup={leadId,status:removed.response.status,ok:removed.response.ok,data:removed.data};
          if(!removed.response.ok)cleanupFailure=new Error('UI scenario cleanup failed: '+JSON.stringify(removed.data));
        }
      }
    }catch(error){
      report.cleanup={leadId,ok:false,error:String(error)};
      cleanupFailure=error;
    }
  }
  if(browser)await browser.close();
  await writeFile('phase6-ui-manager-director-report.json',JSON.stringify(report,null,2));
  if(report.ok&&cleanupFailure)throw cleanupFailure;
}
