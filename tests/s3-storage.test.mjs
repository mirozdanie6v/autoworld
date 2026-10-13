import test from 'node:test';
import assert from 'node:assert/strict';
import {createS3Storage} from '../server/s3-storage.mjs';

test('S3 media keeps the catalog upload contract without Yandex metadata authentication',async()=>{
  const requests=[],client={async send(command){requests.push(command.input);return{}}};
  const media=createS3Storage({bucket:'awg-test-media',endpoint:'https://s3.twcstorage.ru',client});
  const result=await media.upload({carId:'CAR-1',category:'interior',fileName:'a photo.jpg',dataUrl:'data:image/jpeg;base64,SGVsbG8='});
  assert.match(result.url,/^https:\/\/s3\.twcstorage\.ru\/awg-test-media\/cars\/CAR-1\/interior-/);
  assert.equal(result.contentType,'image/jpeg');assert.equal(result.size,5);
  assert.equal(requests[0].Bucket,'awg-test-media');assert.equal(requests[0].Body.toString(),'Hello');
  await media.remove(result.url);assert.equal(requests[1].Key,result.key);
  await media.remove('https://other.test/awg-test-media/cars/a.jpg');assert.equal(requests.length,2);
});
test('S3 media validates images before any network operation',async()=>{
  const client={async send(){throw new Error('unexpected_network')}};
  const media=createS3Storage({bucket:'awg-test-media',endpoint:'https://s3.twcstorage.ru',client});
  await assert.rejects(media.upload({carId:'CAR',dataUrl:'data:text/html;base64,SGVsbG8='}),/unsupported_image/);
  await assert.rejects(media.upload({carId:'CAR',dataUrl:'data:image/jpeg;base64,'+Buffer.alloc(2000001).toString('base64')}),/image_too_large/);
});
