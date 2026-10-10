import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const STAGING=process.env.AWG_VK_DIAG_ORIGIN||'https://vk-test.awgcars.ru';
assert.ok(['https://vk-test.awgcars.ru','https://awgcars.ru'].includes(STAGING),'Only allow official isolated staging or read-only production provider diagnostic');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,locale:'ru-RU'});
  const start=await context.request.get(STAGING+'/api/auto-sale/vk/web/start',{maxRedirects:0,timeout:25000});
  assert.equal(start.status(),302);
  const baseLocation=start.headers().location||'';
  const base=new URL(baseLocation);
  assert.equal(base.hostname,'id.vk.ru');
  assert.equal(base.searchParams.get('client_id'),'54811927');
  assert.equal(base.searchParams.get('redirect_uri'),STAGING+'/api/auto-sale/vk/web/callback');
  const variants=[
    ['current',new URL(base)],
    ['with-app-id',new URL(base)],
    ['sdk-identifiers',new URL(base)]
  ];
  variants[1][1].searchParams.set('app_id','54811927');
  variants[2][1].searchParams.set('app_id','54811927');
  variants[2][1].searchParams.set('sdk_type','vkid');
  variants[2][1].searchParams.set('prompt','');
  for(const [variant,url] of variants){
    const page=await context.newPage();
    try{
      const response=await page.goto(url.toString(),{waitUntil:'domcontentloaded',timeout:35000}).catch(e=>({error:String(e.message).slice(0,170)}));
      await page.waitForTimeout(3000);
      const body=(await page.locator('body').innerText().catch(()=>'')).replace(/\\s+/g,' ').slice(0,1100);
      const normalized=body.toLowerCase();
      const isDomainError=normalized.includes('базовый домен')||normalized.includes('basic domain');
      const isLoginScreen=normalized.includes('войти')||normalized.includes('телефон')||normalized.includes('вход')||normalized.includes('sign in')||normalized.includes('авторизаци');
      const status=typeof response?.status==='function'?response.status():null;
      results.push({variant,status,isDomainError,isLoginScreen,content:body.slice(0,360),finalHost:new URL(page.url()).hostname,requestError:response?.error||null});
      await page.screenshot({path:'vk-id-provider-'+new URL(STAGING).hostname+'-'+variant+'.png',fullPage:false});
    }finally{await page.close()}
  }
  console.log('VK_ID_AUTHORIZE_AB_COMPARISON',JSON.stringify({testedOrigin:STAGING,results}));
  // This is only diagnostic: VK ID may block datacenter browsers.
  assert.equal(results.length,3);
}finally{await browser.close()}
