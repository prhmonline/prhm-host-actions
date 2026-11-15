'use strict';
/**
 * U06 fixed SHA source-closure + two-phase bootstrap REVIEW CONTRACT.
 *
 * A review pack is NOT a Root action, installer, L4 issuer or an approval.
 * Stage A (register recovery action) needs independently authorized exact
 * source/policy postimages and independent human code review. Stage B
 * (reconcile an expired challenge) requires its own newly registered
 * exact-operation one-use consumed L4, plus new owner OIDC afterwards.
 *
 * Stage B may never bootstrap Stage A. The existing Native L4 operation,
 * the legacy Level-3 host_action_v2_installer_v1 fixed target, and any
 * already-consumed U06 owner signature cannot authorize Stage A or B.
 */
const crypto=require('node:crypto');
const Pre=require('./honartik-u06-expired-owner-four-owner-preflight-v1.cjs');
const Register=require('./honartik-u06-expired-owner-reconcile-registration-review-v1.cjs');
const Post=require('./honartik-u06-expired-owner-policy-postimage-v1.cjs');
const sha1blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const fail=x=>{throw Error('u06_bootstrap_two_phase_review_'+x)};
const need=(v,x)=>{if(!v)fail(x)};
const SOURCE_COMMIT='f2ec0e22f91ef5ef18e0e8606a9dec5c31d3434d';
const REPO='prhmonline/prhm-host-actions';
const HOST='prhm-production.prhm.ir';
const BLOB_SHA1=Object.freeze({
 'honartik-u06-root-signed-shared-lock-candidate-v1.cjs':'5c64534a2cec2ce3e2eac8c40cb10e54c78b9831',
 'honartik-u06-isolated-root-native-path-v1.cjs':'e4b0b6bb3c9a8d6d5786079dfd721a281b44a0e0',
 'honartik-u06-live-root-readonly-snapshot-v1.cjs':'ec143867620ad61439e369277b347648e9982069',
 'honartik-u06-expired-owner-reconcile-registration-review-v1.cjs':'9bbe1e6968160457d64dfe887fff0aede87c7039',
 'honartik-u06-expired-owner-four-owner-preflight-v1.cjs':'4e68afcb67a1bf979cc126b84a1a05ff3f1eaab7',
 'honartik-u06-expired-owner-policy-postimage-v1.cjs':'4572c2db9a63e7d6a3f483861ef97a5075e16b38',
 'honartik-u06-expired-owner-reconcile-l4-consumed-v1.cjs':'9362d46d78282e7911c67aab7716ae636c122b89',
 'honartik-u06-expired-owner-challenge-reconcile-v1.cjs':'6f982dc5f6108b68a6fea07537937c96cf641e6e',
 'honartik-u06-shared-exclusive-lock-v1.cjs':'07cad08e99c09e5c44a3832396abec85d098bab1',
 'honartik-u06-shared-actor-integration-v1.cjs':'89c46a188105fdda5749b3dbbf9e2dbe0307e7eb',
 'honartik-u06-root-owner-proof-bridge-v1.cjs':'849f034d72ceab159dd70b945bb9dcf18aff4ecc',
 'honartik-u06-root-sealed-evidence-staging-v1.cjs':'2b34bb9425ecddb893be4da6091d39701c64f94d',
 'honartik-u06-native-root-lease-v1.cjs':'b961530f796b13ee214d8b044cf67cf9fbd51aeb',
 'honartik-u06-native-root-l4-admission-v1.cjs':'5f3763182f904b148aa138b7a45e20ec5b363316',
 'honartik-u06-native-l4-consumed-receipt-v1.cjs':'6991907a5c6e35cba6dbb20a09cff145aefa08b5',
 'honartik-u06-real-root-callback-adapter-v1.cjs':'5c2ea4a96493ce6e0798394cebb13238630ad11f',
 'honartik-u06-owner-oidc-once-fence-v1.cjs':'404adcaec045878d9717ec445c44019f75198d2d',
 'honartik-u06-owner-native-transaction-v1.cjs':'31b0f930e9dde015fa0045698151a4cf7731dfc8',
 'honartik-u06-owner-oidc-identity-gate-v1.cjs':'b6b67b319481ffa12d0fb3287c5e6037240d2d8f',
 'honartik-universal-installer-l4-approval-verify-v1.cjs':'280cb91673c074f6abba6e82dc861ac0c0cf9a30',
 'test-honartik-u06-root-signed-shared-lock-candidate-v1.cjs':'62493cfd7c15892309dad263411df96cc05acf53',
 'test-honartik-u06-isolated-root-native-path-v1.cjs':'c4d49d247614a9dcc23e9b91ba38cccc4383405c',
 'test-honartik-u06-ephemeral-root-cryptographic-sandbox-v1.cjs':'8f30698d4db81a7343b26f9cc8c7bffd0e81a6e0',
 'test-honartik-u06-live-root-readonly-snapshot-v1.cjs':'ca91b484c66916fc1902e1f3bda12cd688c63825',
 '.github/workflows/honartik-u06-expired-oidc-reconcile-source-ci.yml':'f610b86825e4a47c261af55e9f13b42a40b61b57'
});
const sha40=/^[0-9a-f]{40}$/;
function verifyPinnedReviewClosure({repo,sourceCommit,host,sourceBuffers}={}){
 need(repo===REPO&&sourceCommit===SOURCE_COMMIT&&host===HOST,'source_identity_drift');
 need(sourceBuffers&&typeof sourceBuffers==='object'&&
  !Array.isArray(sourceBuffers)&&Object.getPrototypeOf(sourceBuffers)===Object.prototype,
  'source_buffers_missing');
 const expect=Object.keys(BLOB_SHA1).sort().join('\n');
 need(Object.keys(sourceBuffers).sort().join('\n')===expect,'dependency_closure_drift');
 for(const [p,sha] of Object.entries(BLOB_SHA1)){
  const bytes=sourceBuffers[p];
  need(Buffer.isBuffer(bytes)&&bytes.length>80&&bytes.length<250000&&
   sha40.test(sha)&&sha1blob(bytes)===sha,
   'source_blob_drift_'+p);
 }
 return Object.freeze({
  schema:'prhm.u06.bootstrap.two-phase.source-review.v1',
  git_repo:REPO,
  reviewed_source_commit:SOURCE_COMMIT,
  dependency_files:Object.keys(BLOB_SHA1).length,
  root_host:HOST,
  root_source_preimage_sha256:Pre.SHA256,
  installed_bridge_preimage_sha256:Register.ROOT_BRIDGE_SHA256,
  reconciliation_policy_preimage_sha256:Post.BEFORE_SHA256,
  reconciliation_policy_postimage_sha256:Post.AFTER_SHA256,
  stage_a_registration_action:Register.OPERATION,
  stage_b_reconciliation_action:Register.OPERATION,
  separate_native_operation:Pre.NATIVE_OPERATION,
  signed_owner_registration_approval_proven:false,
  independent_human_security_review_proven:false,
  official_stage_b_consumed_l4_proven:false,
  all_five_live_root_actors_bound:false,
  old_bootstrap_replay_permitted:false,
  legacy_l3_installer_eligible:false,
  native_l4_can_authorize_registration:false,
  stage_a_registered:false,
  stage_b_performed:false,
  root_deploy_performed:false,
  production_release_authorized:false,
  outcome:'SOURCE_CLOSURE_ONLY__TWO_DISTINCT_AUTHORIZATION_GATES_PENDING'
 });
}
module.exports=Object.freeze({
 SOURCE_COMMIT,REPO,HOST,BLOB_SHA1,verifyPinnedReviewClosure,
 ROOT_ENTRYPOINT:false,REGISTRATION_HANDLER:false,
 POLICY_APPLY:false,LEVEL4_ISSUER:false,
 PRODUCTION_RELEASE_AUTHORIZED:false
});
if(require.main===module){
 process.stderr.write('U06 25-file source review, not a two-phase Root installer or authorization.\n');
 process.exitCode=64;
}
