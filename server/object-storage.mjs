import {randomUUID} from 'node:crypto';

const METADATA_URL='http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';
const STORAGE_ORIGIN='https://storage.yandexcloud.net';
const TYPES={
  jpeg:{mime:'image/jpeg',ext:'jpg'},
  jpg:{mime:'image/jpeg',ext:'jpg'},
  png:{mime:'image/png',ext:'png'},
  webp:{mime:'image/webp',ext:'webp'}
};

const safeSegment=value=>String(value||'').trim().replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100);
const encodeKey=key=>key.split('/').map(encodeURIComponent).join('/');

export function createObjectStorage({bucket,fetchImpl=fetch,metadataUrl=METADATA_URL}={}){
  const bucketName=String(bucket||'').trim();
  let cachedToken='';
  let expiresAt=0;

  async function iamToken(){
    if(cachedToken&&Date.now()<expiresAt-60_000)return cachedToken;
    const response=await fetchImpl(metadataUrl,{headers:{'Metadata-Flavor':'Google'}});
    if(!response.ok)throw new Error(`metadata_token_failed_${response.status}`);
    const data=await response.json();
    cachedToken=String(data.access_token||'');
    const ttl=Math.max(60,Number(data.expires_in)||3600);
    expiresAt=Date.now()+ttl*1000;
    if(!cachedToken)throw new Error('metadata_token_missing');
    return cachedToken;
  }

  function parseDataUrl(dataUrl){
    const value=String(dataUrl||'');
    const match=value.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
    if(!match)throw Object.assign(new Error('unsupported_image'),{statusCode:400});
    const type=TYPES[match[1].toLowerCase()];
    const body=Buffer.from(match[2].replace(/\s+/g,''),'base64');
    if(!body.length)throw Object.assign(new Error('empty_image'),{statusCode:400});
    if(body.length>2_000_000)throw Object.assign(new Error('image_too_large'),{statusCode:413});
    return{body,...type};
  }

  function publicUrl(key){
    return `${STORAGE_ORIGIN}/${bucketName}/${encodeKey(key)}`;
  }

  async function upload({carId,category,dataUrl,fileName}){
    if(!bucketName)throw Object.assign(new Error('media_storage_not_configured'),{statusCode:503});
    const car=safeSegment(carId);
    const kind=['main','interior','other','verification'].includes(category)?category:'other';
    if(!car)throw Object.assign(new Error('invalid_car_id'),{statusCode:400});
    const {body,mime,ext}=parseDataUrl(dataUrl);
    const sourceBase=safeSegment(String(fileName||'').replace(/\.[^.]+$/,''))||kind;
    const key=`cars/${car}/${kind}-${Date.now()}-${sourceBase}-${randomUUID().slice(0,8)}.${ext}`;
    const token=await iamToken();
    const url=publicUrl(key);
    const response=await fetchImpl(url,{
      method:'PUT',
      headers:{
        Authorization:`Bearer ${token}`,
        'Content-Type':mime,
        'Cache-Control':'public, max-age=31536000, immutable'
      },
      body
    });
    if(!response.ok){
      const detail=await response.text().catch(()=> '');
      console.error('AUTO SALE Object Storage upload failed',response.status,detail.slice(0,500));
      throw Object.assign(new Error('object_storage_upload_failed'),{statusCode:502});
    }
    return{url,key,contentType:mime,size:body.length};
  }

  async function remove(url){
    if(!bucketName)return{ok:true,skipped:true};
    const prefix=`${STORAGE_ORIGIN}/${bucketName}/`;
    const value=String(url||'');
    if(!value.startsWith(prefix))return{ok:true,skipped:true};
    const token=await iamToken();
    const response=await fetchImpl(value,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok&&response.status!==404){
      const detail=await response.text().catch(()=> '');
      console.error('AUTO SALE Object Storage delete failed',response.status,detail.slice(0,500));
      throw Object.assign(new Error('object_storage_delete_failed'),{statusCode:502});
    }
    return{ok:true};
  }

  return{upload,remove,publicUrl,bucket:bucketName};
}
