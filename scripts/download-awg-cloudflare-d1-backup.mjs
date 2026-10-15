/**
 * Disaster recovery export. Downloads the latest VERIFIED D1 backup, decrypts
 * and checks it only in runner memory, then writes a fresh encrypted
 * awg-encrypted-recovery-v1 file (compatible with existing offline tooling).
 * Read-only to both Cloudflare D1 and Yandex; no production changes.
 */
import {writeFile} from 'node:fs/promises';
import {createCloudflareD1BackupClient} from '../server/cloudflare-d1-backup.mjs';
import {encryptRecoveryBackup} from '../server/migration-backup.mjs';
const output=process.argv[2];
if(!output||!output.endsWith('.enc'))throw Error('encrypted_output_path_ending_enc_required');
const id=process.argv[3]||'latest';
const key=String(process.env.AWG_BACKUP_ENCRYPTION_KEY||'');
const token=String(process.env.AWG_CF_D1_BACKUP_TOKEN||'');
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'');
if(!key||!token||account!=='f4935962036fd500d34335e0b174b227')throw Error('missing_archive_read_secrets_or_wrong_cloudflare_account');
const client=createCloudflareD1BackupClient({accountId:account,apiToken:token});
const db=await client.findDatabase();
const backups=await client.listBackups(db,{limit:100});
const selected=id==='latest'?backups[0]:backups.find(x=>x.id===id);
if(!selected)throw Error('requested_verified_backup_not_found');
const recovered=await client.getBackup(db,selected.id,key);
if(recovered.backup.source?.databaseId!=='etn00ojk5iv1u7dgpdar')throw Error('unexpected_source_database');
const encrypted=encryptRecoveryBackup(recovered.backup,key);
await writeFile(output,JSON.stringify(encrypted),{mode:0o600,flag:'wx'});
console.log('AWG_D1_ENCRYPTED_RECOVERY_EXPORTED',JSON.stringify({
  ok:true,backupId:selected.id,sourceRevision:recovered.report.revision,
  outputEncrypted:true,plaintextStored:false,productionRestored:false
}));
