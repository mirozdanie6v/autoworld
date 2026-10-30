// Stage B bootstrap. In production this is inert unless every staging
// gate is explicitly enabled. No schema creation, migration or live routing.
import {Driver} from '@ydbjs/core';
import {query} from '@ydbjs/query';
import {MetadataCredentialsProvider} from '@ydbjs/auth/metadata';
import {createYdbAdsAttributionRepository} from './ads-attribution-ydb.mjs';
import {createAdsAttributionService} from './ads-attribution-core.mjs';
import {createAdsStageBBridge} from './ads-attribution-stage-b.mjs';
import {summarizeAdsCampaignsFromRepository} from './ads-attribution-report.mjs';

export function adsStageBConfiguration(env={}){
  const enabled=env.AWG_ADS_STAGE_B_ENABLED==='true';
  if(!enabled)return {enabled:false};
  if(env.AWG_ADS_STAGE_B_MODE!=='isolated-staging')
    throw new Error('ads_stage_b_isolated_staging_required');
  const connection=String(env.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING||'').trim();
  const mainConnection=String(env.YDB_CONNECTION_STRING||'').trim();
  if(!connection.startsWith('grpcs://ydb.serverless.yandexcloud.net:2135/?database=/')
    ||connection===mainConnection
    ||!mainConnection
    ||!String(env.AWG_ADS_STAGE_B_SUBJECT_SECRET||'').trim()
    ||String(env.AWG_ADS_STAGE_B_SUBJECT_SECRET).length<32){
    throw new Error('ads_stage_b_database_or_secret_invalid');
  }
  return {enabled:true,connection,subjectSecret:String(env.AWG_ADS_STAGE_B_SUBJECT_SECRET)};
}
export async function createAdsStageBServerBridge({
  env=process.env,onFailure=async()=>{},credentialsProvider
}={}){
  const config=adsStageBConfiguration(env);
  if(!config.enabled)return createAdsStageBBridge({enabled:false});
  const driver=new Driver(config.connection,{
    credentialsProvider:credentialsProvider||new MetadataCredentialsProvider()
  });
  try{
    await driver.ready();
    const repository=createYdbAdsAttributionRepository(query(driver));
    const service=createAdsAttributionService({
      repository,subjectSecret:config.subjectSecret
    });
    const bridge=createAdsStageBBridge({enabled:true,service,onFailure});
    // Runtime retains its own connection. No implicit schema creation,
    // event fanout or mutation of AWG's primary production database.
    return {...bridge,report:()=>summarizeAdsCampaignsFromRepository({repository}),close:()=>driver.close()};
  }catch(error){await driver.close();throw error;}
}
