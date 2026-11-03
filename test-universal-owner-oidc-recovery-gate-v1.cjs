'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const crypto=require('node:crypto');
const gate=require('./universal-owner-oidc-recovery-gate-v1.cjs');
const {FIXED,G}=gate;
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicExponent:0x10001});
const keyId='fixture-issuer-key';
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid:keyId,use:'sig',alg:'RS256'}]};
const nonce='a'.repeat(64),sha='b'.repeat(40),now=1800000000;
const claims=Object.freeze({
  iss:G.issuer,
  aud:'urn:prhm:universal:owner-enrollment:v1:'+nonce+':'+FIXED.candidate_bundle,
  sub:'repo:prhmonline/prhm-host-actions:environment:'+G.environment,
  repository:'prhmonline/prhm-host-actions',
  repository_id:G.repositoryId,
  repository_owner_id:G.ownerId,
  workflow_ref:G.workflowRef,
  workflow_sha:sha,
  environment:G.environment,
  ref:'refs/heads/main',
  event_name:'workflow_dispatch',
  runner_environment:'github-hosted',
  actor_id:G.invokingActorId,
  run_id:'987654321',
  run_attempt:'1',
  jti:'fixture-unique-token-987654321',
  iat:now-45,nbf:now-50,exp:now+255
});
const environment={
 name:G.environment,can_admins_bypass:true,
 deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
 protection_rules:[
  {type:'required_reviewers',prevent_self_review:true,
   reviewers:[{type:'User',reviewer:{id:Number(G.requiredApproverId),login:'mohammadyours'}}]},
  {type:'branch_policy'}
 ]
};
const branches={total_count:1,branch_policies:[{name:'main',type:'branch'}]};
const run={
 id:987654321,actor:{id:Number(G.invokingActorId)},event:'workflow_dispatch',
 head_branch:'main',head_sha:sha,run_attempt:1,conclusion:'success',
 path:G.workflowPath
};
const approvals=[{user:{id:Number(G.requiredApproverId)},state:'approved'}];
function jwt(c=claims,h={alg:'RS256',kid:keyId,typ:'JWT'}) {
 const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const msg=b(h)+'.'+b(c);
 return msg+'.'+crypto.sign('RSA-SHA256',Buffer.from(msg),privateKey).toString('base64url');
}
function valid(overrides={}) {
 return gate.verifyExternalOwnerAttestation({
   token:jwt(),jwks,environment,branches,run,approvals,nonce,
   expectedRunSha:sha,nowSec:now,...overrides
 });
}
function rejects(reason,overrides) {
 assert.throws(()=>valid(overrides),new RegExp('prhm_owner_oidc_'+reason));
}
test('valid externally signed and explicitly reviewed claim is evidence only, never L4 or registration',()=>{
 const r=valid();assert.equal(r.verified,true);
 assert.equal(r.githubOidcSignatureVerified,true);
 assert.equal(r.protectedEnvironmentApprovalVerified,true);
 assert.equal(r.authorizationToRegisterRoot,false);
 assert.equal(r.level4AuthorizationIssued,false);
 assert.equal(r.installerUpgradeAuthorized,false);
 assert.equal(r.productionChanged,false);
});
test('signature tampering rejected',()=>{
 const parts=jwt().split('.');const changed={...claims,actor_id:'123456'};
 parts[1]=Buffer.from(JSON.stringify(changed)).toString('base64url');
 rejects('oidc_signature_failed',{token:parts.join('.')});
});
test('malicious supplied jku rejected before signature verification',()=>{
 rejects('untrusted_header',{token:jwt(claims,{alg:'RS256',kid:keyId,jku:'https://evil.example'})});
});
test('wrong external audience or challenge is denied',()=>{
 rejects('issuer_or_exact_nonce_audience_invalid',{nonce:'c'.repeat(64)});
});
test('wrong source commit denied',()=>{
 rejects('workflow_identity_mismatch',{token:jwt({...claims,workflow_sha:'c'.repeat(40)})});
});
test('unapproved job blocked even if GitHub administrator bypassed environment gate',()=>{
 rejects('explicit_external_owner_approval_missing',{approvals:[]});
});
test('approvals from the workflow invoker do not count',()=>{
 rejects('explicit_external_owner_approval_missing',{approvals:[{user:{id:Number(G.invokingActorId)},state:'approved'}]});
});
test('removing required reviewers fails closed',()=>{
 rejects('environment_owner_review_not_required',{environment:{...environment,protection_rules:[]}});
});
test('self approval permission fails closed',()=>{
 const protection_rules=environment.protection_rules.map(x=>x.type==='required_reviewers'?{...x,prevent_self_review:false}:x);
 rejects('environment_owner_review_not_required',{environment:{...environment,protection_rules}});
});
test('branch rule wildcard cannot authorize extra ref',()=>{
 rejects('branch_policy_drift',{branches:{branch_policies:[{name:'*',type:'branch'}]}});
});
test('wrong GitHub actor cannot use owner enrollment',()=>{
 rejects('workflow_run_not_pinned',{run:{...run,actor:{id:12345}}});
});
test('wrong GitHub run SHA cannot use foreign workflow',()=>{
 rejects('workflow_run_not_pinned',{run:{...run,head_sha:'f'.repeat(40)}});
});
test('expired signed OIDC JWT cannot be replayed',()=>{
 rejects('expired_or_invalid_lifetime',{nowSec:now+300});
});
test('wrong repository identity denied even with a valid external signature',()=>{
 rejects('workflow_identity_mismatch',{token:jwt({...claims,repository_id:'00000'})});
});
test('invalid JWK signature rejected',()=>{
 const other=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 rejects('oidc_signature_failed',{jwks:{keys:[{...other.publicKey.export({format:'jwk'}),kid:keyId,use:'sig',alg:'RS256'}]}});
});
test('no public HTTPS endpoint can be derived from user-provided token',()=>{
 assert.equal(G.api,'https://api.github.com');
 assert.equal(G.jwks,'https://token.actions.githubusercontent.com/.well-known/jwks');
 assert.equal(gate.ROOT_EXECUTION_EXPORTED,false);
});
