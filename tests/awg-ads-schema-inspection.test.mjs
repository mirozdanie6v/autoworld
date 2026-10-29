import test from 'node:test';
import assert from 'node:assert/strict';
import {create,toBinary} from '@bufbuild/protobuf';
import {Entry_Type,ListDirectoryResultSchema} from '@ydbjs/api/scheme';
import {inspectAdsStagingTables} from '../scripts/awg-ads-schema-inspection.mjs';

const path='/ru-central1/b1ggsmuiq7tb2d27f89q/etnseoqfsf7ojn52813t';
const tables=['awg_ads_campaigns','awg_ads_job_audit'];
const table=name=>({name,type:Entry_Type.TABLE});
const reply=(children,status=400000)=>({operation:{ready:true,status,result:{
  typeUrl:'type.googleapis.com/Ydb.Scheme.ListDirectoryResult',
  value:toBinary(ListDirectoryResultSchema,create(ListDirectoryResultSchema,{children}))
}}});
const driver=response=>({createClient:()=>({listDirectory:async (input)=>{
  assert.deepEqual(input,{path});
  return response;
}})});

test('read-only metadata detects tables with only one SchemeService request',async()=>{
  const result=await inspectAdsStagingTables(driver(reply(tables.map(table))),path,tables);
  assert.deepEqual(result,{count:2});
});
test('missing table or wrong object type fails closed',async()=>{
  for(const entries of [[table(tables[0])],[table(tables[0]),{
    name:tables[1],type:Entry_Type.DIRECTORY
  }]]){
    await assert.rejects(inspectAdsStagingTables(driver(reply(entries)),path,tables),
      /ads_schema_missing_tables_awg_ads_job_audit/);
  }
});
test('rejects wrong database, schema error and malformed metadata',async()=>{
  await assert.rejects(inspectAdsStagingTables(driver(reply(tables.map(table))),
    '/ru-central1/b1ggsmuiq7tb2d27f89q/etn00ojk5iv1u7dgpdar',tables),/target_invalid/);
  await assert.rejects(inspectAdsStagingTables(driver(reply([],400070)),path,tables),
    /ads_schema_list_failed_400070/);
  await assert.rejects(inspectAdsStagingTables(driver({operation:{ready:true,status:400000}}),path,tables),
    /ads_schema_list_result_invalid/);
});
