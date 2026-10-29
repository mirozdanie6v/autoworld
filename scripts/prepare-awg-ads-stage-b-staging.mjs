// Explicit managed-staging schema preflight/migration. No production migrations.
// This script is inert without dedicated Ads YDB connection, verified ID,
// short-lived IAM token, and an additional write authorization switch.
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {AccessTokenCredentialsProvider} from '@ydbjs/auth/access-token';
import {ADS_ATTRIBUTION_TABLES,ensureAdsAttributionSchema} from '../server/ads-attribution-ydb.mjs';
import {inspectAdsStagingTables} from './awg-ads-schema-inspection.mjs';
import {ensureAdsOperationsSchema} from '../server/ads-stage-b-scheduled-jobs.mjs';

export function validateAdsManagedStagingConfig(env=process.env){
  const mode=String(env.AWG_ADS_STAGE_B_SCHEMA_ACTION||'inspect');
  if(!['inspect','apply'].includes(mode))throw new Error('ads_invalid_staging_schema_mode');
  const uri=String(env.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING||'').trim();
  const appUri=String(env.YDB_CONNECTION_STRING||'').trim();
  const expected=String(env.AWG_ADS_STAGE_B_EXPECTED_YDB_DATABASE_ID||'').trim();
  const match=uri.match(/^grpcs:\/\/ydb\.serverless\.yandexcloud\.net:2135\/\?database=\/ru-central1\/([a-z0-9]+)\/([a-z0-9]+)$/);
  if(!match||match[1]!=='b1ggsmuiq7tb2d27f89q'
    ||!expected||match[2]!==expected
    ||!/^etn[a-z0-9]{10,}$/i.test(expected)
    ||uri===appUri
    // Authoritative production CRM and previously created VK staging DB.
    ||['etn00ojk5iv1u7dgpdar','etnhujtu1t6f89tdtohs'].includes(expected))
    throw new Error('ads_managed_staging_isolation_not_proven');
  if(!String(env.YDB_ACCESS_TOKEN_CREDENTIALS||'').trim())
    throw new Error('ads_staging_iam_token_required');
  if(mode==='apply'&&env.AWG_ADS_STAGE_B_SCHEMA_APPROVED!=='isolated-ads-only')
    throw new Error('ads_staging_migration_not_approved');
  return {uri,mode,databaseId:expected};
}
if(process.argv[1]?.endsWith('/prepare-awg-ads-stage-b-staging.mjs')){
  const config=validateAdsManagedStagingConfig();
  const driver=new Driver(config.uri,{
    credentialsProvider:new AccessTokenCredentialsProvider({
      token:process.env.YDB_ACCESS_TOKEN_CREDENTIALS})
  });
  try{
    await driver.ready();
    const sql=query(driver);
    if(config.mode==='apply'){
      await ensureAdsAttributionSchema(sql,{target:'isolated-test-database'});
      await ensureAdsOperationsSchema(sql,{target:'isolated-test-database'});
    }
    // Inspect YDB SchemeService metadata rather than compiling nine SELECT
    // statements; no table rows are read, and missing tables fail closed.
    await inspectAdsStagingTables(driver,new URL(config.uri).searchParams.get('database'),
      ADS_ATTRIBUTION_TABLES.concat('awg_ads_job_leases','awg_ads_job_audit'));
    console.log('AWG_ADS_MANAGED_STAGING_SCHEMA_OK',JSON.stringify({
      mode:config.mode,databaseId:config.databaseId,
      tables:ADS_ATTRIBUTION_TABLES.length+2
    }));
  }finally{await driver.close();}
}
