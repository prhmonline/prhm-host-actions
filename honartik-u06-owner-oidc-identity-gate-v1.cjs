'use strict';
/**
 * Cryptographic owner-identity evidence for exactly one U06 native backup intent.
 *
 * SOURCE ONLY. This is NOT a registered Host Action, L4 receipt, root installer,
 * approval issuer or authorization to mutate the installed PRHM policy.
 * No Provider signature or key is required. A separately installed trusted host
 * bridge must authenticate, durably consume and enforce this evidence.
 */
const crypto=require('node:crypto');
const https=require('node:https');
const {G,parseToken,approvalRules}=require('./universal-owner-oidc-recovery-gate-v1.cjs');
const INTENT=Object.freeze({
  schema:'prhm.u06.honartik.owner-oidc-intent.v1',
  operation:'honartik_back.production.native_backup',
  project:'honartik_back.production',
  host:'prhm-production.prhm.ir',
  adapter_sha256:'d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3',
  profile_sha256:'79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698',
  mysql_account:'honartik_universal_backup',
  mysql_schema:'honartik_db',
  allowed_grants:Object.freeze(['SELECT','SHOW VIEW','TRIGGER','EVENT']),
  require_offsite:true,
  require_full_restore:true,
  require_finance_integrity:true,
  application_deploy:false,
  yii_migrations:false
});
const W=Object.freeze({
  workflowPath:'.github/workflows/honartik-u06-owner-approval-oidc-v1.yml',
  workflowRef:'prhmonline/prhm-host-actions/.github/workflows/honartik-u06-owner-approval-oidc-v1.yml@refs/heads/main',
  environment:G.environment,
  ownerId:G.ownerId,
  repoId:G.repositoryId,
  actorId:G.invokingActorId,
  approverId:G.requiredApproverId
});
const fail=(m)=>{throw new Error('prhm_u06_owner_oidc_'+m)};
const need=(ok,m)=>{if(!ok)fail(m)};
const VERIFIED_PROOFS=new WeakSet();
const HEX64=/^[0-9a-f]{64}$/;
const HEX40=/^[0-9a-f]{40}$/;
function intentDigest(){
  const data=JSON.stringify(INTENT);
  return crypto.createHash('sha256').update(data).digest('hex');
}
function audience(challenge){
  need(typeof challenge==='string'&&HEX64.test(challenge),'invalid_challenge');
  return 'urn:prhm:u06:honartik-backup-owner:v1:'+challenge+':'+intentDigest();
}
function verifyU06OwnerIdentity({
  token,jwks,environment,branches,run,approvals,challenge,expectedRunSha,
  nowSec=Math.floor(Date.now()/1000)
}){
  need(typeof expectedRunSha==='string'&&HEX40.test(expectedRunSha),'workflow_sha_not_pinned');
  need(Number.isSafeInteger(nowSec)&&nowSec>0,'clock_invalid');
  const {header,claims,signed,signature}=parseToken(token);
  need(jwks&&Array.isArray(jwks.keys),'jwks_missing');
  const jwk=jwks.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&
    (k.use===undefined||k.use==='sig')&&(k.alg===undefined||k.alg==='RS256'));
  need(jwk,'issuer_key_missing');
  let key;try{key=crypto.createPublicKey({key:jwk,format:'jwk'})}catch{fail('jwk_invalid')}
  need(key.asymmetricKeyType==='rsa'&&
    crypto.verify('RSA-SHA256',signed,key,signature),'rsa_signature_invalid');
  need(claims.iss===G.issuer&&claims.aud===audience(challenge),'wrong_issuer_or_intent');
  need(claims.repository===G.owner+'/'+G.repo&&
    String(claims.repository_id)===W.repoId&&
    String(claims.repository_owner_id)===W.ownerId&&
    String(claims.actor_id)===W.actorId&&
    claims.workflow_ref===W.workflowRef&&
    claims.workflow_sha===expectedRunSha&&
    claims.ref==='refs/heads/main'&&
    claims.environment===W.environment&&
    claims.event_name==='workflow_dispatch'&&
    claims.runner_environment==='github-hosted','workflow_claims_mismatch');
  const allowedSubjects=[
    'repo:'+G.owner+'/'+G.repo+':environment:'+W.environment,
    'repo:'+G.owner+'@'+W.ownerId+'/'+G.repo+'@'+W.repoId+':environment:'+W.environment
  ];
  need(allowedSubjects.includes(claims.sub),'subject_mismatch');
  need([claims.iat,claims.nbf,claims.exp].every(Number.isSafeInteger)&&
    claims.exp>claims.iat&&claims.exp-claims.iat<=600&&
    claims.iat<=nowSec+30&&claims.nbf<=nowSec+30&&
    claims.exp>=nowSec&&nowSec-claims.iat<=300,'expired_or_stale');
  need(typeof claims.jti==='string'&&claims.jti.length>=12&&
    claims.jti.length<256,'jti_missing');
  approvalRules(environment,branches);
  need(run&&String(run.id)===String(claims.run_id)&&
    String(run.actor?.id)===W.actorId&&
    run.event==='workflow_dispatch'&&run.head_branch==='main'&&
    run.head_sha===expectedRunSha&&run.run_attempt===1&&
    run.conclusion==='success'&&run.path===W.workflowPath&&
    String(claims.run_attempt)==='1','official_run_not_pinned');
  need(Array.isArray(approvals),'review_history_missing');
  const approved=approvals.find(a=>String(a.user?.id)===W.approverId&&
    String(a.state).toLowerCase()==='approved');
  need(!!approved,'explicit_owner_approval_missing');
  const proof=Object.freeze({
    schema:'prhm.u06.honartik.owner-identity-evidence.v1',
    owner_identity_verified:true,
    github_oidc_signature_valid:true,
    protected_environment_approval_valid:true,
    approved_reviewer_id:W.approverId,
    workflow_sha:expectedRunSha,
    run_id:String(run.id),
    intent_digest:intentDigest(),
    jti_sha256:crypto.createHash('sha256').update(claims.jti).digest('hex'),
    challenge_sha256:crypto.createHash('sha256').update(challenge).digest('hex'),
    external_provider_approval_required:false,
    // Authorization and one-use replay fencing must happen inside the trusted
    // on-host bounded executor. Never derive those from an identity JWT alone.
    native_root_verifier_installed:false,
    one_use_receipt_consumed:false,
    approval_to_modify_production:false,
    native_backup_completed:false,
    backend_deploy_authorized:false
  });
  VERIFIED_PROOFS.add(proof);
  return proof;
}
function httpsJson(url,max=450000){
  need(url===G.jwks||url.startsWith(G.api+'/'),'endpoint_denied');
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{
      headers:{'User-Agent':'prhm-u06-owner-oidc-v1','Accept':'application/vnd.github+json'},
      timeout:8000
    },res=>{
      if(res.statusCode!==200){res.resume();reject(Error('official_endpoint_http_'+res.statusCode));return}
      let bytes=0,chunks=[];
      res.on('data',data=>{
        bytes+=data.length;
        if(bytes>max)req.destroy(Error('official_endpoint_response_oversized'));
        else chunks.push(data);
      });
      res.on('end',()=>{
        try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}
        catch(e){reject(e)}
      });
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('official_endpoint_timeout')));
    req.on('error',reject);
  });
}
async function verifyFromOfficialGitHub({token,challenge,expectedRunSha,nowSec}){
  const claims=parseToken(token).claims;
  need((Number.isSafeInteger(claims.run_id)||
    (typeof claims.run_id==='string'&&/^[0-9]{1,20}$/.test(claims.run_id))),
    'run_id_invalid');
  const id=String(claims.run_id),root=G.api+'/repos/'+G.owner+'/'+G.repo;
  const [jwks,environment,branches,run,approvals]=await Promise.all([
    httpsJson(G.jwks,250000),
    httpsJson(root+'/environments/'+W.environment),
    httpsJson(root+'/environments/'+W.environment+'/deployment-branch-policies'),
    httpsJson(root+'/actions/runs/'+id),
    httpsJson(root+'/actions/runs/'+id+'/approvals')
  ]);
  return verifyU06OwnerIdentity({token,jwks,environment,branches,run,approvals,
    challenge,expectedRunSha,nowSec});
}
module.exports=Object.freeze({
  INTENT,W,intentDigest,audience,verifyU06OwnerIdentity,verifyFromOfficialGitHub,
  proofVerifiedInCurrentProcess:(candidate)=>VERIFIED_PROOFS.has(candidate),
  ROOT_EXECUTION_EXPORTED:false,PRODUCTION_AUTHORIZED:false
});
