/**
 * Read-only AWG YDB snapshot -> AES-256-GCM/gzip in RAM -> Cloudflare D1.
 * Never writes to YDB. No application credentials or plaintext in D1/logs.
 */
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {createRecoveryBackup,validateRecoveryBackup} from '../server/migration-backup.mjs';
import {createCloudflareD1BackupClient,AWG_D1_BACKUP_DATABASE} from '../server/cloudflare-d1-backup.mjs';

const expectedDb='etn00ojk5iv1u7dgpdar';
const expectedCf='f4935962036fd500d34335e0b174b227';
const required=(name)=>{
  const value=String(process.env[name]||'').trim();
  if(!value)throw Error('missing_'+name);
  return value;
};
const key=required('AWG_BACKUP_ENCRYPTION_KEY');
const accountId=required('CLOUDFLARE_ACCOUNT_ID');
if(accountId!==expectedCf)throw Error('unexpected_cloudflare_backup_account');
const client=createCloudflareD1BackupClient({
  accountId,apiToken:required('AWG_CF_D1_BACKUP_TOKEN')
});
const createDb=process.env.AWG_CF_D1_ALLOW_CREATE==='yes';
if(createDb&&process.env.AWG_CF_D1_BOOTSTRAP_GUARD!=='AWG_D1_CREATE_ONLY_20261015')throw Error('unauthorized_d1_provision');
const databaseId=await client.findDatabase({create:createDb});
await client.ensureSchema(databaseId);
const operation=process.argv[2]||'backup';
if(!['backup','verify-latest','list'].includes(operation))throw Error('unsupported_backup_action');

if(operation==='list'){
  const backups=await client.listBackups(databaseId,{limit:30});
  console.log('AWG_CLOUDFLARE_D1_BACKUPS',JSON.stringify({database:AWG_D1_BACKUP_DATABASE,
    verified:backups.length,items:backups.map(x=>({id:x.id,at:x.created_at,revision:x.source_revision,
      encryptedBytes:x.encrypted_size,status:x.status}))}));
  process.exit(0);
}
if(operation==='verify-latest'){
  const list=await client.listBackups(databaseId,{limit:1});
  if(!list.length)throw Error('no_verified_cloudflare_backup_available');
  const retrieved=await client.getBackup(databaseId,list[0].id,key);
  if(retrieved.backup.source?.databaseId!==expectedDb)throw Error('unexpected_backup_source');
  console.log('AWG_CLOUDFLARE_D1_RESTORE_DRILL',JSON.stringify({
    ok:true,backupId:list[0].id,revision:retrieved.report.revision,
    counts:retrieved.report.counts,adminBindings:retrieved.report.adminBindings,
    outbox:retrieved.report.outbox,source:expectedDb,restoredToProduction:false
  }));
  process.exit(0);
}
if(!process.env.GITHUB_RUN_ID)throw Error('expected_github_actions_runner');
const token=required('YDB_ACCESS_TOKEN_CREDENTIALS');
const connectionString=required('YDB_CONNECTION_STRING');
if(!connectionString.startsWith('grpcs://ydb.serverless.yandexcloud.net:2135/'))throw Error('unexpected_ydb_endpoint');
const databasePath=new URL(connectionString).searchParams.get('database')||'';
if(!databasePath.endsWith('/'+expectedDb))throw Error('wrong_ydb_database_refuse_export');

const domain=await createYdbDomainStore({
  connectionString,credentialsProvider:new AccessTokenCredentialsProvider({token}),ensureSchema:false
});
let recovery;
try{
  // Single snapshotReadOnly YDB transaction covers normalized business tables,
  // admin bindings and notification outbox (including sent history).
  recovery=await domain.loadRecoverySnapshot();
}finally{await domain.close()}
const source={namespace:'AWG',repository:'mirozdanie6v/autoworld',databaseId:expectedDb};
const backup=createRecoveryBackup(recovery,{source});
const preflight=validateRecoveryBackup(backup);
if(preflight.revision<1)throw Error('empty_ydb_revision_refused');
if(preflight.counts.team<1||preflight.counts.catalog<1)throw Error('suspiciously_empty_production_snapshot');
const saved=await client.saveBackup(databaseId,backup,key);
const verified=await client.getBackup(databaseId,saved.id,key);
if(verified.report.checksum!==preflight.checksum||verified.report.stateHash!==preflight.stateHash)throw Error('cloudflare_roundtrip_checksum_mismatch');
console.log('AWG_YDB_CLOUDFLARE_BACKUP_SUCCESS',JSON.stringify({
  cloudflareDatabase:AWG_D1_BACKUP_DATABASE,backupId:saved.id,at:saved.createdAt,
  revision:saved.sourceRevision,encryptedBytes:saved.encryptedBytes,chunks:saved.chunkCount,
  counts:saved.counts,adminBindings:saved.adminBindings,outbox:saved.outbox,
  encryption:'AES-256-GCM',compression:'gzip',verified:true,
  ydbWrites:0,productionRestore:false
}));
