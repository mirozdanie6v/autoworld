import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {fixtureBackup} from './fixtures/migration-backup.mjs';
import {createRecoveryBackup} from '../server/migration-backup.mjs';
import {
 AWG_D1_BACKUP_DATABASE,AWG_D1_BACKUP_FORMAT,
 encryptD1Recovery,decryptD1Recovery,splitD1Archive,joinD1Archive,
 createCloudflareD1BackupClient
} from '../server/cloudflare-d1-backup.mjs';

const KEY=randomBytes(32).toString('base64');
const ACCOUNT='f4935962036fd500d34335e0b174b227';
const UUID='aabbccdd-1111-4222-a333-123456789abc';
const SOURCE='etn00ojk5iv1u7dgpdar';
const sample=()=>{
 const original=fixtureBackup();
 return createRecoveryBackup({
   snapshot:original.snapshot,adminAccess:original.adminAccess,outbox:original.outbox
 },{source:{namespace:'AWG',repository:'mirozdanie6v/autoworld',databaseId:SOURCE}});
};
function mockD1({existing=false,blockWrites=false}={}){
  const db={databases:existing?[{uuid:UUID,name:AWG_D1_BACKUP_DATABASE}]:[],
    manifests:new Map(),chunks:new Map(),requests:[]};
  const fetchImpl=async (url,options={})=>{
    const path=new URL(url).pathname;
    const method=options.method||'GET';
    const json=options.body?JSON.parse(options.body):{};
    db.requests.push({method,path,sql:json.sql||'',params:json.params||[]});
    const done=(result)=>({ok:true,status:200,json:async()=>({success:true,result})});
    const result=rows=>done([{success:true,results:rows}]);
    if(method==='GET'&&path.endsWith('/d1/database'))return {ok:true,status:200,json:async()=>({success:true,result:db.databases,result_info:{total_pages:1}})};
    if(method==='POST'&&path.endsWith('/d1/database')){
      db.databases.push({uuid:UUID,name:json.name});return done({uuid:UUID,name:json.name});
    }
    if(!path.endsWith('/'+UUID+'/query'))throw Error('unexpected_mock_cloudflare_call_'+path);
    const sql=json.sql||'',p=json.params||[];
    if(sql.startsWith('CREATE '))return result([]);
    if(blockWrites&&/^(INSERT|UPDATE|DELETE)/.test(sql))return {ok:false,status:403,json:async()=>({success:false,errors:[{code:10000,message:'not authorized'}]})};
    if(sql.startsWith('INSERT INTO awg_backup_manifest')){
      const keys=['id','created_at','source_database','source_revision','schema_version','encrypted_size',
        'chunk_count','encrypted_sha256','backup_checksum','backup_state_hash','status'];
      db.manifests.set(p[0],Object.fromEntries(keys.map((k,i)=>[k,p[i]])));return result([]);
    }
    if(sql.startsWith('INSERT INTO awg_backup_chunks')){
      const list=db.chunks.get(p[0])||new Map();list.set(p[1],p[2]);db.chunks.set(p[0],list);return result([]);
    }
    if(sql.startsWith('UPDATE awg_backup_manifest')){
      const row=db.manifests.get(p[0]);if(row&&row.status==='writing')row.status='verified';return result([]);
    }
    if(sql.startsWith('SELECT part_index,payload')){
      const parts=db.chunks.get(p[0])||new Map();
      const rows=[...parts].sort((a,b)=>a[0]-b[0]).slice(p[1],p[1]+20)
       .map(([part_index,payload])=>({part_index,payload}));
      return result(rows);
    }
    if(sql.startsWith('SELECT status FROM awg_backup_manifest')){
      const row=db.manifests.get(p[0]);return result(row?[{status:row.status}]:[]);
    }
    if(sql.startsWith('SELECT id,created_at')){
      const rows=[...db.manifests.values()].filter(row=>{
        if(sql.includes('WHERE id = ?'))return row.id===p[0];
        if(sql.includes('WHERE status = ?'))return row.status===p[0];
        return true;
      });
      return result(rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,sql.includes('LIMIT ?')?p[1]:rows.length));
    }
    throw Error('unexpected_sql_'+sql.slice(0,100));
  };
  return{db,fetchImpl};
}

test('AES-256-GCM/gzip D1 envelope round trips full AWG production recovery shape',()=>{
  const backup=sample(),{encoded,report}=encryptD1Recovery(backup,KEY);
  assert.equal(JSON.parse(encoded).format,AWG_D1_BACKUP_FORMAT);
  assert.equal(report.revision,10);
  assert.equal(report.adminBindings,1);
  assert.equal(report.outbox,1);
  assert.ok(!encoded.includes('@client')&&!encoded.includes('Дмитрий'));
  const result=decryptD1Recovery(encoded,KEY);
  assert.deepEqual(result.backup,backup);
  assert.deepEqual(result.report,report);
  assert.ok(Buffer.byteLength(encoded)<Buffer.byteLength(JSON.stringify(backup))*2);
});

test('wrong keys, modified ciphertext and invalid encryption keys always fail',()=>{
  const {encoded}=encryptD1Recovery(sample(),KEY);
  assert.throws(()=>decryptD1Recovery(encoded,randomBytes(32).toString('base64')));
  const e=JSON.parse(encoded);
  const buf=Buffer.from(e.ciphertext,'base64');buf[0]^=1;e.ciphertext=buf.toString('base64');
  assert.throws(()=>decryptD1Recovery(JSON.stringify(e),KEY));
  assert.throws(()=>encryptD1Recovery(sample(),'weak-password'),/base64/);
});

test('chunk splitting, order and digest detect corruption before decryption',()=>{
  const {encoded}=encryptD1Recovery(sample(),KEY);
  const hash=createHash('sha256').update(encoded).digest('hex');
  const chunks=splitD1Archive(encoded,128);
  assert.ok(chunks.length>1);
  assert.equal(joinD1Archive(chunks,chunks.length,hash),encoded);
  assert.throws(()=>joinD1Archive(chunks.slice(1),chunks.length,hash));
  chunks[0]='X'+chunks[0].slice(1);
  assert.throws(()=>joinD1Archive(chunks,chunks.length,hash),/sha256/);
});

test('Cloudflare D1 creation is explicitly gated and scoped to archive database name',async()=>{
  const mock=mockD1();
  const client=createCloudflareD1BackupClient({accountId:ACCOUNT,apiToken:'test-only',fetchImpl:mock.fetchImpl});
  await assert.rejects(client.findDatabase(),/database_missing/);
  assert.equal(mock.db.databases.length,0);
  assert.equal(await client.findDatabase({create:true}),UUID);
  assert.deepEqual(mock.db.databases,[{name:AWG_D1_BACKUP_DATABASE,uuid:UUID}]);
  assert.equal(await client.findDatabase(),UUID);
});

test('D1 upload reads every encrypted chunk back before marking verified, and supports recovery drill',async()=>{
  const mock=mockD1({existing:true});
  const client=createCloudflareD1BackupClient({accountId:ACCOUNT,apiToken:'test-only',fetchImpl:mock.fetchImpl});
  const dbId=await client.findDatabase();
  await client.ensureSchema(dbId);
  const report=await client.saveBackup(dbId,sample(),KEY);
  assert.equal(report.verified,true);
  assert.equal(report.sourceRevision,10);
  assert.equal(report.adminBindings,1);
  assert.equal(report.outbox,1);
  assert.ok(report.chunkCount>=1);
  assert.equal(mock.db.manifests.get(report.id).status,'verified');
  const list=await client.listBackups(dbId,{limit:10});
  assert.equal(list.length,1);
  const retrieved=await client.getBackup(dbId,report.id,KEY);
  assert.equal(retrieved.report.checksum,retrieved.meta.backup_checksum);
  assert.equal(retrieved.report.revision,10);
  assert.equal(retrieved.report.counts.leads,1);
  assert.equal(retrieved.backup.source.databaseId,SOURCE);
  assert.equal(mock.db.requests.filter(r=>r.sql.startsWith('INSERT INTO awg_backup_chunks')).length,report.chunkCount);
});

test('Corrupt upload must never be promoted from writing to verified',async()=>{
  const mock=mockD1({existing:true}),original=mock.fetchImpl;
  const bad=async(url,opts)=>{
    const req=opts.body?JSON.parse(opts.body):{};
    const response=await original(url,opts);
    if(req.sql?.startsWith('SELECT part_index,payload')){
      const p=await response.json();
      if(p.result[0].results.length)p.result[0].results[0].payload+='corruption';
      return{ok:true,status:200,json:async()=>p};
    }
    return response;
  };
  const client=createCloudflareD1BackupClient({accountId:ACCOUNT,apiToken:'test-only',fetchImpl:bad});
  await client.ensureSchema(UUID);
  await assert.rejects(client.saveBackup(UUID,sample(),KEY),/sha256/);
  assert.equal([...mock.db.manifests.values()][0].status,'writing');
});

test('Missing D1 edit scope returns a safe error, without leaking tokens or backup payload',async()=>{
  const mock=mockD1({existing:true,blockWrites:true});
  const client=createCloudflareD1BackupClient({accountId:ACCOUNT,apiToken:'test-secret-token',fetchImpl:mock.fetchImpl});
  await assert.rejects(client.saveBackup(UUID,sample(),KEY),e=>
    e.message==='cloudflare_d1_http_403_code_10000'&&!e.message.includes('test-secret-token'));
});
