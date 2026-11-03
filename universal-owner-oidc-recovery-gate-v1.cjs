'use strict';
/**
 * Externally-signed owner-recovery admission gate (source-only; NO ROOT APPLY).
 * This module does not issue approvals, register privileged actions, modify
 * runtime/policy or call the Universal Installer. GitHub OIDC is an independent
 * cryptographic issuer, NOT automatically a PRHM Level-4 approval.
 */
const crypto=require('node:crypto');
const https=require('node:https');
const {FIXED}=require('./universal-installer-backup-only-native-contract-v1.cjs');
const G=Object.freeze({
 issuer:'https://token.actions.githubusercontent.com',
 jwks:'https://token.actions.githubusercontent.com/.well-known/jwks',
 api:'https://api.github.com',
 owner:'prhmonline',
 repo:'prhm-host-actions',
 repositoryId:'1332133091',
 ownerId:'193396069',
 invokingActorId:'193396069',
 requiredApproverId:'74255800',
 environment:'prhm-universal-root-enrollment',
 workflowRef:'prhmonline/prhm-host-actions/.github/workflows/universal-owner-recovery-oidc-v1.yml@refs/heads/main',
 workflowPath:'.github/workflows/universal-owner-recovery-oidc-v1.yml',
 branch:'main'
});
const HEX40=/^[0-9a-f]{40}$/;
const HEX64=/^[0-9a-f]{64}$/;
const fail=(reason)=>{throw new Error('prhm_owner_oidc_'+reason)};
const need=(condition,reason)=>{if(!condition)fail(reason)};
const strictInt=v=>Number.isSafeInteger(v)||typeof v==='string'&&/^[0-9]+$/.test(v);
const str=v=>String(v);
function decodePart(s,max=25000) {
 need(typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s)&&s.length<=max,'invalid_base64url');
 const raw=Buffer.from(s,'base64url');
 need(raw.length>0&&raw.toString('base64url')===s,'noncanonical_base64url');
 let x;try{x=JSON.parse(raw.toString('utf8'))}catch{fail('invalid_json')}
 need(x&&typeof x==='object'&&!Array.isArray(x),'json_object_required');
 return x;
}
function parseToken(token) {
 need(typeof token==='string'&&token.length<45000,'bad_token_size');
 const parts=token.split('.');
 need(parts.length===3,'compact_jws_required');
 const header=decodePart(parts[0],3000),claims=decodePart(parts[1],35000);
 need(typeof header.kid==='string'&&header.kid.length<256&&
      header.alg==='RS256'&&(header.typ===undefined||header.typ==='JWT')&&
      !('jwk' in header)&&!('jku' in header)&&!('x5u' in header)&&
      !('crit' in header),'untrusted_header');
 const signature=Buffer.from(parts[2],'base64url');
 need(signature.length>0&&signature.toString('base64url')===parts[2],'bad_signature_encoding');
 return {header,claims,signed:Buffer.from(parts[0]+'.'+parts[1]),signature};
}
function approvalRules(environment,branches) {
 need(environment?.name===G.environment,'environment_name');
 need(environment?.deployment_branch_policy?.custom_branch_policies===true &&
      environment?.deployment_branch_policy?.protected_branches===false,
      'environment_branch_gate');
 const rules=environment.protection_rules;
 need(Array.isArray(rules),'environment_rules_missing');
 const reviewers=rules.find(x=>x.type==='required_reviewers');
 need(reviewers?.prevent_self_review===true &&
      Array.isArray(reviewers.reviewers) &&
      reviewers.reviewers.some(x=>str(x.reviewer?.id)===G.requiredApproverId&&x.type==='User'),
      'environment_owner_review_not_required');
 const policies=Array.isArray(branches)?branches:branches?.branch_policies;
 need(Array.isArray(policies)&&policies.length===1&&
      policies[0].name===G.branch&&policies[0].type==='branch',
      'branch_policy_drift');
 return true;
}
function checkRun(run,approvals,claims,expectedRunSha){
 need(HEX40.test(expectedRunSha),'missing_pinned_workflow_sha');
 need(run&&str(run.id)===str(claims.run_id)&&
      str(run.actor?.id)===G.invokingActorId&&
      run.event==='workflow_dispatch'&&run.head_branch===G.branch&&
      run.head_sha===expectedRunSha&&run.run_attempt===1&&
      run.conclusion==='success'&&
      run.path===G.workflowPath,'workflow_run_not_pinned');
 need(Array.isArray(approvals),'run_approvals_unavailable');
 const reviewer=approvals.find(x=>str(x.user?.id)===G.requiredApproverId &&
   String(x.state).toLowerCase()==='approved');
 need(reviewer,'explicit_external_owner_approval_missing');
 need(str(claims.actor_id)===G.invokingActorId&&
      str(claims.run_id)===str(run.id)&&str(claims.run_attempt)==='1',
      'run_claim_mismatch');
 return reviewer;
}
function verifyExternalOwnerAttestation({
  token,jwks,environment,branches,run,approvals,nonce,expectedRunSha,
  nowSec=Math.floor(Date.now()/1000)
}) {
 need(HEX64.test(nonce),'nonce_invalid');
 need(HEX40.test(expectedRunSha),'expected_source_not_pinned');
 need(Number.isSafeInteger(nowSec)&&nowSec>0,'invalid_clock');
 const {header,claims,signed,signature}=parseToken(token);
 need(jwks&&Array.isArray(jwks.keys),'jwks_missing');
 const jwk=jwks.keys.find(x=>x.kid===header.kid&&x.kty==='RSA' &&
   (x.use===undefined||x.use==='sig')&&(x.alg===undefined||x.alg==='RS256'));
 need(jwk,'trusted_issuer_key_missing');
 let key;try{key=crypto.createPublicKey({key:jwk,format:'jwk'})}
 catch{fail('issuer_jwk_invalid')}
 need(key.asymmetricKeyType==='rsa'&&
      crypto.verify('RSA-SHA256',signed,key,signature),'oidc_signature_failed');
 const audience='urn:prhm:universal:owner-enrollment:v1:'+nonce+':'+FIXED.candidate_bundle;
 need(claims.iss===G.issuer&&claims.aud===audience,
      'issuer_or_exact_nonce_audience_invalid');
 need(claims.repository===G.owner+'/'+G.repo&&
      str(claims.repository_id)===G.repositoryId&&
      str(claims.repository_owner_id)===G.ownerId&&
      claims.workflow_ref===G.workflowRef&&
      claims.workflow_sha===expectedRunSha&&
      claims.environment===G.environment&&
      claims.ref==='refs/heads/main'&&
      claims.event_name==='workflow_dispatch'&&
      claims.runner_environment==='github-hosted','workflow_identity_mismatch');
 const subjects=[
   'repo:prhmonline/prhm-host-actions:environment:'+G.environment,
   'repo:prhmonline@193396069/prhm-host-actions@1332133091:environment:'+G.environment
 ];
 need(subjects.includes(claims.sub),'subject_not_scoped');
 need([claims.iat,claims.nbf,claims.exp].every(Number.isSafeInteger)&&
      claims.iat<=nowSec+30&&claims.nbf<=nowSec+30&&
      claims.exp>=nowSec&&claims.exp>claims.iat&&
      claims.exp-claims.iat<=1200,'expired_or_invalid_lifetime');
 need(typeof claims.jti==='string'&&claims.jti.length>=12&&claims.jti.length<256,
      'missing_unique_jti');
 approvalRules(environment,branches);
 const reviewer=checkRun(run,approvals,claims,expectedRunSha);
 return Object.freeze({
    schema:'prhm.github-oidc.owner-enrollment-evidence.v1',
    verified:true,
    githubOidcSignatureVerified:true,
    protectedEnvironmentApprovalVerified:true,
    repositoryId:G.repositoryId,
    workflowSha:expectedRunSha,
    runId:str(run.id),
    approvedReviewerId:str(reviewer.user.id),
    tokenIdSha256:crypto.createHash('sha256').update(claims.jti).digest('hex'),
    challengeSha256:crypto.createHash('sha256').update(nonce).digest('hex'),
    candidateBundle:FIXED.candidate_bundle,
    // A separate independently reviewed root adapter & scoped L4
    // authorization are STILL mandatory. Do not promote to permission!
    authorizationToRegisterRoot:false,
    level4AuthorizationIssued:false,
    installerUpgradeAuthorized:false,
    productionChanged:false
 });
}
function httpsJson(url,max=500000) {
 need(url.startsWith(G.api+'/')||url===G.jwks,'url_not_allowlisted');
 return new Promise((resolve,reject)=>{
   const req=https.get(url,{headers:{
      'User-Agent':'prhm-universal-root-recovery-verify-v1',
      'Accept':'application/vnd.github+json'
   },timeout:8000},res=>{
      if(res.statusCode!==200){res.resume();reject(new Error('trusted_https_non_200_'+res.statusCode));return}
      let chunks=[],len=0;
      res.on('data',b=>{len+=b.length;if(len>max){req.destroy(new Error('trusted_https_too_large'))}else chunks.push(b)});
      res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch(e){reject(e)}});
      res.on('error',reject);
   });req.on('timeout',()=>req.destroy(new Error('trusted_https_timeout')));
   req.on('error',reject);
 });
}
async function verifyViaOfficialEndpoints({token,nonce,expectedRunSha,nowSec}) {
 const untrusted=parseToken(token).claims;
 need(strictInt(untrusted.run_id)&&str(untrusted.run_id).length<=20,
      'invalid_untrusted_run_id');
 const id=str(untrusted.run_id),base=G.api+'/repos/'+G.owner+'/'+G.repo;
 const [jwks,environment,branches,run,approvals]=await Promise.all([
   httpsJson(G.jwks,250000),
   httpsJson(base+'/environments/'+G.environment),
   httpsJson(base+'/environments/'+G.environment+'/deployment-branch-policies'),
   httpsJson(base+'/actions/runs/'+id),
   httpsJson(base+'/actions/runs/'+id+'/approvals')
 ]);
 return verifyExternalOwnerAttestation({
    token,nonce,expectedRunSha,nowSec,jwks,environment,branches,run,approvals
 });
}
module.exports=Object.freeze({
  G,FIXED,parseToken,approvalRules,verifyExternalOwnerAttestation,
  verifyViaOfficialEndpoints,ROOT_EXECUTION_EXPORTED:false,PRODUCTION_AUTHORIZED:false
});
