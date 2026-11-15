'use strict';
/**
 * U06 read-only Production Root snapshot checker, NEVER a release issuer.
 *
 * Compares manually captured, independently measured filesystem metadata and
 * four canonical Owner SHA256s to the reviewed exact-source preimage.
 * This pure source-only module does not contact hosts, read credentials,
 * register an action, produce approval, or authorize Root/Native mutations.
 * Even a wholly valid snapshot returns PRODUCTION_RELEASE_AUTHORIZED:false.
 */
const Owner=require('./honartik-u06-expired-owner-four-owner-preflight-v1.cjs');
const Registration=require('./honartik-u06-expired-owner-reconcile-registration-review-v1.cjs');
const EXPECTED=Object.freeze({
 host:Registration.ROOT_HOST,
 owner_sha256:Owner.SHA256,
 root_bridge_sha256:Registration.ROOT_BRIDGE_SHA256,
 approval_uid:65039,
 approval_mode:700,
 issuer_mode:600,
 native_root_uid:0,
 native_root_mode:700,
 native_policy_operation:Owner.NATIVE_OPERATION,
 reconciliation_policy_operation:Registration.OPERATION,
 root_service:'prhm-agent-selfmaint-exec.service'
});
const UUIDSHA=/^[a-f0-9]{64}$/;
const fail=x=>{throw Error('u06_readonly_root_snapshot_'+x)};
const need=(ok,msg)=>{if(!ok)fail(msg)};
const keys=x=>x&&typeof x==='object'&&!Array.isArray(x)?
 Object.keys(x).sort().join('|'):'';
function checkSnapshot(s,{nowMs}={}){
 need(s&&typeof s==='object'&&!Array.isArray(s)&&
  keys(s)===['host','observed_at_utc','sha256','runtime','approval_fs','challenge'].sort().join('|'),
  'shape_drift');
 need(s.host===EXPECTED.host,'host_mismatch');
 need(typeof s.observed_at_utc==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s.observed_at_utc)&&
  Number.isSafeInteger(nowMs)&&nowMs>0,'clock_invalid');
 const observed=Date.parse(s.observed_at_utc);
 need(Number.isSafeInteger(observed)&&observed<=nowMs&&
  nowMs-observed<=15*60*1000,'stale_snapshot');
 need(keys(s.sha256)===
  ['agent_api','root_executor','agent3_mcp','approval_policy','root_bridge'].sort().join('|'),
  'sha_shape');
 for(const [k,expected] of Object.entries(EXPECTED.owner_sha256)){
  need(UUIDSHA.test(s.sha256[k]||'')&&s.sha256[k]===expected,
   'source_sha_drift_'+k);
 }
 need(s.sha256.root_bridge===EXPECTED.root_bridge_sha256,
  'installed_bridge_sha_drift');
 const a=s.approval_fs;
 need(keys(a)===
  ['private_dir_uid','private_dir_mode','consumed_dir_uid','consumed_dir_mode',
   'issuer_uid','issuer_mode','native_dir_uid','native_dir_mode','oidc_dir_uid','oidc_dir_mode']
    .sort().join('|'),'approval_fs_shape');
 need(a.private_dir_uid===65039&&a.private_dir_mode===700&&
  a.consumed_dir_uid===65039&&a.consumed_dir_mode===700&&
  a.issuer_uid===65039&&a.issuer_mode===600&&
  a.native_dir_uid===0&&a.native_dir_mode===700&&
  a.oidc_dir_uid===0&&a.oidc_dir_mode===700,
  'approval_filesystem_trust_drift');
 const runtime=s.runtime;
 need(keys(runtime)===
  ['root_service_active','native_policy_registered','native_typed_scope',
   'reconcile_policy_registered','reconcile_typed_scope',
   'root_source_contains_native','root_source_contains_reconcile',
   'agent3_source_contains_native','agent3_source_contains_reconcile',
   'sealed_evidence_present','recovery_journal_present',
   'native_lease_present','native_journal_present'].sort().join('|'),
  'runtime_shape_drift');
 need(runtime.root_service_active===true&&
  runtime.native_policy_registered===true&&runtime.native_typed_scope===true&&
  runtime.root_source_contains_native===true&&
  runtime.agent3_source_contains_native===true,
  'native_approval_baseline_drift');
 need(runtime.reconcile_policy_registered===false&&
  runtime.reconcile_typed_scope===false&&
  runtime.root_source_contains_reconcile===false&&
  runtime.agent3_source_contains_reconcile===false,
  'reconciliation_registration_changed');
 need(runtime.sealed_evidence_present===false&&
  runtime.recovery_journal_present===false&&
  runtime.native_lease_present===false&&runtime.native_journal_present===false,
  'unexpected_active_or_recovery_state');
 const c=s.challenge;
 need(keys(c)===['present','issued_at_ms','expires_at_ms'].sort().join('|'),
  'challenge_shape_drift');
 need(c.present===true&&Number.isSafeInteger(c.issued_at_ms)&&
  Number.isSafeInteger(c.expires_at_ms)&&
  c.issued_at_ms>0&&c.expires_at_ms>c.issued_at_ms&&
  c.expires_at_ms<=nowMs,'challenge_missing_or_not_expired');
 // Positive source preflight only. Does NOT prove independent review,
 // that future approved postimage was applied, or that a Root handler exists.
 return Object.freeze({
  schema:'prhm.u06.root.source-preflight.snapshot.v1',
  observed_at_utc:s.observed_at_utc,
  host:s.host,
  exact_live_source_preimage_matched:true,
  old_challenge_expired:true,
  no_active_native_lease_or_rollback:true,
  native_action_installed:true,
  recovery_action_installed:false,
  independent_security_review_verified:false,
  exact_signed_level4_recovery_approval_verified:false,
  root_shared_gate_installed:false,
  owner_oidc_fresh:false,
  native_backup_or_offsite_verified:false,
  production_release_authorized:false,
  recommendation:'NO_GO__REGISTER_RECOVERY_ACTION_ONLY_AFTER_INDEPENDENT_REVIEW_AND_EXACT_L4'
 });
}
module.exports=Object.freeze({
 EXPECTED,checkSnapshot,
 SOURCE_ONLY:true,PRIVILEGED_ENTRYPOINT:false,
 APPROVAL_ISSUER:false,PRODUCTION_RELEASE_AUTHORIZED:false
});
if(require.main===module){
 process.stderr.write('U06 read-only snapshot contract only: no root release, approval or CLI.\n');
 process.exitCode=64;
}
