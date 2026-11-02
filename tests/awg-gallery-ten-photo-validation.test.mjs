import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {syncYdbState} from '../server/ydb-sync.mjs';

const photo=(i)=>'https://storage.yandexcloud.net/viiversion-autoworld-awg-media/cars/autoworld-4394/'+i+'.jpg';
const state=()=>({initialized:false,revision:1,catalog:[],leads:[],quotes:[],orders:[],notes:{},team:[]});
const fullCar=(additional)=>({id:'AWG-4394',source:'AutoWorld_Georgia',sourcePostId:'4394',
  brand:'Porsche',model:'Macan',year:2024,image:photo(1),
  otherPhotos:Array.from({length:additional},(_,i)=>photo(i+2)),
  interiorPhotos:[],vin:'WP1AA2A50RLB18308',priceRub:5380000,active:true});

test('10 source photos (1 main + 9 other) pass YDB validation without touching other data',async()=>{
  const original=state(), input={...original,baseRevision:1,catalog:[fullCar(9)]};
  let written=null;
  const store={loadState:async()=>original,replaceState:async next=>{
    written=next;return{status:200,data:{revision:2}};
  }};
  const out=await syncYdbState(store,input);
  assert.equal(out.status,200);
  assert.equal(written.catalog[0].otherPhotos.length,9);
  assert.equal(written.catalog[0].priceRub,5380000);
  assert.equal(written.catalog[0].vin,'WP1AA2A50RLB18308');
  assert.deepEqual(written.leads,[]);
  assert.deepEqual(written.orders,[]);
});

test('additional 10th other image remains disallowed (max source gallery 10)',async()=>{
  const original=state(),input={...original,baseRevision:1,catalog:[fullCar(10)]};
  let written=false;
  const store={loadState:async()=>original,replaceState:async()=>{written=true;return{status:200}}};
  const out=await syncYdbState(store,input);
  assert.equal(out.status,400);
  assert.equal(out.data.error,'invalid_catalog_photos');
  assert.equal(written,false);
});

test('manager photo upload control has same 9-picture limit as backend',async()=>{
  const src=await readFile(new URL('../public/auto-sale-app-v3.mjs',import.meta.url),'utf8');
  assert.match(src,/const MAX_OTHER_PHOTOS=9;/);
  assert.doesNotMatch(src,/const MAX_OTHER_PHOTOS=6;/);
});
