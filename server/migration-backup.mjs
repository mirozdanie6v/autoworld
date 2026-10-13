import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {autoSaleStateHash,domainRowsToLegacyState} from './ydb-domain-migration.mjs';

const kinds=['leads','quotes','orders','payments','notes','team','catalog','telegramBindings'];
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const rowKey=(kind,row)=>JSON.stringify([kind==='payments'?row.orderId:kind==='notes'?row.leadId:kind==='telegramBindings'?row.subjectType:'',kind==='telegramBindings'?row.subjectId:row.id]);
const keyBytes=value=>{const key=Buffer.from(String(value||''),'base64');if(key.length!==32)throw new Error('AWG_BACKUP_ENCRYPTION_KEY must be a base64 32-byte key');return key};

export function createRecoveryBackup(recovery,{source,exportedAt=new Date().toISOString()}={}){
  const unsigned={format:'awg-recovery-v1',source,exportedAt,snapshot:recovery.snapshot,adminAccess:recovery.adminAccess,outbox:recovery.outbox};
  const backup={...unsigned,checksum:digest(unsigned)};
  validateRecoveryBackup(backup);
  return backup;
}
export function validateRecoveryBackup(backup){
  if(backup?.format!=='awg-recovery-v1')throw new Error('unsupported_backup_format');
  const {checksum,...unsigned}=backup;
  if(checksum!==digest(unsigned))throw new Error('backup_checksum_mismatch');
  if(backup.source?.namespace!=='AWG')throw new Error('backup_source_namespace_required');
  const revision=Number(backup.snapshot?.meta?.sourceRevision);
  if(!Number.isSafeInteger(revision)||revision<1||backup.snapshot?.meta?.schemaVersion!==1)throw new Error('backup_revision_or_schema_invalid');
  if(!Array.isArray(backup.adminAccess)||!Array.isArray(backup.outbox))throw new Error('backup_controls_missing');
  const identities=new Set(),users=new Set();
  for(const pin of backup.adminAccess){
    if(!pin.username||identities.has(pin.username)||!/^\d+$/.test(pin.telegramUserId)||users.has(pin.telegramUserId))throw new Error('backup_admin_identity_invalid');
    identities.add(pin.username);users.add(pin.telegramUserId);
  }
  const outboxIds=new Set();
  for(const row of backup.outbox){
    if(!row.id||outboxIds.has(row.id)||!['pending','retry','processing','sent','dead'].includes(row.status)||!row.payload||typeof row.payload!=='object')throw new Error('backup_outbox_invalid');
    if(!Number.isSafeInteger(row.attempts)||row.attempts<0||[row.nextAttemptAt,row.createdAt,row.updatedAt].some(at=>!Number.isFinite(Date.parse(at))))throw new Error('backup_outbox_metadata_invalid');
    outboxIds.add(row.id);
  }
  let total=0;
  for(const kind of kinds){
    const rows=backup.snapshot?.rows?.[kind];
    if(!Array.isArray(rows))throw new Error(`backup_${kind}_missing`);
    const keys=new Set();
    for(const row of rows){
      const id=kind==='telegramBindings'?row.subjectId:row.id,key=rowKey(kind,row);
      if(!id||keys.has(key))throw new Error('backup_duplicate_or_empty_row_id');
      keys.add(key);
      if(['leads','quotes','orders','team','catalog'].includes(kind)&&(!Number.isSafeInteger(row.rowVersion)||row.rowVersion<1||row.rowVersion>revision))throw new Error('backup_row_version_invalid');
    }
    total+=rows.length;
  }
  if(!total)throw new Error('empty_production_backup_refused');
  const state=domainRowsToLegacyState(backup.snapshot.rows,{revision,initialized:true});
  return{revision,stateHash:autoSaleStateHash(state),counts:Object.fromEntries(kinds.map(kind=>[kind,backup.snapshot.rows[kind].length])),adminBindings:backup.adminAccess.length,outbox:backup.outbox.length,checksum};
}
export function encryptRecoveryBackup(backup,key){
  validateRecoveryBackup(backup);
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBytes(key),iv);
  cipher.setAAD(Buffer.from('awg-recovery-v1'));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(backup)),cipher.final()]);
  return{format:'awg-encrypted-recovery-v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
}
export function decryptRecoveryBackup(envelope,key){
  if(envelope?.format!=='awg-encrypted-recovery-v1')throw new Error('encrypted_backup_required');
  const decipher=createDecipheriv('aes-256-gcm',keyBytes(key),Buffer.from(envelope.iv,'base64'));
  decipher.setAAD(Buffer.from('awg-recovery-v1'));
  decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  const backup=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString());
  validateRecoveryBackup(backup);
  return backup;
}
