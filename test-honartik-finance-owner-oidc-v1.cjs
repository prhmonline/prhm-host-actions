'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const gate=require('./honartik-finance-owner-oidc-identity-v1.cjs');
const fence=require('./honartik-finance-owner-once-fence-v1.cjs');
const seal=require('./honartik-finance-owner-oidc-sealed-v1.cjs');
const {G}=require('./universal-owner-oidc-recovery-gate-v1.cjs');
const {sealJwt,openSealedJwt}
  =require('./universal-owner-oidc-sealed-transport-v1.cjs');

const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const kid='synthetic-finance-rsa';
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'}]};
const now=1800000000,challenge='a'.repeat(64),workflowSha='b'.repeat(40);
const env={
  name:gate.W.environment,
  can_admins_bypass:false,
  deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
  protection_rules:[]
};
const branches={branch_policies:[{name:'main',type:'branch'}]};
const run={
  id:987654321,actor:{id:Number(gate.W.actorId)},event:'workflow_dispatch',
  head_branch:'main',head_sha:workflowSha,run_attempt:1,
  conclusion:'success',path:gate.W.workflowPath
};
const claims=Object.freeze({
  iss:G.issuer,aud:gate.audience(challenge),
  sub:'repo:prhmonline/prhm-host-actions:environment:'+gate.W.environment,
  repository:'prhmonline/prhm-host-actions',repository_id:gate.W.repositoryId,
  repository_owner_id:gate.W.ownerId,actor_id:gate.W.actorId,
  workflow_ref:gate.W.workflowRef,workflow_sha:workflowSha,
  environment:gate.W.environment,ref:'refs/heads/main',
  event_name:'workflow_dispatch',runner_environment:'github-hosted',
  run_id:String(run.id),run_attempt:'1',
  jti:'finance-synthetic-jti-20261111',
  iat:now-45,nbf:now-50,exp:now+100
});
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(c=claims,h={kid,alg:'RS256',typ:'JWT'}){
  const signed=b64(h)+'.'+b64(c);
  return signed+'.'+crypto.sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url');
}
function valid(changes={}){
  return gate.verifyFinanceOwnerIdentity({
    token:jwt(),jwks,environment:env,branches,run,
    challenge,expectedWorkflowSha:workflowSha,nowSec:now,...changes
  });
}
function rejected(message,changes){
  assert.throws(()=>valid(changes),new RegExp(message));
}
test('financing operation and exact production and GitHub source are immutable',()=>{
  assert.equal(gate.INTENT.operation,'honartik_back.production.finance_release');
  assert.equal(gate.INTENT.production_base_sha,'4ac602e874a128c3328f27f3dab473857512cdbf');
  assert.equal(gate.INTENT.source_sha,'d1a64e640c9c2cf4788d55566c17728be5813941');
  assert.equal(gate.INTENT.reviewed_delta_file_count,15);
  assert.equal(gate.INTENT.finance_flags_initially_enabled,false);
  assert.equal(gate.INTENT.owner_funded_real_payment_test_included,false);
});
test('cryptographic success is only owner identity, never production approval',()=>{
  const proof=valid();
  assert.equal(proof.github_signature_verified,true);
  assert.equal(proof.owner_identity_verified,true);
  assert.equal(proof.environment_main_only_verified,true);
  assert.equal(proof.protected_environment_reviewer_approved,false);
  assert.equal(proof.intent_digest,gate.intentDigest());
  assert.equal(proof.finance_release_authorized,false);
  assert.equal(proof.root_verifier_installed,false);
  assert.equal(proof.protected_restore_verified,false);
  assert.equal(proof.production_mutated,false);
});
test('finance intent cannot reuse U06 native backup audience',()=>{
  assert.match(gate.audience(challenge),/^urn:prhm:honartik:finance-owner:v1:/);
  assert.notEqual(gate.audience(challenge),
    require('./honartik-u06-owner-oidc-identity-gate-v1.cjs').audience(challenge));
  rejected('wrong_issuer_or_release_intent',{
    token:jwt({...claims,aud:require('./honartik-u06-owner-oidc-identity-gate-v1.cjs').audience(challenge)})
  });
});
test('wrong challenge and malformed challenge are refused',()=>{
  rejected('wrong_issuer_or_release_intent',{challenge:'c'.repeat(64)});
  rejected('invalid_challenge',{challenge:'bad'});
});
test('tampered payload, wrong JWK and malicious JWT header are refused',()=>{
  const parts=jwt().split('.');
  parts[1]=b64({...claims,source_sha:'c'.repeat(40)});
  rejected('jwt_signature_invalid',{token:parts.join('.')});
  const other=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  rejected('jwt_signature_invalid',{jwks:{keys:[{
    ...other.publicKey.export({format:'jwk'}),kid,alg:'RS256'
  }]}});
  rejected('untrusted_header',{token:jwt(claims,{
    kid,alg:'RS256',jku:'https://attacker.invalid'
  })});
});
test('repository, owner and user identity cannot drift',()=>{
  rejected('workflow_claims_mismatch',{token:jwt({...claims,repository_id:'999'})});
  rejected('workflow_claims_mismatch',{token:jwt({...claims,repository_owner_id:'999'})});
  rejected('workflow_claims_mismatch',{token:jwt({...claims,actor_id:'999'})});
  rejected('official_run_not_pinned',{run:{...run,actor:{id:999}}});
});
test('wrong signed workflow, branch, or SHA fails',()=>{
  rejected('workflow_claims_mismatch',{token:jwt({...claims,workflow_sha:'f'.repeat(40)})});
  rejected('workflow_claims_mismatch',{token:jwt({...claims,ref:'refs/heads/dev'})});
  rejected('workflow_claims_mismatch',{token:jwt({...claims,workflow_ref:
    'prhmonline/prhm-host-actions/.github/workflows/honartik-u06-owner-approval-oidc-v1.yml@refs/heads/main'})});
  rejected('workflow_sha_unpinned',{expectedWorkflowSha:'bad'});
});
test('unprotected or differently configured GitHub environment is blocked',()=>{
  rejected('environment_name',{environment:{...env,name:'other'}});
  rejected('environment_admin_bypass_enabled',{environment:{...env,can_admins_bypass:true}});
  rejected('environment_branch_policy_missing',{environment:{
    ...env,deployment_branch_policy:{custom_branch_policies:false,protected_branches:false}
  }});
  rejected('environment_main_only_policy_missing',{branches:{branch_policies:[
    {name:'main',type:'branch'},{name:'dev',type:'branch'}
  ]}});
  rejected('workflow_claims_mismatch',{token:jwt({...claims,environment:'other'})});
  rejected('wrong_protected_environment_subject',{token:jwt({...claims,sub:'repo:attacker/evil'})});
});
test('official GitHub run, SHA and attempt must match',()=>{
  rejected('official_run_not_pinned',{run:{...run,head_sha:'f'.repeat(40)}});
  rejected('official_run_not_pinned',{run:{...run,conclusion:'failure'}});
  rejected('official_run_not_pinned',{run:{...run,run_attempt:2}});
  rejected('official_run_not_pinned',{run:{...run,path:'other.yml'}});
  rejected('official_run_not_pinned',{token:jwt({...claims,run_attempt:'2'})});
});
test('clock skew, stale, expired and overlong tokens rejected',()=>{
  rejected('expired_or_stale',{nowSec:now+200});
  rejected('expired_or_stale',{nowSec:now-200});
  rejected('expired_or_stale',{token:jwt({...claims,exp:now+900})});
  rejected('missing_jti',{token:jwt({...claims,jti:undefined})});
});
test('wrong top-level audience signature issuer rejected',()=>{
  rejected('wrong_issuer_or_release_intent',{token:jwt({...claims,iss:'https://attacker.invalid'})});
  rejected('wrong_issuer_or_release_intent',{token:jwt({...claims,aud:'urn:prhm:other'})});
});
test('signed proof is immutable and fake JSON cannot become verified proof',()=>{
  const proof=valid();
  assert.equal(Object.isFrozen(proof),true);
  assert.equal(gate.proofVerifiedInProcess(proof),true);
  assert.equal(gate.proofVerifiedInProcess({...proof}),false);
  assert.equal(gate.proofVerifiedInProcess(JSON.parse(JSON.stringify(proof))),false);
});
function makeLedger(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'honartik-finance-owner-proof-'));
  fs.chmodSync(dir,0o700);
  return dir;
}
test('one-use receipt is durably fsynced and cannot be replayed',()=>{
  const dir=makeLedger();
  try{
    const proof=valid();
    const receipt=fence.consumeVerifiedFinanceIdentity(proof,{directory:dir,trustedUid:process.getuid()});
    assert.equal(receipt.consumed,true);
    assert.equal(receipt.receipt_fsynced,true);
    assert.equal(receipt.directory_fsynced,true);
    assert.equal(receipt.finance_release_authorized,false);
    const files=fs.readdirSync(dir);
    assert.equal(files.length,1);
    assert.equal(fs.statSync(path.join(dir,files[0])).mode&0o777,0o600);
    assert.throws(()=>fence.consumeVerifiedFinanceIdentity(valid(),{
      directory:dir,trustedUid:process.getuid()
    }),/replayed_owner_proof/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('forged or copied evidence never consumes one-use receipt',()=>{
  const dir=makeLedger();
  try{
    const proof=valid();
    for(const x of [{...proof},JSON.parse(JSON.stringify(proof))]){
      assert.throws(()=>fence.consumeVerifiedFinanceIdentity(x,{
        directory:dir,trustedUid:process.getuid()
      }),/not_verified_in_this_process/);
    }
    assert.deepEqual(fs.readdirSync(dir),[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('weak ledger, symlinks and wrong owner are refused',()=>{
  const dir=makeLedger(),alias=dir+'-link';
  try{
    fs.chmodSync(dir,0o755);
    assert.throws(()=>fence.consumeVerifiedFinanceIdentity(valid(),{
      directory:dir,trustedUid:process.getuid()
    }),/untrusted_ledger_directory/);
    fs.chmodSync(dir,0o700);
    fs.symlinkSync(dir,alias);
    assert.throws(()=>fence.consumeVerifiedFinanceIdentity(valid(),{
      directory:alias,trustedUid:process.getuid()
    }),/untrusted_ledger_directory/);
    assert.throws(()=>fence.consumeVerifiedFinanceIdentity(valid(),{
      directory:dir,trustedUid:process.getuid()+1
    }),/untrusted_ledger_directory/);
    assert.deepEqual(fs.readdirSync(dir),[]);
  }finally{fs.rmSync(alias,{force:true});fs.rmSync(dir,{recursive:true,force:true})}
});
test('sealed JWT transport authenticates host challenge and private key',()=>{
  const own=crypto.generateKeyPairSync('x25519');
  const other=crypto.generateKeyPairSync('x25519');
  const pub=own.publicKey.export({format:'der',type:'spki'}).toString('base64');
  const jwtText='synthetic.finance.jwt.'+'a'.repeat(100);
  const encrypted=sealJwt({token:jwtText,challenge,serverPublicKeyBase64:pub});
  assert.equal(openSealedJwt(encrypted,challenge,own.privateKey),jwtText);
  assert.ok(!JSON.stringify(encrypted).includes(jwtText));
  assert.throws(()=>openSealedJwt(encrypted,challenge,other.privateKey),
    /transport_authentication_failed/);
  assert.throws(()=>openSealedJwt(encrypted,'c'.repeat(64),own.privateKey),
    /challenge_mismatch/);
});
test('finance workflow is owner-only, protected-environment, manual and non-deploying',()=>{
  const f=fs.readFileSync(path.join(__dirname,
    '.github/workflows/honartik-finance-owner-approval-oidc-v1.yml'),'utf8');
  assert.match(f,/workflow_dispatch:/);
  assert.match(f,/github.actor_id == '193396069'/);
  assert.match(f,/environment: honartik-finance-production/);
  assert.match(f,/id-token: write/);
  assert.match(f,/persist-credentials: false/);
  assert.match(f,/retention-days: 1/);
  assert.doesNotMatch(f,/(?:docker\s+run|ssh\s+root|migrate\/up|deploy-project|chmod\s+777|git\s+push)/);
});
test('identity and replay modules cannot execute or authorize production',()=>{
  assert.equal(gate.PRODUCTION_AUTHORIZED,false);
  assert.equal(gate.ROOT_EXECUTION_EXPORTED,false);
  assert.equal(fence.PRODUCTION_AUTHORIZED,false);
  assert.equal(fence.ROOT_ACTION_EXPORTED,false);
  assert.equal(seal.PRODUCTION_AUTHORIZED,false);
  for(const obj of [gate,fence,seal]){
    for(const name of ['deploy','issueRoot','apply','register','consumeToDeploy'])
      assert.equal(obj[name],undefined);
  }
});
