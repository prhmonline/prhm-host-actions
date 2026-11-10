'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const gate=require('./honartik-u06-owner-oidc-identity-gate-v1.cjs');
const {G}=require('./universal-owner-oidc-recovery-gate-v1.cjs');
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const kid='u06-synthetic-rsa-test';
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid,use:'sig',alg:'RS256'}]};
const now=1800000000,nonce='a'.repeat(64),sha='b'.repeat(40);
const env={name:gate.W.environment,can_admins_bypass:true,
  deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
  protection_rules:[{type:'required_reviewers',prevent_self_review:true,
    reviewers:[{type:'User',reviewer:{id:Number(gate.W.approverId)}}]}]};
const branches={branch_policies:[{name:'main',type:'branch'}]};
const run={id:483729,actor:{id:Number(gate.W.actorId)},event:'workflow_dispatch',
  head_branch:'main',head_sha:sha,run_attempt:1,conclusion:'success',
  path:gate.W.workflowPath};
const approvals=[{user:{id:Number(gate.W.approverId)},state:'approved'}];
const claims=Object.freeze({
  iss:G.issuer,aud:gate.audience(nonce),
  sub:'repo:prhmonline/prhm-host-actions:environment:'+gate.W.environment,
  repository:'prhmonline/prhm-host-actions',
  repository_id:gate.W.repoId,repository_owner_id:gate.W.ownerId,
  workflow_ref:gate.W.workflowRef,workflow_sha:sha,
  environment:gate.W.environment,ref:'refs/heads/main',
  event_name:'workflow_dispatch',runner_environment:'github-hosted',
  actor_id:gate.W.actorId,run_id:String(run.id),run_attempt:'1',
  jti:'u06-synthetic-jti-34999342',
  iat:now-45,nbf:now-50,exp:now+200
});
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt=(c=claims,h={kid,alg:'RS256',typ:'JWT'})=>{
  const input=b64(h)+'.'+b64(c);
  return input+'.'+crypto.sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
};
const valid=(overrides={})=>gate.verifyU06OwnerIdentity({
  token:jwt(),jwks,environment:env,branches,run,approvals,
  challenge:nonce,expectedRunSha:sha,nowSec:now,...overrides
});
const reject=(label,change)=>assert.throws(()=>valid(change),new RegExp(label));
test('owner approval is correctly RSA-signed and scope-bound identity only',()=>{
  const result=valid();
  assert.equal(result.owner_identity_verified,true);
  assert.equal(result.github_oidc_signature_valid,true);
  assert.equal(result.protected_environment_approval_valid,true);
  assert.equal(result.intent_digest,gate.intentDigest());
  assert.equal(result.external_provider_approval_required,false);
  assert.equal(result.approval_to_modify_production,false);
  assert.equal(result.one_use_receipt_consumed,false);
  assert.equal(result.backend_deploy_authorized,false);
});
test('fixed intent pins database, native adapter and exact source preimage',()=>{
  assert.equal(gate.INTENT.project,'honartik_back.production');
  assert.equal(gate.INTENT.operation,'honartik_back.production.native_backup');
  assert.equal(gate.INTENT.host,'prhm-production.prhm.ir');
  assert.equal(gate.INTENT.adapter_sha256.length,64);
  assert.equal(gate.INTENT.profile_sha256.length,64);
  assert.deepEqual(gate.INTENT.allowed_grants,['SELECT','SHOW VIEW','TRIGGER','EVENT']);
  assert.equal(gate.INTENT.application_deploy,false);
  assert.equal(gate.INTENT.yii_migrations,false);
});
test('U06 audience is not universal owner-recovery audience',()=>{
  assert.notEqual(gate.audience(nonce),
    'urn:prhm:universal:owner-enrollment:v1:'+nonce+':test');
  assert.match(gate.audience(nonce),/^urn:prhm:u06:honartik-backup-owner:v1:/);
});
test('wrong nonce rejected even with otherwise valid official JWT',()=>{
  reject('wrong_issuer_or_intent',{challenge:'c'.repeat(64)});
});
test('bad nonce syntax fails closed',()=>{
  reject('invalid_challenge',{challenge:'x'});
});
test('tampered JWT payload invalidates RSA signature',()=>{
  const tokens=jwt().split('.');
  tokens[1]=b64({...claims,actor_id:'999'});
  reject('rsa_signature_invalid',{token:tokens.join('.')});
});
test('malicious JWT jku refused by parent hardening',()=>{
  reject('untrusted_header',{token:jwt(claims,{kid,alg:'RS256',
    jku:'https://malicious.example/jwks'})});
});
test('separate Universal owner OIDC audience rejected',()=>{
  reject('wrong_issuer_or_intent',{token:jwt({...claims,aud:
    'urn:prhm:universal:owner-enrollment:v1:'+nonce+':abc'})});
});
test('wrong U06 workflow file refused',()=>{
  reject('workflow_claims_mismatch',{token:jwt({...claims,workflow_ref:
    'prhmonline/prhm-host-actions/.github/workflows/universal-owner-recovery-oidc-v1.yml@refs/heads/main'})});
});
test('source SHA drift denied in official claim',()=>{
  reject('workflow_claims_mismatch',{token:jwt({...claims,workflow_sha:'f'.repeat(40)})});
});
test('official GitHub run source SHA drift denied',()=>{
  reject('official_run_not_pinned',{run:{...run,head_sha:'f'.repeat(40)}});
});
test('owner requestor cannot self-approve',()=>{
  reject('explicit_owner_approval_missing',{approvals:[
    {user:{id:Number(gate.W.actorId)},state:'approved'}]});
});
test('missing external owner approval denied, including admin bypass',()=>{
  reject('explicit_owner_approval_missing',{approvals:[]});
});
test('prevent_self_review policy cannot be relaxed',()=>{
  const altered={...env,protection_rules:[{...env.protection_rules[0],
    prevent_self_review:false}]};
  assert.throws(()=>valid({environment:altered}),/environment_owner_review_not_required/);
});
test('unexpected branches and wildcard rules rejected',()=>{
  assert.throws(()=>valid({branches:{branch_policies:[{name:'*',type:'branch'}]}}),
    /branch_policy_drift/);
});
test('stale, expired or future OIDC rejected',()=>{
  reject('expired_or_stale',{nowSec:now+400});
  reject('expired_or_stale',{nowSec:now-150});
});
test('unexpected issued token lifetime rejected',()=>{
  reject('expired_or_stale',{token:jwt({...claims,exp:now+900})});
});
test('wrong repo ID, env and subject rejected',()=>{
  reject('workflow_claims_mismatch',{token:jwt({...claims,repository_id:'333'})});
  reject('subject_mismatch',{token:jwt({...claims,sub:'repo:attacker/evil'})});
  reject('workflow_claims_mismatch',{token:jwt({...claims,environment:'production'})});
});
test('run replay attempt greater than 1 denied',()=>{
  reject('official_run_not_pinned',{run:{...run,run_attempt:2}});
  reject('official_run_not_pinned',{token:jwt({...claims,run_attempt:'2'})});
});
test('wrong GitHub actor denied despite valid signature',()=>{
  reject('workflow_claims_mismatch',{token:jwt({...claims,actor_id:'123'})});
  reject('official_run_not_pinned',{run:{...run,actor:{id:123}}});
});
test('missing JWT unique ID rejected (needed for eventual durable fence)',()=>{
  reject('jti_missing',{token:jwt({...claims,jti:undefined})});
});
test('wrong or untrusted JWKS RSA public key denied',()=>{
  const k=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  reject('rsa_signature_invalid',{jwks:{keys:[{...k.publicKey.export({format:'jwk'}),kid,alg:'RS256'}]}});
});
test('source module never exports command, credential, registry or production authority',()=>{
  for(const k of ['execute','register','issueLevel4','makeMysqlUser','installRoot','apply'])
    assert.equal(gate[k],undefined,k);
  assert.equal(gate.ROOT_EXECUTION_EXPORTED,false);
  assert.equal(gate.PRODUCTION_AUTHORIZED,false);
});

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const fence=require('./honartik-u06-owner-oidc-once-fence-v1.cjs');
function testDir(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'u06-owner-fence-'));
  fs.chmodSync(dir,0o700);
  return dir;
}
test('verified signed U06 identity is durably consumed once in 0700 ledger',()=>{
  const directory=testDir();
  try{
    const receipt=valid();
    const result=fence.consumeVerifiedOwnerEvidence(receipt,{
      directory,trustedUid:process.getuid()
    });
    assert.equal(result.consumed,true);
    assert.equal(result.receipt_fsynced,true);
    assert.equal(result.directory_fsynced,true);
    assert.equal(result.native_root_action_authorized,false);
    assert.equal(result.production_mutated,false);
    const files=fs.readdirSync(directory);
    assert.equal(files.length,1);
    assert.equal(fs.statSync(path.join(directory,files[0])).mode&0o777,0o600);
    assert.throws(()=>fence.consumeVerifiedOwnerEvidence(receipt,{
      directory,trustedUid:process.getuid()}),/replayed_receipt/);
  }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('fake caller booleans and JSON copy of genuine proof cannot consume lease',()=>{
  const directory=testDir();
  try{
    const verified=valid();
    const forged={...verified,owner_identity_verified:true};
    assert.throws(()=>fence.consumeVerifiedOwnerEvidence(forged,{
      directory,trustedUid:process.getuid()}),
    /not_cryptographically_verified_in_process/);
    const serialized=JSON.parse(JSON.stringify(verified));
    assert.throws(()=>fence.consumeVerifiedOwnerEvidence(serialized,{
      directory,trustedUid:process.getuid()}),
    /not_cryptographically_verified_in_process/);
    assert.deepEqual(fs.readdirSync(directory),[]);
  }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('weak private ledger mode refuses receipt rather than granting privilege',()=>{
  const directory=testDir();
  try{
    fs.chmodSync(directory,0o755);
    assert.throws(()=>fence.consumeVerifiedOwnerEvidence(valid(),{
      directory,trustedUid:process.getuid()}),/untrusted_ledger_directory/);
    assert.equal(fs.readdirSync(directory).length,0);
  }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('symlinked ledger directory and UID drift refused',()=>{
  const directory=testDir(),alias=directory+'-alias';
  try{
    fs.symlinkSync(directory,alias);
    assert.throws(()=>fence.consumeVerifiedOwnerEvidence(valid(),{
      directory:alias,trustedUid:process.getuid()}),/untrusted_ledger_directory/);
    assert.throws(()=>fence.consumeVerifiedOwnerEvidence(valid(),{
      directory,trustedUid:process.getuid()+2}),/untrusted_ledger_directory/);
    assert.equal(fs.readdirSync(directory).length,0);
  }finally{fs.rmSync(alias,{force:true});fs.rmSync(directory,{recursive:true,force:true})}
});
