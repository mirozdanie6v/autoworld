import {pathToFileURL} from 'node:url';
import {createPostgresRuntimeStores} from '../server/postgres-runtime-store.mjs';
import {canonicalAutoSaleTeam} from '../shared/auto-sale-manager-directory.mjs';

export const FRESH_CONFIRM='I_ACCEPT_EMPTY_AWG_STAGING';
const STAGING_HOSTS=new Set(['timeweb-staging.viiversion.com','awg-timeweb-staging.viiversion.com']);

export function assertFreshInstallScope({stagingHost,confirmation}={}){
  if(confirmation!==FRESH_CONFIRM)throw new Error('fresh_install_explicit_confirmation_required');
  if(!STAGING_HOSTS.has(String(stagingHost||'').trim().toLowerCase()))throw new Error('fresh_install_staging_hostname_required');
}

export async function initializeFreshAwg(stores,{stagingHost,confirmation}={}){
  assertFreshInstallScope({stagingHost,confirmation});
  // Schema creation belongs to the caller. Never import or modify the YDB production data.
  const [snapshot,access,outbox]=await Promise.all([
    stores.domainStore.loadAuthoritativeSnapshot(),
    stores.legacyStore.adminAccessList(),
    stores.legacyStore.notificationStats()
  ]);
  const meta=snapshot.meta;
  const rowsEmpty=Object.values(snapshot.rows).every(rows=>Array.isArray(rows)&&rows.length===0);
  const outboxEmpty=Object.values(outbox).every(count=>Number(count)===0);
  if(Number(meta.sourceRevision)!==0||meta.migrationStatus!=='empty'||!rowsEmpty||access.length||!outboxEmpty){
    throw new Error('fresh_install_refuses_nonempty_database');
  }
  const before=await stores.domainStore.loadState();
  if(before.initialized||Number(before.revision)!==0)throw new Error('fresh_install_refuses_initialized_state');
  const team=canonicalAutoSaleTeam();
  const result=await stores.legacyStore.commitDomainState(
    before,{...before,initialized:true,team},
    {expectedRevision:0,notifications:[]}
  );
  if(result.status!==200||!result.data?.ok)throw new Error('fresh_install_write_failed_'+result.status);
  const after=await stores.domainStore.loadState();
  if(after.team.length!==team.length||after.leads.length||after.catalog.length){
    throw new Error('fresh_install_verification_failed');
  }
  return{
    ok:true,mode:'fresh-install',target:String(stagingHost).toLowerCase(),
    revision:Number(after.revision),managers:after.team.map(member=>member.name),
    catalogCount:0,leadsCount:0,telegramBindings:'pending-first-authentication',
    productionDnsChanged:false,productionWebhooksChanged:false
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const stagingHost=String(process.env.AWG_STAGING_HOST||'').trim();
  assertFreshInstallScope({stagingHost,confirmation:process.env.AWG_FRESH_CONFIRM});
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_required');
  const stores=await createPostgresRuntimeStores({databaseUrl:process.env.DATABASE_URL,ensureSchema:true});
  try{
    console.log(JSON.stringify(await initializeFreshAwg(stores,{
      stagingHost,confirmation:process.env.AWG_FRESH_CONFIRM
    })));
  }finally{await stores.close()}
}
