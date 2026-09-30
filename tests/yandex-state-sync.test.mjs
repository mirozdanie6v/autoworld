import test from 'node:test';
import assert from 'node:assert/strict';
import {syncYdbState} from '../server/ydb-sync.mjs';

function fakeStore(initial){
  let state=structuredClone(initial);
  return{
    async loadState(){return structuredClone(state)},
    async replaceState(next,{expectedRevision=null}={}){
      if(expectedRevision!==null&&Number(expectedRevision)!==Number(state.revision)){
        return{status:409,data:{error:'revision_conflict',currentRevision:state.revision,state:structuredClone(state)}};
      }
      state={...structuredClone(next),initialized:true,revision:Number(state.revision)+1};
      return{status:200,data:{ok:true,revision:state.revision}};
    }
  };
}

const base=()=>({
  revision:7,initialized:true,
  leads:[{id:'L-1',name:'Client',contact:'@client',model:'BMW X5',status:'Новый',nextAction:'2026-09-22',deposit:0}],
  quotes:[],orders:[],notes:{},team:[],catalog:[{id:'CAR-1',brand:'BMW',model:'X5',price:45000,image:'https://example.com/x5.jpg'}]
});

test('YDB sync rejects stale revisions',async()=>{
  const store=fakeStore(base());
  const input={...base(),baseRevision:6};
  const result=await syncYdbState(store,input);
  assert.equal(result.status,409);
  assert.equal(result.data.error,'revision_conflict');
});

test('YDB sync enforces lead transitions before write',async()=>{
  const store=fakeStore(base());
  const input=base();
  input.baseRevision=7;
  input.leads[0].status='Сделка';
  input.leads[0].deposit=1000;
  const result=await syncYdbState(store,input);
  assert.equal(result.status,400);
  assert.equal(result.data.error,'invalid_lead_transition');
});

test('YDB sync accepts a valid optimistic update',async()=>{
  const store=fakeStore(base());
  const input=base();
  input.baseRevision=7;
  input.leads[0].status='В работе';
  const result=await syncYdbState(store,input);
  assert.equal(result.status,200);
  assert.equal(result.data.revision,8);
  const stored=await store.loadState();
  assert.equal(stored.leads[0].status,'В работе');
});


test('YDB sync validates and persists manager catalog changes',async()=>{
  const store=fakeStore(base());
  const input=base();
  input.baseRevision=7;
  input.catalog.push({id:'CAR-2',brand:'Kia',model:'Telluride',price:42000,image:'https://example.com/telluride.jpg',active:true});
  const result=await syncYdbState(store,input);
  assert.equal(result.status,200);
  const stored=await store.loadState();
  assert.equal(stored.catalog.length,2);
  assert.equal(stored.catalog[1].model,'Telluride');
});

test('YDB sync rejects incomplete catalog cars',async()=>{
  const store=fakeStore(base());
  const input=base();
  input.baseRevision=7;
  input.catalog=[{id:'CAR-BAD',brand:'Kia',model:'',price:0,image:''}];
  const result=await syncYdbState(store,input);
  assert.equal(result.status,400);
  assert.equal(result.data.error,'invalid_catalog_car');
});


test('YDB sync accepts Object Storage catalog photo URLs',async()=>{
  const store=fakeStore(base());
  const input=base();
  input.baseRevision=7;
  input.catalog[0]={
    ...input.catalog[0],
    image:'https://storage.yandexcloud.net/viiversion-auto-sale-media/cars/CAR-1/main.jpg',
    interiorPhotos:[
      'https://storage.yandexcloud.net/viiversion-auto-sale-media/cars/CAR-1/interior-1.jpg',
      'https://storage.yandexcloud.net/viiversion-auto-sale-media/cars/CAR-1/interior-2.jpg'
    ],
    otherPhotos:['https://storage.yandexcloud.net/viiversion-auto-sale-media/cars/CAR-1/other-1.jpg']
  };
  const result=await syncYdbState(store,input);
  assert.equal(result.status,200);
  const stored=await store.loadState();
  assert.equal(stored.catalog[0].interiorPhotos.length,2);
  assert.equal(stored.catalog[0].otherPhotos.length,1);
});

test('YDB sync rejects embedded base64 photos',async()=>{
  const store=fakeStore(base());
  const input=base();
  input.baseRevision=7;
  input.catalog[0].image='data:image/jpeg;base64,MAIN';
  const result=await syncYdbState(store,input);
  assert.equal(result.status,400);
  assert.equal(result.data.error,'invalid_catalog_car');
});

test('YDB sync rejects too many catalog photos',async()=>{
  const store=fakeStore(base());
  const input=base();
  input.baseRevision=7;
  input.catalog[0].interiorPhotos=Array.from({length:5},(_,i)=>`https://storage.yandexcloud.net/viiversion-auto-sale-media/cars/CAR-1/interior-${i}.jpg`);
  const result=await syncYdbState(store,input);
  assert.equal(result.status,400);
  assert.equal(result.data.error,'invalid_catalog_photos');
});


test('YDB sync accepts catalog cars whose price is supplied by source metadata or calculated later',async()=>{
  const store=fakeStore(base());
  const input=base();
  input.baseRevision=7;
  input.catalog=[{
    id:'AWG-1',brand:'Kia',model:'K4',year:2026,price:0,priceRub:2970000,
    image:'https://storage.yandexcloud.net/viiversion-auto-sale-media/cars/AWG-1/main.jpg',
    source:'AutoWorld_Georgia'
  },{
    id:'AWG-2',brand:'BMW',model:'228',year:2025,price:0,
    image:'https://storage.yandexcloud.net/viiversion-auto-sale-media/cars/AWG-2/main.jpg',
    source:'AutoWorld_Georgia'
  }];
  const result=await syncYdbState(store,input);
  assert.equal(result.status,200);
  const stored=await store.loadState();
  assert.equal(stored.catalog.length,2);
  assert.equal(stored.catalog[0].priceRub,2970000);
  assert.equal(stored.catalog[1].price,0);
});

test('YDB sync blocks USA approval without a complete vehicle dossier',async()=>{
  const previous=base();
  previous.leads[0].status='Ожидает клиента';
  previous.quotes=[{
    id:'Q-VERIFY',leadId:'L-1',model:'BMW X5',origin:'США',transportMode:'Море',
    lot:25000,auction:1000,inland:1000,ocean:2500,customs:6500,repair:1500,service:1500,total:39000,
    status:'На согласовании',version:1,validUntil:'2026-10-10'
  }];
  const store=fakeStore(previous);
  const input=structuredClone(previous);input.baseRevision=7;input.quotes[0].status='Согласован';
  const result=await syncYdbState(store,input);
  assert.equal(result.status,400);
  assert.equal(result.data.error,'invalid_quote');
  assert.ok(result.data.details.includes('verification_lot_required'));
});

test('YDB sync accepts approved USA quote with dossier and locks it afterwards',async()=>{
  const verification={
    lotNumber:'LOT-900',vin:'VIN900TEST',year:2023,mileage:18000,damage:'Косметические повреждения',
    photos:['https://storage.yandexcloud.net/viiversion-auto-sale-media/cars/VERIFY-Q-900/verification-a.jpg'],
    reportUrl:'https://example.com/report-900',history:'История проверена.',
    result:'Одобрен к покупке',checkedAt:'2026-09-25'
  };
  const previous=base();
  previous.leads[0].status='Ожидает клиента';
  previous.quotes=[{
    id:'Q-VERIFY',leadId:'L-1',model:'BMW X5',origin:'США',transportMode:'Море',
    lot:25000,auction:1000,inland:1000,ocean:2500,customs:6500,repair:1500,service:1500,total:39000,
    status:'На согласовании',version:1,validUntil:'2026-10-10',verification
  }];
  const store=fakeStore(previous);
  const input=structuredClone(previous);input.baseRevision=7;input.quotes[0].status='Согласован';
  const approved=await syncYdbState(store,input);
  assert.equal(approved.status,200);

  const stored=await store.loadState();
  const changed=structuredClone(stored);changed.baseRevision=stored.revision;
  changed.quotes[0].verification.damage='Изменено после согласования';
  const locked=await syncYdbState(store,changed);
  assert.equal(locked.status,400);
  assert.equal(locked.data.error,'locked_quote_changed');
  assert.equal(locked.data.field,'verification');
});
