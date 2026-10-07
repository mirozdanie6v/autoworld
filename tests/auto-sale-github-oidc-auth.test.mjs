import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {resetGitHubOidcJwksCache,verifyGitHubCatalogOidcToken} from '../server/github-oidc-auth.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});
const kid='test-kid';

function token(overrides={}){
  const now=1_800_000_000;
  const header={alg:'RS256',typ:'JWT',kid};
  const claims={
    iss:'https://token.actions.githubusercontent.com',
    aud:'autoworld-catalog-import',
    repository:'mirozdanie6v/autoworld',
    ref:'refs/heads/main',
    workflow_ref:'mirozdanie6v/autoworld/.github/workflows/sync-awg-catalog.yml@refs/heads/main',
    iat:now-5,
    nbf:now-5,
    exp:now+300,
    ...overrides
  };
  const h=Buffer.from(JSON.stringify(header)).toString('base64url');
  const p=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s=sign('RSA-SHA256',Buffer.from(`${h}.${p}`),privateKey).toString('base64url');
  return `${h}.${p}.${s}`;
}
const fetchImpl=async()=>({ok:true,json:async()=>({keys:[{...jwk,kid,kty:'RSA'}]})});

test('accepts only canonical autoworld catalog workflow token',async()=>{
  resetGitHubOidcJwksCache();
  const result=await verifyGitHubCatalogOidcToken(token(),{fetchImpl,nowSeconds:1_800_000_000});
  assert.equal(result.ok,true);
});

test('rejects token from another repository',async()=>{
  resetGitHubOidcJwksCache();
  const result=await verifyGitHubCatalogOidcToken(token({repository:'mirozdanie6v/uniq-smart-rent'}),{fetchImpl,nowSeconds:1_800_000_000});
  assert.deepEqual(result,{ok:false,error:'repository'});
});

test('rejects token from another workflow or ref',async()=>{
  resetGitHubOidcJwksCache();
  const wrongWorkflow=await verifyGitHubCatalogOidcToken(token({workflow_ref:'mirozdanie6v/autoworld/.github/workflows/verify-autoworld.yml@refs/heads/main'}),{fetchImpl,nowSeconds:1_800_000_000});
  assert.deepEqual(wrongWorkflow,{ok:false,error:'workflow_ref'});
  const wrongRef=await verifyGitHubCatalogOidcToken(token({ref:'refs/heads/dev'}),{fetchImpl,nowSeconds:1_800_000_000});
  assert.deepEqual(wrongRef,{ok:false,error:'ref'});
});
