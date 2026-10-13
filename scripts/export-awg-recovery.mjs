import {writeFile} from 'node:fs/promises';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {createYdbDomainStore} from '../server/ydb-domain-store.mjs';
import {createRecoveryBackup,encryptRecoveryBackup,validateRecoveryBackup} from '../server/migration-backup.mjs';

const output=process.argv[2];
if(!output||!output.endsWith('.enc'))throw new Error('Provide an output path ending in .enc');
const token=process.env.YDB_ACCESS_TOKEN_CREDENTIALS,key=process.env.AWG_BACKUP_ENCRYPTION_KEY;
if(!token||!key||!process.env.YDB_CONNECTION_STRING)throw new Error('YDB connection, IAM token and backup encryption key are required');
const expectedDatabase=process.env.AWG_SOURCE_DATABASE_ID||'etn00ojk5iv1u7dgpdar';
const databasePath=new URL(process.env.YDB_CONNECTION_STRING).searchParams.get('database')||'';
if(!databasePath.endsWith('/'+expectedDatabase))throw new Error('YDB connection does not match the declared AWG production database');
const domain=await createYdbDomainStore({connectionString:process.env.YDB_CONNECTION_STRING,credentialsProvider:new AccessTokenCredentialsProvider({token}),ensureSchema:false});
try{
  const backup=createRecoveryBackup(await domain.loadRecoverySnapshot(),{source:{namespace:'AWG',repository:'mirozdanie6v/autoworld',databaseId:expectedDatabase}});
  await writeFile(output,JSON.stringify(encryptRecoveryBackup(backup,key)),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({ok:true,encrypted:true,...validateRecoveryBackup(backup)}));
}finally{await domain.close()}
