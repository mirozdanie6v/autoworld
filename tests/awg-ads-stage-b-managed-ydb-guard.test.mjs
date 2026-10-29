import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAdsManagedStagingConfig} from '../scripts/prepare-awg-ads-stage-b-staging.mjs';
const base={
  AWG_ADS_STAGE_B_YDB_CONNECTION_STRING:
    'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnnewstage000001',
  AWG_ADS_STAGE_B_EXPECTED_YDB_DATABASE_ID:'etnnewstage000001',
  YDB_CONNECTION_STRING:
    'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etn00ojk5iv1u7dgpdar',
  YDB_ACCESS_TOKEN_CREDENTIALS:'temporary-test-only'
};
test('inspection cannot create a schema and rejects any primary or VK staging YDB',()=>{
  assert.equal(validateAdsManagedStagingConfig(base).mode,'inspect');
  for(const dbId of ['etn00ojk5iv1u7dgpdar','etnhujtu1t6f89tdtohs']){
    assert.throws(()=>validateAdsManagedStagingConfig({
      ...base,AWG_ADS_STAGE_B_EXPECTED_YDB_DATABASE_ID:dbId,
      AWG_ADS_STAGE_B_YDB_CONNECTION_STRING:
        base.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING.replace('etnnewstage000001',dbId)
    }),/isolation_not_proven/);
  }
  assert.throws(()=>validateAdsManagedStagingConfig({...base,
    YDB_CONNECTION_STRING:base.AWG_ADS_STAGE_B_YDB_CONNECTION_STRING}),/isolation_not_proven/);
});
test('schema apply requires explicit isolated-only permission and expected database ID',()=>{
  assert.throws(()=>validateAdsManagedStagingConfig({...base,
    AWG_ADS_STAGE_B_SCHEMA_ACTION:'apply'}),/not_approved/);
  assert.equal(validateAdsManagedStagingConfig({...base,
    AWG_ADS_STAGE_B_SCHEMA_ACTION:'apply',
    AWG_ADS_STAGE_B_SCHEMA_APPROVED:'isolated-ads-only'}).mode,'apply');
  assert.throws(()=>validateAdsManagedStagingConfig({...base,
    AWG_ADS_STAGE_B_EXPECTED_YDB_DATABASE_ID:'etnWRONG'}),/isolation_not_proven/);
  assert.throws(()=>validateAdsManagedStagingConfig({...base,
    YDB_ACCESS_TOKEN_CREDENTIALS:''}),/iam_token_required/);
});
