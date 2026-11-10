'use strict';
/**
 * Owner OIDC identity evidence for ONE pinned Honartik finance release.
 *
 * SOURCE ONLY: NO root authority, deploy dispatch, database access or policy
 * change. An independently reviewed host verifier must authenticate, consume
 * and bind this evidence to its immutable release operation before cutover.
 */
const crypto=require('node:crypto');
const https=require('node:https');
const {G,parseToken}=require('./universal-owner-oidc-recovery-gate-v1.cjs');

const INTENT=Object.freeze({
  schema:'prhm.honartik.finance-owner-intent.v1',
  operation:'honartik_back.production.finance_release',
  project:'honartik_back',
  host:'prhm-production.prhm.ir',
  production_base_sha:'4ac602e874a128c3328f27f3dab473857512cdbf',
  source_sha:'d1a64e640c9c2cf4788d55566c17728be5813941',
  reviewed_delta_file_count:15,
  finance_flags_initially_enabled:false,
  allowed_schema_migrations:0,
  isolated_restore_required:true,
  signed_release_attestation_required:true,
  rollback_required:true,
  owner_funded_real_payment_test_included:false
});
const W=Object.freeze({
  environment:'honartik-finance-production',
  workflowPath:'.github/workflows/honartik-finance-owner-approval-oidc-v1.yml',
  workflowRef:'prhmonline/prhm-host-actions/.github/workflows/honartik-finance-owner-approval-oidc-v1.yml@refs/heads/main',
  repositoryId:G.repositoryId,
  ownerId:G.ownerId,
  actorId:G.invokingActorId,
  branch:'main'
});
const HEX64=/^[a-f0-9]{64}$/;
const HEX40=/^[a-f0-9]{40}$/;
const verifiedProofs=new WeakSet();
const fail=(s)=>{throw Error('honartik_finance_owner_oidc_'+s)};
const need=(ok,s)=>{if(!ok)fail(s)};
const str=(x)=>String(x);
const intentDigest=()=>crypto.createHash('sha256')
  .update(JSON.stringify(INTENT)).digest('hex');
function audience(challenge) {
  need(typeof challenge==='string'&&HEX64.test(challenge),'invalid_challenge');
  return 'urn:prhm:honartik:finance-owner:v1:'+challenge+':'+intentDigest();
}
function verifyProtectedEnvironment(environment,branches){
  need(environment?.name===W.environment,'environment_name');
  need(environment.can_admins_bypass===false,'environment_admin_bypass_enabled');
  need(environment?.deployment_branch_policy?.custom_branch_policies===true&&
       environment?.deployment_branch_policy?.protected_branches===false,
       'environment_branch_policy_missing');
  const policies=Array.isArray(branches)?branches:branches?.branch_policies;
  need(Array.isArray(policies)&&policies.length===1&&
       policies[0].type==='branch'&&policies[0].name===W.branch,
       'environment_main_only_policy_missing');
  need(Array.isArray(environment.protection_rules),'environment_protection_metadata_missing');
  // Owner is the sole permitted initiator. Environment branch policy is
  // verified, but no separate reviewer approval is represented by this proof.
  return true;
}
function verifyFinanceOwnerIdentity({
  token,jwks,environment,branches,run,challenge,expectedWorkflowSha,
  nowSec=Math.floor(Date.now()/1000)
}){
  need(typeof expectedWorkflowSha==='string'&&HEX40.test(expectedWorkflowSha),
       'workflow_sha_unpinned');
  need(Number.isSafeInteger(nowSec)&&nowSec>0,'invalid_clock');
  const {header,claims,signed,signature}=parseToken(token);
  need(jwks&&Array.isArray(jwks.keys),'jwks_missing');
  const jwk=jwks.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&
    (k.use===undefined||k.use==='sig')&&(k.alg===undefined||k.alg==='RS256'));
  need(jwk,'github_issuer_key_missing');
  let key;try{key=crypto.createPublicKey({key:jwk,format:'jwk'})}
  catch{fail('invalid_rsa_jwk')}
  need(key.asymmetricKeyType==='rsa'&&
    crypto.verify('RSA-SHA256',signed,key,signature),
    'jwt_signature_invalid');
  need(claims.iss===G.issuer&&claims.aud===audience(challenge),
    'wrong_issuer_or_release_intent');
  need(claims.repository===G.owner+'/'+G.repo&&
    str(claims.repository_id)===W.repositoryId&&
    str(claims.repository_owner_id)===W.ownerId&&
    str(claims.actor_id)===W.actorId&&
    claims.workflow_ref===W.workflowRef&&
    claims.workflow_sha===expectedWorkflowSha&&
    claims.environment===W.environment&&
    claims.ref==='refs/heads/main'&&
    claims.event_name==='workflow_dispatch'&&
    claims.runner_environment==='github-hosted',
    'workflow_claims_mismatch');
  // GitHub may issue either legacy slug-scoped or immutable numeric-ID
  // scoped subject. Both are bound to exact owner/repo/environment;
  // never accept a wildcard or a subject from another project.
  const allowedSubjects=[
    'repo:'+G.owner+'/'+G.repo+':environment:'+W.environment,
    'repo:'+G.owner+'@'+W.ownerId+'/'+G.repo+'@'+W.repositoryId+
      ':environment:'+W.environment
  ];
  need(allowedSubjects.includes(claims.sub),
       'wrong_protected_environment_subject');
  need([claims.iat,claims.nbf,claims.exp].every(Number.isSafeInteger)&&
       claims.exp>claims.iat&&claims.exp-claims.iat<=600&&
       claims.iat<=nowSec+30&&claims.nbf<=nowSec+30&&
       claims.exp>=nowSec&&nowSec-claims.iat<=300,
       'expired_or_stale');
  need(typeof claims.jti==='string'&&claims.jti.length>=12&&
       claims.jti.length<256,'missing_jti');
  verifyProtectedEnvironment(environment,branches);
  need(run&&str(run.id)===str(claims.run_id)&&
    str(run.actor?.id)===W.actorId&&
    run.event==='workflow_dispatch'&&
    run.head_branch===W.branch&&
    run.head_sha===expectedWorkflowSha&&
    run.run_attempt===1&&run.conclusion==='success'&&
    run.path===W.workflowPath&&str(claims.run_attempt)==='1',
    'official_run_not_pinned');
  const result=Object.freeze({
    schema:'prhm.honartik.finance-owner-identity-evidence.v1',
    intent_digest:intentDigest(),
    operation:INTENT.operation,project:INTENT.project,
    production_base_sha:INTENT.production_base_sha,
    source_sha:INTENT.source_sha,
    github_signature_verified:true,
    owner_identity_verified:true,
    environment_main_only_verified:true,
    protected_environment_reviewer_approved:false,
    workflow_sha:expectedWorkflowSha,
    run_id:str(run.id),
    jti_sha256:crypto.createHash('sha256').update(claims.jti).digest('hex'),
    challenge_sha256:crypto.createHash('sha256').update(challenge).digest('hex'),
    one_use_consumed:false,
    root_verifier_installed:false,
    protected_restore_verified:false,
    finance_release_authorized:false,
    production_mutated:false
  });
  verifiedProofs.add(result);
  return result;
}
function httpsJson(url,max=350000){
  need(url===G.jwks||url.startsWith(G.api+'/repos/'+G.owner+'/'+G.repo+'/'),
       'url_not_allowlisted');
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{
      'User-Agent':'prhm-honartik-finance-owner-oidc-v1',
      'Accept':'application/vnd.github+json'
    },timeout:8000},res=>{
      if(res.statusCode!==200){res.resume();reject(Error('github_api_http_'+res.statusCode));return}
      let len=0,chunks=[];
      res.on('data',chunk=>{
        len+=chunk.length;
        if(len>max)req.destroy(Error('github_api_response_too_large'));
        else chunks.push(chunk);
      });
      res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}
        catch(e){reject(e)}});
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('github_api_timeout')));
    req.on('error',reject);
  });
}
async function verifyFromOfficialGitHub({token,challenge,expectedWorkflowSha,nowSec}){
  const raw=parseToken(token).claims;
  need((Number.isSafeInteger(raw.run_id)||
       typeof raw.run_id==='string'&&/^[0-9]{1,20}$/.test(raw.run_id))&&
       str(raw.run_id).length<=20,'invalid_run_id');
  const base=G.api+'/repos/'+G.owner+'/'+G.repo;
  const id=str(raw.run_id);
  const [jwks,run,environment,branches]=await Promise.all([
    httpsJson(G.jwks,250000),
    httpsJson(base+'/actions/runs/'+id),
    httpsJson(base+'/environments/'+W.environment),
    httpsJson(base+'/environments/'+W.environment+'/deployment-branch-policies')
  ]);
  return verifyFinanceOwnerIdentity({
    token,jwks,run,environment,branches,challenge,expectedWorkflowSha,nowSec
  });
}
module.exports=Object.freeze({
  INTENT,W,intentDigest,audience,verifyProtectedEnvironment,
  verifyFinanceOwnerIdentity,verifyFromOfficialGitHub,
  proofVerifiedInProcess:(proof)=>verifiedProofs.has(proof),
  ROOT_EXECUTION_EXPORTED:false,
  PRODUCTION_AUTHORIZED:false
});
