import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReleaseRequest,verifyReleasedConfiguration} from '../scripts/auto-sale-vk-release-config.mjs';
const sha='26901f48217bfa5e118a2ee8972fda8c4a277858';
const options={environment:'production',expectedRevision:'prod-old',targetSha:sha};
function fixture(){return{
  id:'prod-old',containerId:'bba691o7au7epjqvs77b',status:'ACTIVE',createdAt:'2026-10-10T00:00:00Z',serviceAccountId:'aje8o9ric0d20k11521r',resources:{memory:'536870912',cores:'1',coreFraction:'100'},executionTimeout:'60s',concurrency:'1',runtime:{http:{}},
  image:{imageUrl:'old-image',imageDigest:'old-digest',command:{command:[]},args:{args:[]},workingDir:'',environment:{
    YDB_CONNECTION_STRING:'grpcs://example/?database=/etn00ojk5iv1u7dgpdar',AUTO_SALE_VK_WEB_ENABLED:'true',AUTO_SALE_VK_WEB_CLIENT_ID:'54811927',AUTO_SALE_VK_WEB_ORIGIN:'https://awgcars.ru',AUTO_SALE_PUBLIC_DEMO_WRITE:'false',AUTO_SALE_YDB_READ_MODE:'normalized',AUTO_SALE_YDB_DUAL_WRITE:'false',AUTO_SALE_LEGACY_STATE_WRITE:'false',AUTO_SALE_VK_ENABLED:'true',AUTO_SALE_VK_APP_ID:'54810434',AUTO_SALE_VK_GROUP_ID:'242103542',
    AUTO_SALE_TELEGRAM_BOT_TOKEN:'test-telegram-not-a-secret',AUTO_SALE_VK_APP_SECRET:'test-app-not-a-secret',AUTO_SALE_VK_COMMUNITY_TOKEN:'test-community-not-a-secret',AUTO_SALE_API_KEY:'test-key-not-a-secret',AUTO_SALE_BUILD_SHA:'old-build',EXTRA:'commas,quotes" and\nnewlines'
  }},secrets:[{id:'test-secret',versionId:'test-version',key:'cookie-key',environmentVariable:'AUTO_SALE_VK_WEB_COOKIE_KEY'}],
  connectivity:{networkId:'network',subnetIds:['subnet']},provisionPolicy:{minInstances:'1'},logOptions:{folderId:'logs',minLevel:'INFO'},scalingPolicy:{zoneInstancesLimit:'1'},metadataOptions:{gceHttpEndpoint:'ENABLED',awsV1HttpEndpoint:'DISABLED'},asyncInvocationConfig:{serviceAccountId:'async'},storageMounts:[],mounts:[]
}}
test('release changes only the image, build marker and description; preserves credentials and complete runtime configuration',()=>{
  const previous=fixture(),request=buildReleaseRequest(previous,options);
  assert.equal(request.imageSpec.imageUrl,`cr.yandex/crptu0l7jn0iui8b8laa/autoworld-awg:vk-web-candidate-${sha}`);
  assert.deepEqual(request.imageSpec.environment,{...previous.image.environment,AUTO_SALE_BUILD_SHA:sha});
  for(const key of ['resources','secrets','connectivity','provisionPolicy','logOptions','scalingPolicy','metadataOptions','asyncInvocationConfig','storageMounts','mounts'])assert.deepEqual(request[key],previous[key]);
  const current={...previous,id:'new',image:{...previous.image,...request.imageSpec}};
  assert.equal(verifyReleasedConfiguration(previous,current,options),true);
  current.secrets=[];assert.throws(()=>verifyReleasedConfiguration(previous,current,options),/release_configuration_not_preserved/);
});
test('wrong revision, database, identity, unknown configuration or disabled existing channel aborts before deployment',()=>{
  for(const change of [r=>r.id='other',r=>r.status='OBSOLETE',r=>r.containerId='staging',r=>r.serviceAccountId='other',r=>r.image.environment.YDB_CONNECTION_STRING='staging',r=>r.image.environment.AUTO_SALE_VK_ENABLED='false',r=>r.unknownConfig={},r=>delete r.secrets[0].versionId]){
    const r=fixture();change(r);assert.throws(()=>buildReleaseRequest(r,options),/^Error: release_/);
  }
});
test('staging remains isolated with both messaging channels disabled',()=>{
  const r=fixture();r.id='stage-old';r.containerId='bbag75c5g7vup8sfbmop';r.serviceAccountId='ajeqbteofv8negiuhdae';
  const e=r.image.environment;e.YDB_CONNECTION_STRING='grpcs://example/?database=/etnhujtu1t6f89tdtohs';e.AUTO_SALE_VK_WEB_ORIGIN='https://vk-test.awgcars.ru';
  for(const k of ['AUTO_SALE_VK_ENABLED','AUTO_SALE_VK_COMMUNITY_TOKEN','AUTO_SALE_TELEGRAM_BOT_TOKEN'])delete e[k];
  r.secrets.push({id:'stage-key',versionId:'stage-version',key:'api-key',environmentVariable:'AUTO_SALE_API_KEY'});
  const o={environment:'staging',expectedRevision:r.id,targetSha:sha};
  const request=buildReleaseRequest(r,o);assert.equal(request.imageSpec.environment.AUTO_SALE_VK_ENABLED,undefined);
  e.AUTO_SALE_VK_COMMUNITY_TOKEN='real-routing-must-not-be-enabled';assert.throws(()=>buildReleaseRequest(r,o),/release_staging_messaging_must_be_disabled/);
});
