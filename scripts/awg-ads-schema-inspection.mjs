// Read-only schema inventory, avoiding nine YQL query compilations on 10 RU/s staging.
import {fromBinary} from '@bufbuild/protobuf';
import {SchemeServiceDefinition,ListDirectoryResultSchema,Entry_Type} from '@ydbjs/api/scheme';

const STAGING_DB='/ru-central1/b1ggsmuiq7tb2d27f89q/etnseoqfsf7ojn52813t';
const YDB_SUCCESS=400000;

export async function inspectAdsStagingTables(driver,databasePath,expectedTables){
  if(databasePath!==STAGING_DB || typeof driver?.createClient!=='function'
    ||!Array.isArray(expectedTables)||expectedTables.length===0
    ||expectedTables.some(name=>typeof name!=='string'||!/^awg_ads_[a-z0-9_]+$/.test(name))){
    throw new Error('ads_schema_inspection_target_invalid');
  }
  const scheme=driver.createClient(SchemeServiceDefinition);
  const response=await scheme.listDirectory({path:databasePath});
  const op=response?.operation;
  if(op?.ready!==true || op.status!==YDB_SUCCESS){
    throw new Error('ads_schema_list_failed_'+(op?.status??'missing'));
  }
  const result=op.result;
  if(!result?.value||!String(result.typeUrl||'').endsWith('/Ydb.Scheme.ListDirectoryResult')){
    throw new Error('ads_schema_list_result_invalid');
  }
  const listing=fromBinary(ListDirectoryResultSchema,result.value);
  const tables=new Set((listing.children||[])
    .filter(entry=>entry.type===Entry_Type.TABLE).map(entry=>entry.name));
  const missing=expectedTables.filter(name=>!tables.has(name));
  if(missing.length)throw new Error('ads_schema_missing_tables_'+missing.join(','));
  return {count:expectedTables.length};
}
