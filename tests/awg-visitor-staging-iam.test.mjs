import test from 'node:test';
import assert from 'node:assert/strict';
import {TARGET,matchingFederations,credentialStatus,planRepair} from '../scripts/awg-visitor-staging-iam.mjs';

const federation=id=>({id,issuer:TARGET.issuer,audiences:[TARGET.audience],enabled:true});
const cred=(id,sub=TARGET.subject)=>({federation_id:id,external_subject_id:sub});
const id1='ajeabcdef0123456789',id2='ajeabcdef0123456790';

test('staging IAM repair selects only exact trusted issuer and audience',()=>{
 const list=[federation(id1),{...federation(id2),issuer:'https://untrusted.example'}, {...federation('ajeabcdef0123456791'),enabled:false}];
 assert.deepEqual(matchingFederations(list).map(f=>f.id),[id1]);
 assert.deepEqual(planRepair(list,[],null),{federationId:id1,status:'missing',serviceAccount:TARGET.serviceAccount,subject:TARGET.subject});
});
test('staging IAM repair never arbitrarily selects among several federations',()=>{
 assert.throws(()=>planRepair([federation(id1),federation(id2)],[],null),/ambiguous_federations/);
 assert.equal(planRepair([federation(id1),federation(id2)],[],id2).federationId,id2);
 assert.throws(()=>planRepair([federation(id1)],[],id2),/matching_staging_federation_not_found/);
});
test('repair is idempotent and rejects subject reuse in another federation',()=>{
 assert.equal(credentialStatus([cred(id1)],id1),'present');
 assert.equal(planRepair([federation(id1)],[cred(id1)],id1).status,'present');
 assert.throws(()=>credentialStatus([cred(id2)],id1),/subject_bound_to_other_federation/);
 assert.equal(credentialStatus([cred(id2,'other-subject')],id1),'missing');
});
