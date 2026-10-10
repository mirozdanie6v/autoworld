import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const SHARED={memory:'536870912',cores:'1',coreFraction:'100'};
const TARGETS={
  production:{id:'bba691o7au7epjqvs77b',sa:'aje8o9ric0d20k11521r',db:'/etn00ojk5iv1u7dgpdar',origin:'https://awgcars.ru'},
  staging:{id:'bbag75c5g7vup8sfbmop',sa:'ajeqbteofv8negiuhdae',db:'/etnhujtu1t6f89tdtohs',origin:'https://vk-test.awgcars.ru'}
};
const CONFIG_FIELDS=['resources','executionTimeout','serviceAccountId','concurrency','connectivity','provisionPolicy','secrets','logOptions','scalingPolicy','storageMounts','mounts','runtime','metadataOptions','asyncInvocationConfig'];
const REQUIRED_KEYS=['YDB_CONNECTION_STRING','AUTO_SALE_VK_WEB_ENABLED','AUTO_SALE_VK_WEB_CLIENT_ID','AUTO_SALE_VK_WEB_ORIGIN','AUTO_SALE_PUBLIC_DEMO_WRITE','AUTO_SALE_YDB_READ_MODE','AUTO_SALE_YDB_DUAL_WRITE','AUTO_SALE_LEGACY_STATE_WRITE'];
const requireFlag=(condition,message)=>{if(!condition)throw new Error(message)};

// Input is the REST GetRevision shape. Never include input values in errors.
export function buildReleaseRequest(revision,{environment,expectedRevision,targetSha}={}){
  const target=TARGETS[environment];
  requireFlag(Boolean(target),'release_environment_invalid');
  requireFlag(/^[a-f0-9]{40}$/.test(targetSha||''),'release_commit_invalid');
  requireFlag(revision?.status==='ACTIVE','release_revision_not_active');
  requireFlag(revision.id===expectedRevision,'release_revision_changed');
  requireFlag(revision.containerId===target.id&&revision.serviceAccountId===target.sa,'release_target_mismatch');
  requireFlag(Object.entries(SHARED).every(([key,value])=>String(revision.resources?.[key])===value),'release_resources_changed');
  const env=revision.image?.environment||{};
  requireFlag(REQUIRED_KEYS.every(key=>typeof env[key]==='string'),'release_flags_missing');
  requireFlag(env.YDB_CONNECTION_STRING.endsWith(target.db),'release_database_mismatch');
  requireFlag(env.AUTO_SALE_PUBLIC_DEMO_WRITE==='false'&&env.AUTO_SALE_YDB_READ_MODE==='normalized'&&env.AUTO_SALE_YDB_DUAL_WRITE==='false'&&env.AUTO_SALE_LEGACY_STATE_WRITE==='false','release_storage_mode_mismatch');
  requireFlag(env.AUTO_SALE_VK_WEB_ENABLED==='true'&&env.AUTO_SALE_VK_WEB_CLIENT_ID==='54811927'&&env.AUTO_SALE_VK_WEB_ORIGIN===target.origin,'release_web_config_mismatch');
  requireFlag(revision.runtime?.http&& !revision.runtime?.task,'release_runtime_mismatch');
  const secrets=revision.secrets||[];
  requireFlag(secrets.every(row=>row.id&&row.versionId&&row.key&&row.environmentVariable),'release_secret_not_pinned');
  requireFlag(secrets.some(row=>row.environmentVariable==='AUTO_SALE_VK_WEB_COOKIE_KEY'&&row.key==='cookie-key'),'release_session_binding_missing');
  if(environment==='production'){
    requireFlag(env.AUTO_SALE_VK_ENABLED==='true'&&env.AUTO_SALE_VK_APP_ID==='54810434'&&env.AUTO_SALE_VK_GROUP_ID==='242103542','release_mini_config_mismatch');
    requireFlag(['AUTO_SALE_TELEGRAM_BOT_TOKEN','AUTO_SALE_VK_APP_SECRET','AUTO_SALE_VK_COMMUNITY_TOKEN','AUTO_SALE_API_KEY'].every(key=>String(env[key]||'').length>15),'release_existing_credentials_missing');
  }else{
    requireFlag(!/^(true|1|yes)$/i.test(env.AUTO_SALE_VK_ENABLED||'')&&!env.AUTO_SALE_VK_COMMUNITY_TOKEN&&!env.AUTO_SALE_TELEGRAM_BOT_TOKEN,'release_staging_messaging_must_be_disabled');
    requireFlag(secrets.length===2&&secrets.every(row=>['AUTO_SALE_API_KEY','AUTO_SALE_VK_WEB_COOKIE_KEY'].includes(row.environmentVariable)),'release_staging_bindings_changed');
  }
  const allowed=new Set(['id','containerId','description','createdAt','image','status',...CONFIG_FIELDS]);
  requireFlag(Object.keys(revision).every(key=>allowed.has(key)),'release_unknown_configuration');
  requireFlag(Object.keys(revision.image).every(key=>['imageUrl','imageDigest','command','args','environment','workingDir'].includes(key)),'release_unknown_image_configuration');
  const request={containerId:target.id,description:'VK request links, independent notifications and channel analytics'};
  for(const key of CONFIG_FIELDS)if(revision[key]!==undefined)request[key]=structuredClone(revision[key]);
  request.imageSpec={imageUrl:`cr.yandex/crptu0l7jn0iui8b8laa/autoworld-awg:vk-web-candidate-${targetSha}`};
  for(const key of ['command','args','workingDir'])if(revision.image[key]!==undefined)request.imageSpec[key]=structuredClone(revision.image[key]);
  request.imageSpec.environment={...env,AUTO_SALE_BUILD_SHA:targetSha};
  return request;
}

export function verifyReleasedConfiguration(previous,current,options){
  const request=buildReleaseRequest(previous,options);
  requireFlag(current?.status==='ACTIVE'&&current.containerId===request.containerId,'release_activation_failed');
  try{
    for(const key of CONFIG_FIELDS)if(request[key]!==undefined)assert.deepEqual(current[key],request[key]);
    assert.equal(current.image?.imageUrl,request.imageSpec.imageUrl);
    for(const key of ['command','args','workingDir','environment'])if(request.imageSpec[key]!==undefined)assert.deepEqual(current.image?.[key],request.imageSpec[key]);
  }catch{throw new Error('release_configuration_not_preserved')}
  return true;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [mode,file,environment,expectedRevision,targetSha,currentFile]=process.argv.slice(2);
    const previous=JSON.parse(readFileSync(file,'utf8')),options={environment,expectedRevision,targetSha};
    if(mode==='build')process.stdout.write(JSON.stringify(buildReleaseRequest(previous,options)));
    else if(mode==='verify'){verifyReleasedConfiguration(previous,JSON.parse(readFileSync(currentFile,'utf8')),options);process.stdout.write('Runtime configuration preserved.\n')}
    else throw new Error('release_command_invalid');
  }catch(error){console.error(/^release_/.test(error.message)?error.message:'release_configuration_invalid');process.exitCode=1}
}
