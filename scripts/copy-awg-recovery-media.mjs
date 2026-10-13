import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {createRecoveryBackup,decryptRecoveryBackup,encryptRecoveryBackup,validateRecoveryBackup} from '../server/migration-backup.mjs';

const [input,output]=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
const apply=process.argv.includes('--apply'),key=process.env.AWG_BACKUP_ENCRYPTION_KEY;
if(!input||!key||(apply&&(!output||!output.endsWith('.enc'))))throw new Error('Encrypted source backup and encryption key are required; --apply also needs an output .enc path');
const backup=decryptRecoveryBackup(JSON.parse(await readFile(input,'utf8')),key);
const sourceBucket=process.env.AWG_SOURCE_MEDIA_BUCKET||'viiversion-autoworld-awg-media';
if(!/^[a-z0-9.-]+$/.test(sourceBucket))throw new Error('invalid_source_bucket');
const sourcePrefix=`https://storage.yandexcloud.net/${sourceBucket}/`;
const urls=new Set();
function scan(value){
  if(typeof value==='string'&&value.startsWith(sourcePrefix))urls.add(value);
  else if(Array.isArray(value))value.forEach(scan);
  else if(value&&typeof value==='object')Object.values(value).forEach(scan);
}
scan(backup.snapshot.rows);
if(!apply){console.log(JSON.stringify({ok:true,dryRun:true,referencedObjects:urls.size,sourceChecksum:backup.checksum}));process.exit(0)}
const endpoint=process.env.AUTO_SALE_S3_ENDPOINT,bucket=process.env.AUTO_SALE_MEDIA_BUCKET;
if(!endpoint||new URL(endpoint).protocol!=='https:'||!bucket||!process.env.AUTO_SALE_S3_ACCESS_KEY||!process.env.AUTO_SALE_S3_SECRET_KEY)throw new Error('Target S3 endpoint, bucket and credentials are required');
const client=new S3Client({endpoint,region:process.env.AUTO_SALE_S3_REGION||'ru-1',forcePathStyle:true,
  credentials:{accessKeyId:process.env.AUTO_SALE_S3_ACCESS_KEY,secretAccessKey:process.env.AUTO_SALE_S3_SECRET_KEY},maxAttempts:3});
const publicBase=String(process.env.AUTO_SALE_MEDIA_PUBLIC_BASE_URL||`${endpoint.replace(/\/$/,'')}/${bucket}`).replace(/\/$/,'');
if(new URL(publicBase).protocol!=='https:')throw new Error('media_public_https_required');
const replacements=new Map();
const hash=data=>createHash('sha256').update(data).digest('hex');
try{
  for(const url of urls){
    const parsed=new URL(url);
    if(parsed.search||parsed.hash)throw new Error('unexpected_media_url_query');
    const objectKey=decodeURIComponent(url.slice(sourcePrefix.length));
    if(!objectKey.startsWith('cars/'))throw new Error('unexpected_media_object_key');
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Source media unavailable: HTTP ${response.status}`);
    const type=String(response.headers.get('content-type')||'').split(';')[0];
    if(!['image/jpeg','image/png','image/webp'].includes(type))throw new Error('source_media_type_invalid');
    const declared=Number(response.headers.get('content-length')||0);
    if(declared>10000000)throw new Error('source_media_too_large');
    const body=Buffer.from(await response.arrayBuffer());
    if(!body.length||body.length>10000000)throw new Error('source_media_size_invalid');
    await client.send(new PutObjectCommand({Bucket:bucket,Key:objectKey,Body:body,ContentType:type,CacheControl:'public, max-age=31536000, immutable',Metadata:{'source-sha256':hash(body)}}));
    const copied=await client.send(new GetObjectCommand({Bucket:bucket,Key:objectKey}));
    if(hash(Buffer.from(await copied.Body.transformToByteArray()))!==hash(body))throw new Error('copied_media_checksum_mismatch');
    const publicUrl=publicBase+'/'+objectKey.split('/').map(encodeURIComponent).join('/');
    const publicResponse=await fetch(publicUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!publicResponse.ok||hash(Buffer.from(await publicResponse.arrayBuffer()))!==hash(body))throw new Error('copied_media_public_read_not_verified');
    replacements.set(url,publicUrl);
  }
  function replace(value){
    if(typeof value==='string')return replacements.get(value)||value;
    if(Array.isArray(value))return value.map(replace);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)]));
    return value;
  }
  const migrated=createRecoveryBackup({...backup,snapshot:replace(backup.snapshot)},
    {source:{...backup.source,originalChecksum:backup.checksum,mediaMigration:{targetBucket:bucket,objects:replacements.size}}});
  await writeFile(output,JSON.stringify(encryptRecoveryBackup(migrated,key)),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({ok:true,mediaObjects:replacements.size,...validateRecoveryBackup(migrated)}));
}finally{client.destroy()}
