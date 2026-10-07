import {readFile} from 'node:fs/promises';

const SOURCE_PATH=process.env.SOURCE_PATH||'data/autoworld-georgia/catalog-import.json';
const IMPORT_URL=process.env.AUTO_SALE_CATALOG_IMPORT_URL||'https://awgcars.ru/api/auto-sale/admin/catalog-import';
const IMPORT_KEY=String(process.env.AUTO_SALE_CATALOG_IMPORT_KEY||'').trim();
const REPLACE_SOURCE_ALL=/^(1|true|yes)$/i.test(String(process.env.REPLACE_SOURCE_ALL||''));
const SOURCE_NAME='AutoWorld_Georgia';

if(!IMPORT_KEY)throw new Error('AUTO_SALE_CATALOG_IMPORT_KEY is required');

const items=JSON.parse(await readFile(SOURCE_PATH,'utf8'));
if(!Array.isArray(items)||!items.length)throw new Error('catalog_import_source_empty');

const payload=JSON.stringify({
  source:SOURCE_NAME,
  replaceSourceAll:REPLACE_SOURCE_ALL,
  items
});

let response=null;
let data={};
let lastError=null;
for(let attempt=1;attempt<=5;attempt++){
  try{
    response=await fetch(IMPORT_URL,{
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-auto-sale-catalog-import-key':IMPORT_KEY
      },
      body:payload,
      signal:AbortSignal.timeout(45_000)
    });
    data=await response.json().catch(()=>({}));
    if(response.ok&&data?.ok===true)break;
    const retryable=response.status===429||response.status>=500;
    if(!retryable)throw new Error(`catalog_import_failed_${response.status}_${JSON.stringify(data).slice(0,1200)}`);
    lastError=new Error(`catalog_import_transient_${response.status}_${JSON.stringify(data).slice(0,600)}`);
  }catch(error){
    lastError=error;
    if(attempt===5)throw error;
  }
  await new Promise(resolve=>setTimeout(resolve,Math.min(8000,500*2**(attempt-1))));
}
if(!response?.ok||data?.ok!==true){
  throw lastError||new Error('catalog_import_failed_unknown');
}
console.log('AUTOWORLD_CATALOG_ENTITY_IMPORT_OK',JSON.stringify({
  source:SOURCE_NAME,
  received:data.received,
  created:data.created,
  patched:data.patched,
  replaced:data.replaced,
  deleted:data.deleted,
  skipped:data.skipped,
  revision:data.revision,
  changed:data.changed,
  replaceSourceAll:REPLACE_SOURCE_ALL
}));
