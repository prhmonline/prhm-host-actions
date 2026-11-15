'use strict';
/**
 * U06 expired owner OIDC recovery — FIXED REGISTRATION REVIEW CONTRACT.
 *
 * Source-only. No Host Action registration, Root execution, signature issuer,
 * owner challenge reset, arbitrary file path, deploy, or critical L4 action.
 * Exact Git-blob pins prevent review of a moving/unrelated nine-file bundle.
 * A trusted installer must independently verify signed owner authority,
 * on-host source preimages, shared Root lock and the consumed one-use L4.
 * This module never returns permission to apply, even after a matching review.
 */
const crypto=require('node:crypto');
const ACTION='honartik_u06_expired_owner_oidc_reconcile_v1';
const OPERATION='host_action.'+ACTION;
const ROOT_HOST='prhm-production.prhm.ir';
const ROOT_BRIDGE='/opt/prhm-agent-selfmaint-exec/actions/honartik-u06-root-owner-proof-bridge-v1.cjs';
const ROOT_BRIDGE_SHA256='35f1f79c397d66008b017014a3141d5518ff416f34fc18fbdaebc9087ecd449d';
const REPO='prhmonline/prhm-host-actions';
const PINNED_CODE_HEAD='fbf631dc5ccf266b3cfbb53604c8afec1ec0b8cd';
const ASSETS=Object.freeze({
 'honartik-u06-expired-owner-challenge-reconcile-v1.cjs':'6f982dc5f6108b68a6fea07537937c96cf641e6e',
 'honartik-u06-shared-exclusive-lock-v1.cjs':'07cad08e99c09e5c44a3832396abec85d098bab1',
 'honartik-u06-root-owner-proof-bridge-v1.cjs':'849f034d72ceab159dd70b945bb9dcf18aff4ecc',
 'honartik-u06-root-sealed-evidence-staging-v1.cjs':'2b34bb9425ecddb893be4da6091d39701c64f94d',
 'honartik-u06-native-root-lease-v1.cjs':'b961530f796b13ee214d8b044cf67cf9fbd51aeb',
 'honartik-u06-real-root-callback-adapter-v1.cjs':'5c2ea4a96493ce6e0798394cebb13238630ad11f',
 'honartik-u06-owner-oidc-once-fence-v1.cjs':'404adcaec045878d9717ec445c44019f75198d2d',
 'honartik-u06-owner-native-transaction-v1.cjs':'31b0f930e9dde015fa0045698151a4cf7731dfc8',
 'honartik-u06-shared-actor-integration-v1.cjs':'89c46a188105fdda5749b3dbbf9e2dbe0307e7eb'
});
const deny=x=>{throw Error('u06_reconcile_registration_review_'+x)};
const need=(v,x)=>{if(!v)deny(x)};
const gitBlob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const ownKeys=(x)=>Object.keys(x).sort().join('|');
const SHA256=/^[a-f0-9]{64}$/;
function reviewFixedCandidate({sourceRepo,sourceCommit,host,installedRootBridgeSha256,sourceBuffers}={}){
 need(sourceRepo===REPO&&sourceCommit===PINNED_CODE_HEAD,'git_source_drift');
 need(host===ROOT_HOST&&installedRootBridgeSha256===ROOT_BRIDGE_SHA256,'root_host_preimage_drift');
 need(sourceBuffers&&typeof sourceBuffers==='object'&&!Array.isArray(sourceBuffers)&&
   Object.getPrototypeOf(sourceBuffers)===Object.prototype&&
   ownKeys(sourceBuffers)===ownKeys(ASSETS),'source_closure_drift');
 for(const [name,expected] of Object.entries(ASSETS)){
  const b=sourceBuffers[name];
  need(Buffer.isBuffer(b)&&b.length>100&&b.length<250000,'source_type_'+name);
  need(gitBlob(b)===expected,'blob_sha_mismatch_'+name);
 }
 const shared=sourceBuffers['honartik-u06-shared-exclusive-lock-v1.cjs'].toString('utf8');
 const bridge=sourceBuffers['honartik-u06-root-owner-proof-bridge-v1.cjs'].toString('utf8');
 const native=sourceBuffers['honartik-u06-real-root-callback-adapter-v1.cjs'].toString('utf8');
 const stage=sourceBuffers['honartik-u06-root-sealed-evidence-staging-v1.cjs'].toString('utf8');
 const once=sourceBuffers['honartik-u06-owner-oidc-once-fence-v1.cjs'].toString('utf8');
 const reconcile=sourceBuffers['honartik-u06-expired-owner-challenge-reconcile-v1.cjs'].toString('utf8');
 need(shared.includes("live_root_gate_not_installed")&&
   bridge.includes("Shared.assertSourceBoundLease(sharedBinding,'owner_challenge_issuance')")&&
   bridge.includes("Shared.assertSourceBoundLease(sharedBinding,'owner_evidence_consumption')")&&
   stage.includes("Shared.assertSourceBoundLease(sharedBinding,'owner_evidence_staging')")&&
   native.includes("Shared.assertSourceBoundLease(sharedBinding,'native_backup_transaction')")&&
   once.includes("Shared.assertSourceBoundLease(sharedBinding,")&&
   reconcile.includes("LIVE_RECONCILIATION_EXPORTED:false")&&
   reconcile.includes("PRODUCTION_MUTATION_AUTHORIZED:false"),
   'required_fail_closed_guards_missing');
 // These are reviewed SOURCE assets; they are deliberately NOT the live Root
 // installer/dispatcher. No signed Level-4 permit is produced or consumed here.
 return Object.freeze({
  schema:'prhm.u06.expired-owner-oidc.registration-review.v1',
  action:ACTION,operation:OPERATION,host:ROOT_HOST,
  git_commit:PINNED_CODE_HEAD,source_files:Object.keys(ASSETS).length,
  installed_bridge_sha256:ROOT_BRIDGE_SHA256,
  fixed_root_bridge_path:ROOT_BRIDGE,
  level4_approval_operation:OPERATION,
  separate_native_level4_operation:'host_action.honartik_u06_native_backup_register_v1',
  old_bootstrap_replay_permitted:false,
  expired_github_oidc_replay_permitted:false,
  requires_signed_exact_scope_one_use_l4:true,
  requires_authorized_root_action_registration:true,
  requires_shared_root_lock_for_all_five_actors:true,
  requires_cryptographic_owner_identity_after_reconciliation:true,
  requires_independently_verified_native_backup:false,
  source_review_passed:true,
  root_registration_authorized:false,
  production_mutation_authorized:false,
  old_challenge_retired:false,
  native_backup_executed:false,
  owner_oidc_verified:false,
  apply_available:false
 });
}
module.exports=Object.freeze({
 ACTION,OPERATION,ROOT_HOST,ROOT_BRIDGE,ROOT_BRIDGE_SHA256,REPO,
 PINNED_CODE_HEAD,ASSETS,reviewFixedCandidate,
 ROOT_ACTION_REGISTERED:false,PRODUCTION_MUTATION_AUTHORIZED:false,
 LEVEL4_ISSUER:false,APPLY_EXPORTED:false
});
if(require.main===module){
 process.stderr.write('Fixed U06 registration review ONLY; no privileged Root CLI or apply.\n');
 process.exitCode=64;
}
