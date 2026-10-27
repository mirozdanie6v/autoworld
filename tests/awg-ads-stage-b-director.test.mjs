import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {isAdsDirector} from '../server/ads-stage-b-director.mjs';
import {mountAdsDirectorReport} from '../public/auto-sale-ads-director.mjs';

const pinned={role:'admin',authenticated:true,authType:'telegram',
  user:{id:'777'},admin:{telegramUserId:'777',username:'owner'}};
test('ads report is director allowlist AND pinned signed Telegram identity only',()=>{
  assert.equal(isAdsDirector(pinned,'777'),true);
  assert.equal(isAdsDirector(pinned,'123,777'),true);
  assert.equal(isAdsDirector(pinned,''),false);
  assert.equal(isAdsDirector({...pinned,authType:'vk'},'777'),false);
  assert.equal(isAdsDirector({...pinned,role:'client'},'777'),false);
  assert.equal(isAdsDirector({...pinned,authType:'api-key',apiKey:true},'777'),false);
  assert.equal(isAdsDirector({...pinned,admin:{telegramUserId:'888'}},'777'),false);
  assert.equal(isAdsDirector({...pinned,user:{id:'778'}},'777'),false);
});
test('authorized director panel fetches server report on opening; uses text nodes, not HTML',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>');
  const root=dom.window.document.querySelector('#app');
  const calls=[];
  const dispose=mountAdsDirectorReport({
    documentObj:dom.window.document,root,
    authHeaders:headers=>({...headers,'x-telegram-init-data':'signed'}),
    fetchImpl:async(url,opts)=>{
      calls.push({url,opts});
      return {ok:true,json:async()=>({rows:[{
        campaignId:'<img src=x onerror=alert(1)>',
        botStarts:2,miniappOpens:1,vehicleViews:3,
        leadSubmissions:1,managerContacts:1,costPerLead:null
      }]})};
    }
  });
  assert.equal(calls.length,0);
  const panel=root.querySelector('.awg-ads-director-report');
  panel.open=true;
  panel.dispatchEvent(new dom.window.Event('toggle'));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/auto-sale/ads/director-report');
  assert.equal(calls[0].opts.headers['x-telegram-init-data'],'signed');
  assert.equal(root.querySelector('tbody td').textContent,'<img src=x onerror=alert(1)>');
  assert.equal(root.querySelector('img'),null);
  assert.match(root.textContent,/Оплаченные клики и расходы пока не подключены/);
  root.replaceChildren();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(root.contains(panel)); // survives app re-renders
  dispose();
  assert.equal(root.contains(panel),false);
  dom.window.close();
});
