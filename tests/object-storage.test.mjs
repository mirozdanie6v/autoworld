import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectStorage} from '../server/object-storage.mjs';

test('Object Storage uploads image data with runtime IAM token',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).includes('169.254.169.254')){
      return new Response(JSON.stringify({access_token:'iam-test',expires_in:3600}),{status:200,headers:{'content-type':'application/json'}});
    }
    return new Response('',{status:200});
  };
  const storage=createObjectStorage({bucket:'viiversion-auto-sale-media',fetchImpl});
  const result=await storage.upload({
    carId:'CAR-123',
    category:'interior',
    dataUrl:'data:image/jpeg;base64,SGVsbG8=',
    fileName:'salon.jpg'
  });
  assert.match(result.url,/^https:\/\/storage\.yandexcloud\.net\/viiversion-auto-sale-media\/cars\/CAR-123\/interior-/);
  assert.equal(calls.length,2);
  assert.equal(calls[1].options.method,'PUT');
  assert.equal(calls[1].options.headers.Authorization,'Bearer iam-test');
  assert.equal(calls[1].options.headers['Content-Type'],'image/jpeg');
});

test('Object Storage delete skips external URLs',async()=>{
  let called=false;
  const storage=createObjectStorage({bucket:'viiversion-auto-sale-media',fetchImpl:async()=>{called=true;return new Response('',{status:200})}});
  const result=await storage.remove('https://example.com/car.jpg');
  assert.equal(result.skipped,true);
  assert.equal(called,false);
});

test('Object Storage rejects unsupported image payloads',async()=>{
  const storage=createObjectStorage({bucket:'viiversion-auto-sale-media',fetchImpl:async()=>new Response('',{status:200})});
  await assert.rejects(
    storage.upload({carId:'CAR-1',category:'main',dataUrl:'data:text/plain;base64,SGVsbG8=',fileName:'x.txt'}),
    error=>error?.message==='unsupported_image'&&error?.statusCode===400
  );
});

test('Object Storage keeps verification photos in a dedicated path',async()=>{
  const fetchImpl=async(url,options={})=>{
    if(String(url).includes('169.254.169.254'))return new Response(JSON.stringify({access_token:'iam-test',expires_in:3600}),{status:200,headers:{'content-type':'application/json'}});
    return new Response('',{status:200});
  };
  const storage=createObjectStorage({bucket:'viiversion-auto-sale-media',fetchImpl});
  const result=await storage.upload({
    carId:'VERIFY-Q-1',
    category:'verification',
    dataUrl:'data:image/jpeg;base64,SGVsbG8=',
    fileName:'before.jpg'
  });
  assert.match(result.url,/\/cars\/VERIFY-Q-1\/verification-/);
});
