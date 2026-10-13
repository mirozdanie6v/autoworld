import {readFile} from 'node:fs/promises';
import {decryptRecoveryBackup,validateRecoveryBackup} from '../server/migration-backup.mjs';
import {createPostgresRuntimeStores} from '../server/postgres-runtime-store.mjs';
import {autoSaleStateHash} from '../server/ydb-domain-migration.mjs';

const file=process.argv[2];
if(!file||!process.env.DATABASE_URL||!process.env.AWG_BACKUP_ENCRYPTION_KEY)throw new Error('Encrypted backup path, DATABASE_URL and AWG_BACKUP_ENCRYPTION_KEY are required');
if(process.env.AWG_RESTORE_TARGET!=='timeweb-staging')throw new Error('AWG_RESTORE_TARGET must be timeweb-staging');
const backup=decryptRecoveryBackup(JSON.parse(await readFile(file,'utf8')),process.env.AWG_BACKUP_ENCRYPTION_KEY);
const report=validateRecoveryBackup(backup);
const stores=await createPostgresRuntimeStores({databaseUrl:process.env.DATABASE_URL,ensureSchema:true});
try{
  await stores.importBackup(backup);
  const restored=await stores.domainStore.loadState();
  if(autoSaleStateHash(restored)!==report.stateHash)throw new Error('restored_state_hash_mismatch');
  const pins=await stores.legacyStore.adminAccessList();
  if(pins.length!==report.adminBindings)throw new Error('restored_admin_binding_count_mismatch');
  const stats=await stores.legacyStore.notificationStats();
  if(Object.values(stats).reduce((a,b)=>a+b,0)!==report.outbox)throw new Error('restored_outbox_count_mismatch');
  console.log(JSON.stringify({ok:true,target:'timeweb-staging',...report}));
}finally{await stores.close()}
