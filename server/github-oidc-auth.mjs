import {createPublicKey,verify as verifySignature} from 'node:crypto';

const ISSUER='https://token.actions.githubusercontent.com';
const JWKS_URL='https://token.actions.githubusercontent.com/.well-known/jwks';
const DEFAULT_AUDIENCE='autoworld-catalog-import';
const DEFAULT_REPOSITORY='mirozdanie6v/autoworld';
const DEFAULT_REF='refs/heads/main';
const DEFAULT_WORKFLOW_REF='mirozdanie6v/autoworld/.github/workflows/sync-awg-catalog.yml@refs/heads/main';

let cachedJwks=null;
let cachedAt=0;
const CACHE_MS=60*60*1000;

const decodePart=value=>JSON.parse(Buffer.from(String(value||''),'base64url').toString('utf8'));
const audienceIncludes=(aud,expected)=>Array.isArray(aud)?aud.includes(expected):String(aud||'')===expected;

async function getJwks(fetchImpl=fetch){
  const now=Date.now();
  if(cachedJwks&&now-cachedAt<CACHE_MS)return cachedJwks;
  const response=await fetchImpl(JWKS_URL,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`github_oidc_jwks_failed_${response.status}`);
  const data=await response.json();
  if(!Array.isArray(data?.keys)||!data.keys.length)throw new Error('github_oidc_jwks_empty');
  cachedJwks=data.keys;
  cachedAt=now;
  return cachedJwks;
}

export function resetGitHubOidcJwksCache(){
  cachedJwks=null;
  cachedAt=0;
}

export async function verifyGitHubCatalogOidcToken(token,{
  fetchImpl=fetch,
  nowSeconds=Math.floor(Date.now()/1000),
  audience=DEFAULT_AUDIENCE,
  repository=DEFAULT_REPOSITORY,
  ref=DEFAULT_REF,
  workflowRef=DEFAULT_WORKFLOW_REF
}={}){
  try{
    const parts=String(token||'').split('.');
    if(parts.length!==3)return{ok:false,error:'jwt_format'};
    const [encodedHeader,encodedPayload,encodedSignature]=parts;
    const header=decodePart(encodedHeader);
    const claims=decodePart(encodedPayload);
    if(header?.alg!=='RS256'||!header?.kid)return{ok:false,error:'jwt_header'};
    if(claims?.iss!==ISSUER)return{ok:false,error:'issuer'};
    if(!audienceIncludes(claims?.aud,audience))return{ok:false,error:'audience'};
    if(String(claims?.repository||'')!==repository)return{ok:false,error:'repository'};
    if(String(claims?.ref||'')!==ref)return{ok:false,error:'ref'};
    if(String(claims?.workflow_ref||'')!==workflowRef)return{ok:false,error:'workflow_ref'};
    const exp=Number(claims?.exp)||0;
    const nbf=Number(claims?.nbf)||0;
    const iat=Number(claims?.iat)||0;
    if(!exp||exp<nowSeconds-30)return{ok:false,error:'expired'};
    if(nbf&&nbf>nowSeconds+30)return{ok:false,error:'not_before'};
    if(iat&&iat>nowSeconds+30)return{ok:false,error:'issued_at'};
    const keys=await getJwks(fetchImpl);
    const jwk=keys.find(item=>item?.kid===header.kid&&item?.kty==='RSA');
    if(!jwk)return{ok:false,error:'kid'};
    const key=createPublicKey({key:jwk,format:'jwk'});
    const valid=verifySignature(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      key,
      Buffer.from(encodedSignature,'base64url')
    );
    return valid?{ok:true,claims}:{ok:false,error:'signature'};
  }catch(error){
    return{ok:false,error:String(error?.message||error)};
  }
}
