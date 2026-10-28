'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const T=require('./honartik-universal-installer-native-dispatch-trust-v1.cjs');
const REG=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const REQUEST='11111111-2222-4333-8444-555555555555';
const ACTION='honartik_universal_installer_upgrade_v1';
const binding=(overrides={})=>({
 action:ACTION,level:4,confirmation:'CONFIRM_LEVEL_4_CRITICAL',
 authorization_consumed:true,request_id:REQUEST,
 loadConsumedServerToken:(id)=>'x'.repeat(200),
 ...overrides
});
test('current exact source closure has all 13 pristine pinned Git objects',()=>{
 assert.equal(Object.keys(T.BLOBS).length,13);
 assert.deepEqual(T.BLOBS,REG.ARTIFACTS);
 const got=T.verifyPinnedBlobs(name=>fs.readFileSync(path.join(__dirname,name)));
 assert.equal(got[T.ENTRY],T.BLOBS[T.ENTRY]);
 assert.equal(T.ROOT,'/opt/prhm-agent-selfmaint-exec/actions');
});
test('one byte of drift in any native module is a hard failure',()=>{
 for(const key of Object.keys(T.BLOBS)){
  assert.throws(()=>T.verifyPinnedBlobs(name=>{
   const bytes=fs.readFileSync(path.join(__dirname,name));
   return name===key?Buffer.concat([bytes,Buffer.from('X')]):bytes;
  }),/artifact_changed_/);
 }
});
test('no arbitrary module injection or path override',()=>{
 assert.throws(()=>T.verifyPinnedBlobs(name=>name===T.ENTRY?null:fs.readFileSync(path.join(__dirname,name))),
 /artifact_unavailable_/);
 assert.equal(T.SOURCE_ONLY,true);
 assert.equal(T.ROOT_INSTALLATION_COMPLETED,false);
 assert.equal(T.INDEPENDENT_SECURITY_REVIEW_VERIFIED,false);
 assert.equal(T.NO_L4_APPROVAL_ISSUED_BY_MODULE,true);
 assert.equal(T.BLOBS['../../../../etc/shadow'],undefined);
});
test('fixed in-process binding accepts the original server-issued request only',()=>{
 let n=0;
 const data=T.bindExistingTrustedContext(binding({
  loadConsumedServerToken:id=>{n++;assert.equal(id,REQUEST);return 't'.repeat(256)}
 }));
 assert.equal(n,0);
 assert.equal(data.requestId,REQUEST);
 assert.equal(data.loadForExactRequest(REQUEST),'t'.repeat(256));
 assert.equal(n,1);
 assert.throws(()=>data.loadForExactRequest('22222222-2222-4222-8222-222222222222'),
 /request_identity_drift/);
 assert.equal(n,1);
});
test('wrong action, level, confirmation or consumed flag never reaches loader',()=>{
 for(const bad of [
  {action:'host_action_v2_installer_v1'},
  {level:3},{level:5},{confirmation:'CONFIRM_LEVEL_3_PRODUCTION'},
  {confirmation:''},{authorization_consumed:false},
  {request_id:'not-uuid'},{request_id:'00000000-0000-0000-0000-000000000000'},
  {loadConsumedServerToken:null}
 ])assert.throws(()=>T.bindExistingTrustedContext(binding(bad)),
 /l4_context_invalid/);
 assert.throws(()=>T.bindExistingTrustedContext(null),/trusted_binding_missing/);
});
test('missing or non-server token is rejected before any native use',()=>{
 for(const value of ['x',null,{},'']){const b=T.bindExistingTrustedContext(binding({
  loadConsumedServerToken:()=>value
 }));
 assert.throws(()=>b.loadForExactRequest(REQUEST),/server_token_unavailable/);
 }
});
test('unprivileged process cannot invoke a root action',()=>{
 if(process.getuid?.()===0)return;
 assert.throws(()=>T.runFixedRegisteredAction(binding()),/root_only/);
 assert.throws(()=>T.verifyInstalledRootClosure(),/root_only/);
});
test('module has no direct CLI, remote fetch, token issuer or production registry write',()=>{
 for(const name of ['install','register','issueApproval','consumeApproval',
  'writeOwnerFile','execShell','fetchRemoteSource','retireJournal'])
  assert.equal(T[name],undefined,name);
});
