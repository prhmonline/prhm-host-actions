'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {CONTRACT}=require('./honartik-config-center-enrollment-action-v1.cjs');
const {validateTrustedContext,parseStatus,EXPECTED_PHP}=require('./honartik-config-center-privileged-runner-v1.cjs');
const uuid='d68bc57d-e236-4b51-8e46-24b5cc9d711a';
const receipt=()=>({action:CONTRACT.action,operation:CONTRACT.operation,level:4,
 approvalConsumed:true,requestId:uuid,scriptGitSha:CONTRACT.scriptGitSha});
test('runner requires exact one-time already-consumed signed dispatch receipt',()=>{
 const r=validateTrustedContext(receipt());
 assert.equal(r.approvalConsumed,true);assert.equal(Object.isFrozen(r),true);
 for(const c of [
  {...receipt(),approvalConsumed:false},
  {...receipt(),level:3},
  {...receipt(),requestId:'arbitrary'},
  {...receipt(),scriptGitSha:'0'.repeat(40)},
  {...receipt(),action:'imotion'},
  {...receipt(),shell:'echo hello'},
  null
 ])assert.throws(()=>validateTrustedContext(c),/trusted_approval_context_invalid/);
});
const empty=()=>({site:'honartik',revision:1,activeCredentialCount:0,
 credentialFileExists:false,fileMode:null,fileOwner:null,
 credentialName:null,scopes:[],configHttp:null,secretsHttp:null});
const active=()=>({site:'honartik',revision:1,activeCredentialCount:1,
 credentialFileExists:true,fileMode:'0600',fileOwner:'honartik',
 credentialName:CONTRACT.credentialName,scopes:['config:read'],
 configHttp:200,secretsHttp:403});
test('status schema exact, no bearer token or additional data',()=>{
 assert.deepEqual(parseStatus(JSON.stringify(empty())),empty());
 assert.deepEqual(parseStatus(JSON.stringify(active())),active());
 for(const x of [
  '{',JSON.stringify({...active(),token:'ccm_hidden'}),
  JSON.stringify({...active(),site:'moeinshow'}),
  JSON.stringify({...active(),activeCredentialCount:3}),
  JSON.stringify({...active(),credentialFileExists:'true'})
 ])assert.throws(()=>parseStatus(x));
});
test('verified source and verifier SHA requirement is fail closed if missing',()=>{
 assert.equal(EXPECTED_PHP.source,CONTRACT.scriptSha256);
 assert.match(EXPECTED_PHP.verifier,/^(__VERIFY_SHA_PENDING__|[a-f0-9]{64})$/);
});
test('script runs fixed PHP commands and never exposes arbitrary shell',()=>{
 const src=fs.readFileSync('honartik-config-center-privileged-runner-v1.cjs','utf8');
 assert.match(src,/cp\.spawnSync\(bin,args/);
 assert.doesNotMatch(src,/execSync\(/);
 assert.doesNotMatch(src,/\bshell\s*:\s*true/);
 assert.match(src,/untracked-files=no/);
 assert.match(src,/honartik_enroll|prhm-honartik-config-center-enroll/);
 assert.match(src,/credential_issue_unverified/);
 assert.match(src,/ROLLBACK_PASS=YES REVOKED=1/);
 assert.match(src,/audit_dir_unsafe/);
});
const php=fs.readFileSync('scripts/honartik-config-center-readonly-status-v1.php','utf8');
test('independent status verifier is metadata-only and binds token hash and negative secrets API',()=>{
 assert.match(php,/where\('slug', 'honartik'\)/);
 assert.match(php,/whereNull\('revoked_at'\)/);
 assert.match(php,/hash_equals\(/);
 assert.match(php,/credential->scopes !== \['config:read'\]/);
 assert.match(php,/fetchCode\('\/api\/v1\/secrets'/);
 assert.match(php,/fetchCode\('\/api\/v1\/config'/);
 assert.match(php,/VERIFY_STATUS_FAIL/);
 assert.doesNotMatch(php,/echo\s+\$token/);
 assert.doesNotMatch(php,/print_r\(/);
});
