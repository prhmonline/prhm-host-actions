'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const m=require('./manifests/honartik-u06-owner-confirmed-four-postimages-20261111.json');
const {BASELINE}=require('./honartik-u06-owner-root-preimages-v1.cjs');
const {F,REQUIRED,INSTALLED_ROOT_BINDING}=require('./honartik-u06-owner-native-transaction-v1.cjs');
const {ACTION,OPERATION}=require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const r=require('./honartik-u06-owner-root-routing-preview-v1.cjs');
const sha=/^[a-f0-9]{64}$/;
test('actual owner --audit-all SHA map exact, not an installer or authorization',()=>{
 assert.equal(m.host,BASELINE.host);
 assert.equal(m.action,ACTION);
 assert.equal(m.action,BASELINE.action);
 assert.equal(m.project,BASELINE.project);
 assert.equal(OPERATION,'host_action.'+ACTION);
 assert.deepEqual(Object.keys(m.preimages).sort(),Object.keys(m.proposed_postimages_sha256).sort());
 for(const [k,p] of Object.entries(BASELINE.owners)){
  assert.equal(m.preimages[k],p.sha256);
  assert.match(m.preimages[k],sha);
  assert.match(m.proposed_postimages_sha256[k],sha);
  assert.notEqual(m.preimages[k],m.proposed_postimages_sha256[k]);
 }
 assert.equal(m.proposed_postimages_sha256.approval_policy,F.reviewed_l4_policy_sha256);
 assert.equal(m.candidate_policy_size_bytes,32036);
 assert.equal(m.policy_operations_after-m.policy_operations_before,1);
 assert.equal(m.policy_typed_scopes_after-m.policy_typed_scopes_before,1);
 assert.equal(m.u06_level,4);
 assert.equal(m.executor_proposed_dispatch,'DENY_ONLY_unimplemented_root_handler');
 assert.equal(m.authorize_consume_before_apply,true);
 assert.equal(m.observed_action_registered,false);
 assert.equal(m.observed_root_executor_installed,false);
 assert.equal(m.observed_policy_mutated,false);
 assert.equal(m.observed_db_mutated,false);
 assert.equal(m.owner_sha_evidence_not_signed_live_install_approval,true);
 assert.equal(r.ROOT_INSTALL_ALLOWED,false);
 assert.equal(INSTALLED_ROOT_BINDING,false);
});
test('native mutation admission adds independent signed Level4 + fsynced replay fence',()=>{
 const core=fs.readFileSync('./honartik-u06-owner-native-transaction-v1.cjs','utf8');
 for(const name of ['verifyNativeConsumedSignedLevel4','reserveNativeLevel4ReplayFence']){
  assert.ok(REQUIRED.includes(name),name+' required');
  assert.ok(core.includes('await native.'+name+'('));
 }
 assert.equal(REQUIRED.length,16);
 assert.ok(core.indexOf('await native.verifyNativeConsumedSignedLevel4(')<
  core.indexOf('await native.reserveNativeLevel4ReplayFence('));
 assert.ok(core.indexOf('await native.reserveNativeLevel4ReplayFence(')<
  core.indexOf('await native.provisionBackupOnlyIdentityAndPrivateCredential('));
 assert.ok(core.indexOf('fence.consumeVerifiedOwnerEvidence(')<
  core.indexOf('await native.provisionBackupOnlyIdentityAndPrivateCredential('));
 assert.equal(F.auto_deploy,false);
 assert.equal(F.yii_migrations,false);
 assert.equal(F.apache_cutover,false);
});
test('no static SHA pin can masquerade as installed action',()=>{
 assert.notEqual(m.proposed_postimages_sha256.root_executor,m.preimages.root_executor);
 assert.ok(r.DENY.includes('not_installed'));
 assert.equal(r.PRODUCTION_APPLY_ALLOWED,false);
 assert.equal(REQUIRED.includes('installU06WithoutApproval'),false);
});
