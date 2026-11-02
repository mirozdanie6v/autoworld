#!/usr/bin/env node
/**
 * AWG visitor analytics — safe Yandex OIDC federation inspection and optional
 * exact-subject credential repair. No grants, no deployments, no DB writes.
 *
 * Requires an already authorized yc CLI session with IAM federation rights.
 * The failed GitHub OIDC token CANNOT elevate itself into those rights.
 *
 * Usage:
 *   node scripts/awg-visitor-staging-iam.mjs
 *   node scripts/awg-visitor-staging-iam.mjs --federation-id <verified-id>
 *   node scripts/awg-visitor-staging-iam.mjs --federation-id <verified-id> --apply
 */
import {execFileSync} from 'node:child_process';

export const TARGET=Object.freeze({
  folder:'b1ggsmuiq7tb2d27f89q',
  serviceAccount:'aje0hvomk86tu5lbs5rk',
  issuer:'https://token.actions.githubusercontent.com',
  audience:'https://github.com/mirozdanie6v',
  subject:'repo:mirozdanie6v@49186663/autoworld@1398349654:ref:refs/heads/feature/awg-visitor-analytics-safe-20261102'
});

export function matchingFederations(list){
  return list.filter(f=>f && f.issuer===TARGET.issuer
    && (Array.isArray(f.audiences)?f.audiences:[]).includes(TARGET.audience)
    && f.enabled!==false);
}
export function credentialStatus(credentials,federationId){
  const matches=credentials.filter(c=>c.external_subject_id===TARGET.subject||c.externalSubjectId===TARGET.subject);
  const exact=matches.find(c=>(c.federation_id||c.federationId)===federationId);
  if(exact)return 'present';
  if(matches.length)throw new Error('subject_bound_to_other_federation_review_required');
  return 'missing';
}
function cli(parts){
  const args=[...parts,'--format','json'];
  try{
    const raw=execFileSync('yc',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:25000,maxBuffer:500_000});
    return JSON.parse(raw);
  }catch(error){
    const code=error?.status??'unknown';
    throw new Error('yc_command_failed: '+parts.slice(0,5).join(' ')+' (status '+code+'). Check authorized CLI identity and least-privilege IAM permissions.');
  }
}
function records(obj,key){
  if(Array.isArray(obj))return obj;
  if(obj&&Array.isArray(obj[key]))return obj[key];
  throw new Error('unexpected_yc_list_response');
}
export function planRepair(federations,credentials,requestedId){
  const matching=matchingFederations(federations);
  const chosen=matching.filter(f=>!requestedId||f.id===requestedId);
  if(chosen.length!==1)throw new Error(chosen.length===0?'matching_staging_federation_not_found':'ambiguous_federations_require_explicit_id');
  const federationId=chosen[0].id;
  if(!/^aje[a-z0-9]{12,}$/.test(federationId))throw new Error('invalid_federation_id');
  const status=credentialStatus(credentials,federationId);
  return{federationId,status,serviceAccount:TARGET.serviceAccount,subject:TARGET.subject};
}
export function main(argv=process.argv.slice(2)){
  if(argv.some(x=>!['--apply','--federation-id'].includes(x)&&!/^aje[a-z0-9]{12,}$/.test(x)))throw new Error('unexpected_argument');
  const applied=argv.includes('--apply');
  const idFlag=argv.indexOf('--federation-id');
  const requestedId=idFlag>=0?argv[idFlag+1]:null;
  if(applied&&!requestedId)throw new Error('apply_requires_explicit_federation_id');
  if(requestedId&&!/^aje[a-z0-9]{12,}$/.test(requestedId))throw new Error('invalid_requested_federation');
  console.log('READ ONLY inspect: AWG staging OIDC; production changes prohibited');
  const federations=records(cli(['iam','workload-identity','oidc','federation','list','--folder-id',TARGET.folder]),'federations');
  const credentials=records(cli(['iam','workload-identity','federated-credential','list','--service-account-id',TARGET.serviceAccount]),'federated_credentials');
  const plan=planRepair(federations,credentials,requestedId);
  console.log(JSON.stringify({folder:TARGET.folder,serviceAccount:plan.serviceAccount,federationId:plan.federationId,subject:plan.subject,status:plan.status},null,2));
  if(plan.status==='present'){console.log('Exact staging subject already bound. Check policy or service account, no change made.');return}
  if(!applied){console.log('DRY RUN ONLY: authorized operator may rerun with --federation-id '+plan.federationId+' --apply');return}
  console.log('Creating exactly one federated credential for staging-only identity.');
  cli(['iam','workload-identity','federated-credential','create',
    '--service-account-id',TARGET.serviceAccount,
    '--federation-id',plan.federationId,
    '--external-subject-id',TARGET.subject]);
  const after=records(cli(['iam','workload-identity','federated-credential','list','--service-account-id',TARGET.serviceAccount]),'federated_credentials');
  if(credentialStatus(after,plan.federationId)!=='present')throw new Error('post_create_verification_failed');
  console.log('Verified staging-only federation binding. No IAM role grant, YDB mutation, or deployment occurred.');
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  try{main()}catch(error){console.error(String(error?.message||error));process.exitCode=1}
}
