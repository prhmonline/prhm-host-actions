'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CONTRACT}=require('./honartik-config-center-enrollment-action-v1.cjs');
const {METHODS,createTrustedAdapter,createTrustedRunner}=require('./honartik-config-center-trusted-adapter-v1.cjs');
const UUID='d68bc57d-e236-4b51-8e46-24b5cc9d711a';
function fixture(opts={}){
 const calls=[];
 const pre=()=>({
  site:CONTRACT.site,revision:1,backendSha:CONTRACT.backendSha,
  configCenterRelease:CONTRACT.configCenterRelease,
  scriptGitSha:CONTRACT.scriptGitSha,scriptSha256:CONTRACT.scriptSha256,
  activeCredentialCount:0,credentialFileExists:false,projectGitClean:true,
  scriptGitClean:true,consumerPresent:true,allowedScope:'config:read',
  plaintext_token:'must-never-leak'
 });
 const post=()=>({
  site:CONTRACT.site,revision:1,activeCredentialCount:1,
  credentialFileExists:true,fileMode:'0600',fileOwner:'honartik',
  credentialName:CONTRACT.credentialName,scopes:['config:read'],
  configHttp:200,secretsHttp:opts.secretsHttp??403,
  plaintext_token:'must-never-leak'
 });
 let state=post();
 const host={
  withHonartikEnrollmentLock:async (scope,fn)=>{calls.push('lock');assert.equal(scope.site,'honartik');return fn()},
  readHonartikEnrollmentPreflight:async()=>{calls.push('preflight');return pre()},
  attestHonartikApprovalAlreadyConsumed:async(binding)=>{
   calls.push('attest');
   return {ok:true,requestId:binding.requestId,action:CONTRACT.action,
    operation:CONTRACT.operation,level:opts.level??4,
    confirmation:'CONFIRM_LEVEL_4_CRITICAL',sourceSha:CONTRACT.scriptGitSha,
    consumedOnce:true,plaintext_token:'must-never-leak'};
  },
  issueHonartikReadonlyCredential:async()=>{calls.push('issue');return 'issued'},
  revokeHonartikReadonlyCredential:async()=>{calls.push('revoke');state={activeCredentialCount:0,credentialFileExists:false};return 'revoked'},
  readHonartikCredentialPostcondition:async()=>{calls.push('post');return state},
  runHonartikReadonlyYiiDiagnostic:async()=>{calls.push('yii');return {exitCode:0,output:'CONFIG_CENTER_READONLY_PASS tenant=honartik revision=1 source=remote'}},
  appendHonartikEnrollmentAudit:async record=>{calls.push('audit');assert.deepEqual(Object.keys(record).sort(),['action','result','rollback','site','sourceSha'].sort());return true}
 };
 return {host,calls};
}
test('all eight typed methods required before constructing adapter',()=>{
 assert.equal(METHODS.length,8);
 assert.throws(()=>createTrustedAdapter({}),/trusted_host_missing_method/);
 assert.throws(()=>createTrustedRunner(null),/trusted_host_missing/);
});
test('happy path returns bounded metadata and never plaintext',async()=>{
 const h=fixture(),runner=createTrustedRunner(h.host);
 const outcome=await runner.apply({requestId:UUID});
 assert.deepEqual(outcome,{action:CONTRACT.action,site:'honartik',revision:1,status:'success',rollback:'not_needed'});
 assert.equal(JSON.stringify(outcome).includes('must-never-leak'),false);
 assert.deepEqual(h.calls,['lock','preflight','attest','issue','post','yii','audit']);
});
test('approval wrong level blocks issuance',async()=>{
 const h=fixture({level:3}),r=createTrustedRunner(h.host);
 assert.equal((await r.apply({requestId:UUID})).status,'denied');
 assert.equal(h.calls.includes('issue'),false);
});
test('secrets route 200 triggers rollback and no success',async()=>{
 const h=fixture({secretsHttp:200}),r=createTrustedRunner(h.host);
 const result=await r.apply({requestId:UUID});
 assert.equal(result.status,'failed');assert.equal(result.rollback,'verified');
 assert.ok(h.calls.includes('revoke'));
});
test('host receives only frozen tenant scope; no arbitrary commands or user data',async()=>{
 const h=fixture(),ad=createTrustedAdapter(h.host);
 const p=await ad.readPreflight();
 assert.equal(Object.hasOwn(p,'plaintext_token'),false);
 const approval=await ad.attestConsumedApproval({
  requestId:UUID,action:CONTRACT.action,operation:CONTRACT.operation,
  level:4,sourceSha:CONTRACT.scriptGitSha
 });
 assert.equal(Object.hasOwn(approval,'plaintext_token'),false);
 await assert.rejects(ad.attestConsumedApproval({
  requestId:UUID,action:'other',operation:CONTRACT.operation,
  level:4,sourceSha:CONTRACT.scriptGitSha
 }),/approval_binding_drift/);
 await assert.rejects(ad.withExclusiveLock('arbitrary',()=>null),/unexpected_enrollment_action/);
});
test('audit never accepts token-bearing or unknown fields',async()=>{
 const h=fixture(),ad=createTrustedAdapter(h.host);
 await assert.rejects(ad.writeAudit({action:CONTRACT.action,site:'honartik',sourceSha:CONTRACT.scriptGitSha,
  result:'success',rollback:'not_needed',token:'secret'}),/audit_fields_invalid/);
 assert.equal(h.calls.includes('audit'),false);
});
