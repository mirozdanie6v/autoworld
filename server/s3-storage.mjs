import {randomUUID} from 'node:crypto';
import {S3Client,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';

const segment=value=>String(value||'').trim().replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100);
const encodeKey=key=>key.split('/').map(encodeURIComponent).join('/');
const problem=(code,statusCode)=>Object.assign(new Error(code),{statusCode});

export function createS3Storage({bucket,endpoint=process.env.AUTO_SALE_S3_ENDPOINT,region=process.env.AUTO_SALE_S3_REGION||'ru-1',
  accessKeyId=process.env.AUTO_SALE_S3_ACCESS_KEY,secretAccessKey=process.env.AUTO_SALE_S3_SECRET_KEY,
  publicBaseUrl=process.env.AUTO_SALE_MEDIA_PUBLIC_BASE_URL,client:providedClient}={}){
  const name=String(bucket||'').trim();
  if(name&&!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name))throw new Error('invalid_s3_bucket');
  const origin=String(publicBaseUrl||`${String(endpoint||'').replace(/\/$/,'')}/${name}`).replace(/\/$/,'');
  let client=providedClient;
  function configuredClient(){
    if(!name)throw problem('media_storage_not_configured',503);
    if(!client){
      if(!endpoint||!accessKeyId||!secretAccessKey)throw problem('s3_credentials_not_configured',503);
      if(new URL(endpoint).protocol!=='https:')throw new Error('s3_https_required');
      client=new S3Client({endpoint,region,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey},maxAttempts:3});
    }
    return client;
  }
  function publicUrl(key){return `${origin}/${encodeKey(key)}`}
  async function upload({carId,category,dataUrl,fileName}){
    const car=segment(carId);
    if(!car)throw problem('invalid_car_id',400);
    const match=String(dataUrl||'').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
    if(!match)throw problem('unsupported_image',400);
    const body=Buffer.from(match[2].replace(/\s+/g,''),'base64');
    if(!body.length)throw problem('empty_image',400);
    if(body.length>2000000)throw problem('image_too_large',413);
    const type=match[1].toLowerCase(),ext=type==='jpeg'?'jpg':type,mime=`image/${type==='jpg'?'jpeg':type}`;
    const kind=['main','interior','other','verification'].includes(category)?category:'other';
    const base=segment(String(fileName||'').replace(/\.[^.]+$/,''))||kind;
    const key=`cars/${car}/${kind}-${Date.now()}-${base}-${randomUUID().slice(0,8)}.${ext}`;
    await configuredClient().send(new PutObjectCommand({Bucket:name,Key:key,Body:body,ContentType:mime,CacheControl:'public, max-age=31536000, immutable'}));
    return{url:publicUrl(key),key,contentType:mime,size:body.length};
  }
  async function remove(url){
    if(!name)return{ok:true,skipped:true};
    const value=String(url||''),prefix=origin+'/';
    if(!value.startsWith(prefix))return{ok:true,skipped:true};
    const key=decodeURIComponent(value.slice(prefix.length));
    if(!key.startsWith('cars/')||key.includes('?')||key.includes('#'))return{ok:true,skipped:true};
    await configuredClient().send(new DeleteObjectCommand({Bucket:name,Key:key}));
    return{ok:true};
  }
  return{upload,remove,publicUrl,bucket:name};
}
