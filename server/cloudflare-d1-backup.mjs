import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {validateRecoveryBackup} from './migration-backup.mjs';

export const AWG_D1_BACKUP_DATABASE='awg-ydb-backup-archive';
export const AWG_D1_BACKUP_FORMAT='awg-d1-aes256gcm-gzip-v1';
export const AWG_D1_BACKUP_CHUNK_SIZE=28_000;
const AAD=Buffer.from('AWG/cloudflare-d1/ydb-backup/v1');
const MAX_PLAINTEXT_BYTES=64*1024*1024;
const MAX_ENVELOPE_BYTES=24*1024*1024;
const sha256=x=>createHash('sha256').update(x).digest('hex');

function keyBuffer(value){
  if(!/^[A-Za-z0-9+/]{43}=$/.test(String(value||'')))throw Error('backup_key_must_be_32_base64_bytes');
  const key=Buffer.from(value,'base64');
  if(key.length!==32||key.toString('base64')!==value)throw Error('invalid_backup_encryption_key');
  return key;
}

export function encryptD1Recovery(backup,key){
  const report=validateRecoveryBackup(backup);
  const plain=Buffer.from(JSON.stringify(backup));
  if(plain.byteLength>MAX_PLAINTEXT_BYTES)throw Error('backup_plaintext_size_limit_exceeded_use_r2');
  const compressed=gzipSync(plain,{level:6});
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',keyBuffer(key),iv);
  cipher.setAAD(AAD);
  const data=Buffer.concat([cipher.update(compressed),cipher.final()]);
  const envelope={format:AWG_D1_BACKUP_FORMAT,iv:iv.toString('base64'),
    tag:cipher.getAuthTag().toString('base64'),ciphertext:data.toString('base64')};
  const encoded=JSON.stringify(envelope);
  if(Buffer.byteLength(encoded)>MAX_ENVELOPE_BYTES)throw Error('backup_archive_size_limit_exceeded_use_r2');
  return{encoded,report};
}
export function decryptD1Recovery(encoded,key){
  if(typeof encoded!=='string'||Buffer.byteLength(encoded)>MAX_ENVELOPE_BYTES)throw Error('invalid_archive_length');
  const envelope=JSON.parse(encoded);
  if(envelope?.format!==AWG_D1_BACKUP_FORMAT)throw Error('unsupported_archive_format');
  for(const field of ['iv','tag','ciphertext']){
    if(typeof envelope[field]!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(envelope[field]))throw Error('invalid_archive_encoding');
  }
  const iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');
  if(iv.length!==12||tag.length!==16)throw Error('invalid_archive_aead_nonce_or_tag');
  const decipher=createDecipheriv('aes-256-gcm',keyBuffer(key),iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  const compressed=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]);
  const backup=JSON.parse(gunzipSync(compressed,{maxOutputLength:MAX_PLAINTEXT_BYTES}).toString('utf8'));
  return{backup,report:validateRecoveryBackup(backup)};
}
export function splitD1Archive(encoded,chunkSize=AWG_D1_BACKUP_CHUNK_SIZE){
  if(typeof encoded!=='string'||!encoded.length)throw Error('archive_required');
  if(!Number.isInteger(chunkSize)||chunkSize<128||chunkSize>28_000)throw Error('invalid_chunk_size');
  const parts=[];
  for(let i=0;i<encoded.length;i+=chunkSize)parts.push(encoded.slice(i,i+chunkSize));
  return parts;
}
export function joinD1Archive(parts,count,expectedDigest){
  if(!Array.isArray(parts)||!Number.isSafeInteger(count)||parts.length!==count||count<1)throw Error('archive_chunk_count_mismatch');
  const full=parts.join('');
  if(sha256(full)!==expectedDigest)throw Error('archive_sha256_mismatch');
  return full;
}
function requireUUID(s){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s||'')))throw Error('invalid_cloudflare_d1_database_id');
  return s;
}

export function createCloudflareD1BackupClient({accountId,apiToken,fetchImpl=fetch,origin='https://api.cloudflare.com/client/v4'}={}){
  if(!/^[0-9a-f]{32}$/.test(String(accountId||'')))throw Error('cloudflare_account_id_required');
  if(!String(apiToken||'').trim())throw Error('cloudflare_d1_token_required');
  const root='/accounts/'+accountId+'/d1/database';
  async function request(path,{method='GET',body}={}){
    const response=await fetchImpl(origin+path,{
      method,headers:{Authorization:'Bearer '+apiToken,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(30_000)
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok||payload?.success!==true){
      const code=payload?.errors?.[0]?.code||response.status;
      throw Error('cloudflare_d1_http_'+String(response.status)+'_code_'+String(code));
    }
    return payload;
  }
  async function findDatabase({create=false}={}){
    let matches=[];
    for(let page=1;page<=10;page++){
      const p=await request(root+'?per_page=100&page='+page);
      matches.push(...(p.result||[]).filter(x=>x.name===AWG_D1_BACKUP_DATABASE));
      if(page>=(p.result_info?.total_pages||1))break;
    }
    if(matches.length>1)throw Error('ambiguous_backup_database_name');
    if(matches.length===1)return requireUUID(matches[0].uuid);
    if(!create)throw Error('cloudflare_d1_backup_database_missing');
    const p=await request(root,{method:'POST',body:{name:AWG_D1_BACKUP_DATABASE}});
    if(p.result?.name!==AWG_D1_BACKUP_DATABASE)throw Error('unexpected_backup_database_creation');
    return requireUUID(p.result.uuid);
  }
  async function query(dbId,sql,params=[]){
    requireUUID(dbId);
    if(typeof sql!=='string'||!sql.trim()||!Array.isArray(params))throw Error('invalid_d1_query');
    const payload=await request(root+'/'+dbId+'/query',{method:'POST',body:{sql,params}});
    const result=Array.isArray(payload.result)?payload.result:[payload.result];
    if(!result.length||result.some(x=>!x||x.success===false||!Array.isArray(x.results)))throw Error('cloudflare_d1_query_failed');
    return result[0].results;
  }
  async function ensureSchema(dbId){
    await query(dbId,"CREATE TABLE IF NOT EXISTS awg_backup_manifest (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, source_database TEXT NOT NULL, source_revision INTEGER NOT NULL, schema_version INTEGER NOT NULL, encrypted_size INTEGER NOT NULL, chunk_count INTEGER NOT NULL, encrypted_sha256 TEXT NOT NULL, backup_checksum TEXT NOT NULL, backup_state_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('writing','verified')))");
    await query(dbId,'CREATE TABLE IF NOT EXISTS awg_backup_chunks (backup_id TEXT NOT NULL, part_index INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (backup_id,part_index), FOREIGN KEY (backup_id) REFERENCES awg_backup_manifest(id))');
    await query(dbId,'CREATE INDEX IF NOT EXISTS awg_backups_verified ON awg_backup_manifest(status,created_at DESC)');
  }
  async function listBackups(dbId,{limit=200,status='verified'}={}){
    if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('invalid_backup_limit');
    if(!['verified','writing'].includes(status))throw Error('invalid_backup_status');
    return query(dbId,'SELECT id,created_at,source_database,source_revision,schema_version,encrypted_size,chunk_count,encrypted_sha256,backup_checksum,backup_state_hash,status FROM awg_backup_manifest WHERE status = ? ORDER BY created_at DESC LIMIT ?',[status,limit]);
  }
  async function getBackup(dbId,id,key){
    if(!/^[a-f0-9-]{36}$/.test(String(id||'')))throw Error('backup_id_invalid');
    const rows=await query(dbId,'SELECT id,created_at,source_database,source_revision,schema_version,encrypted_size,chunk_count,encrypted_sha256,backup_checksum,backup_state_hash,status FROM awg_backup_manifest WHERE id = ?',[id]);
    if(rows.length!==1||rows[0].status!=='verified')throw Error('backup_not_verified');
    const meta=rows[0],count=Number(meta.chunk_count);
    if(!Number.isInteger(count)||count<1||count>900)throw Error('backup_chunk_total_out_of_range');
    const parts=[];
    for(let offset=0;offset<count;offset+=20){
      const page=await query(dbId,'SELECT part_index,payload FROM awg_backup_chunks WHERE backup_id = ? ORDER BY part_index ASC LIMIT 20 OFFSET ?',[id,offset]);
      for(const p of page){
        if(Number(p.part_index)!==parts.length)throw Error('backup_chunk_sequence_mismatch');
        parts.push(String(p.payload));
      }
    }
    const encoded=joinD1Archive(parts,count,meta.encrypted_sha256);
    if(Buffer.byteLength(encoded)!==Number(meta.encrypted_size))throw Error('backup_size_mismatch');
    const {backup,report}=decryptD1Recovery(encoded,key);
    if(report.checksum!==meta.backup_checksum||report.stateHash!==meta.backup_state_hash||
        report.revision!==Number(meta.source_revision)||backup.source?.databaseId!==meta.source_database)
      throw Error('backup_manifest_consistency_mismatch');
    return{backup,report,meta,encoded};
  }
  async function saveBackup(dbId,backup,key,{clock=new Date()}={}){
    const {encoded,report}=encryptD1Recovery(backup,key);
    const parts=splitD1Archive(encoded);
    if(parts.length>900)throw Error('too_many_d1_chunks_use_r2');
    const id=randomUUID(),createdAt=clock.toISOString(),digest=sha256(encoded);
    const src=String(backup.source?.databaseId||'');
    if(!/^etn[a-z0-9]{17,}$/.test(src))throw Error('unknown_source_database');
    await query(dbId,'INSERT INTO awg_backup_manifest (id,created_at,source_database,source_revision,schema_version,encrypted_size,chunk_count,encrypted_sha256,backup_checksum,backup_state_hash,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[
      id,createdAt,src,report.revision,Number(backup.snapshot.meta.schemaVersion),
      Buffer.byteLength(encoded),parts.length,digest,report.checksum,report.stateHash,'writing'
    ]);
    for(let i=0;i<parts.length;i++){
      await query(dbId,'INSERT INTO awg_backup_chunks (backup_id,part_index,payload) VALUES (?,?,?)',[id,i,parts[i]]);
    }
    // Read back every part from Cloudflare, decrypt in memory and validate the
    // full normalized recovery state before marking the archive as verified.
    const savedParts=[];
    for(let offset=0;offset<parts.length;offset+=20){
      const page=await query(dbId,'SELECT part_index,payload FROM awg_backup_chunks WHERE backup_id = ? ORDER BY part_index ASC LIMIT 20 OFFSET ?',[id,offset]);
      for(const p of page){
        if(Number(p.part_index)!==savedParts.length)throw Error('uploaded_chunk_order_mismatch');
        savedParts.push(String(p.payload));
      }
    }
    const checked=decryptD1Recovery(joinD1Archive(savedParts,parts.length,digest),key).report;
    if(checked.checksum!==report.checksum||checked.stateHash!==report.stateHash||checked.revision!==report.revision)throw Error('uploaded_backup_validation_failed');
    await query(dbId,"UPDATE awg_backup_manifest SET status = 'verified' WHERE id = ? AND status = 'writing'",[id]);
    const confirmed=await query(dbId,'SELECT status FROM awg_backup_manifest WHERE id = ?',[id]);
    if(confirmed.length!==1||confirmed[0].status!=='verified')throw Error('verified_backup_commit_missing');
    return{id,createdAt,sourceRevision:report.revision,encryptedBytes:Buffer.byteLength(encoded),chunkCount:parts.length,counts:report.counts,adminBindings:report.adminBindings,outbox:report.outbox,verified:true};
  }
  return{findDatabase,query,ensureSchema,listBackups,getBackup,saveBackup};
}
