'use strict';
/**
 * U06 Honartik native Universal DB backup — REGISTRATION REVIEW CANDIDATE.
 *
 * SOURCE / OFFLINE TESTS ONLY. This is not an installed Host Action,
 * a root adapter, a signer, an operator entrypoint, or an approval issuer.
 * It cannot register itself, execute SQL, create accounts, read secrets,
 * modify the Universal profile or authorize a production release.
 *
 * A future trusted Provider Root-of-Trust must independently verify source
 * provenance, bind four Control Plane owners, consume a fresh signed one-use
 * Level-4 approval, and implement fail-closed journal/recovery semantics.
 */
const ACTION='honartik_u06_native_backup_register_v1';
const OPERATION='host_action.'+ACTION;
const EXPECTED=Object.freeze({
  schema:'prhm.honartik.u06.native-backup-registration-review.v1',
  action:ACTION,
  operation:OPERATION,
  project:'honartik_back.production',
  environment:'production',
  host:'prhm-production.prhm.ir',
  risk:'critical',
  level:4,
  one_time_approval:true,
  approval_signature:'Ed25519-trusted-approval-center',
  approval_freshness_seconds:180,
  source_repo:'prhmonline/prhm-host-actions',
  installed_native_adapter_sha256:'d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3',
  installed_production_profile_sha256:'79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698',
  native_adapter:'/usr/local/libexec/deploy-control/universal/current/universal/adapters/database.py',
  profile:'/etc/deploy-control/projects/honartik_back.production.json',
  credential_path:'/etc/deploy-control/secrets/honartik_back/mysql.cnf',
  secret_owner:'native-adapter-executor-root',
  secret_mode:'0600',
  secret_parent_mode:'0700',
  mysql_account:'honartik_universal_backup',
  mysql_host:'127.0.0.1',
  mysql_database:'honartik_db',
  mysql_privileges:Object.freeze(['SELECT','SHOW VIEW','TRIGGER','EVENT']),
  mysql_global_grants:false,
  grant_option:false,
  native_backup_function:'backup_database',
  native_restore_function:'verify_database_restore',
  offsite_required_after:true,
  independent_offsite_provider:'Node1 encrypted restic SFTP',
  offsite_max_evidence_age_hours:30,
  require_full_mysqlcheck:true,
  require_finance_aggregate_validation:true,
  production_yii_migrate_allowed:false,
  application_deploy_allowed:false,
  apache_restart_allowed:false,
  auto_production_release_allowed:false,
  signed_root_registration_authority_pinned:false,
  installed_host_action_binding:false,
});
const HEX64=/^[0-9a-f]{64}$/;
const STATUS_KEYS=Object.freeze([
  'adapter_sha256','profile_sha256','profile_identity_verified',
  'real_mysql_origin_verified','four_database_grants_exact',
  'no_global_or_write_grants','credential_file_private_and_executor_owned',
  'fresh_node1_database_restore_verified','native_backup_and_restore_verified',
  'full_mysqlcheck_passed','financial_aggregates_unchanged',
  'offsite_required_true','installer_transaction_rollback_test_passed',
  'signed_one_time_l4_consumed','native_root_binding_present',
]);
function exactKeys(object,fields) {
  return !!object&&typeof object==='object'&&!Array.isArray(object)&&
    Object.keys(object).sort().join('|')===fields.slice().sort().join('|');
}
function fail(reason) { throw new Error('honartik_u06_registration_review_'+reason); }
function noRuntimeArguments(args) {
  if(!Array.isArray(args)||args.length!==0)fail('runtime_arguments_forbidden');
  return Object.freeze({
    action:ACTION,source_only:true,installed:false,registration_authorized:false,
    production_deploy_authorized:false
  });
}
/** Test-only/static metadata gate. Do NOT accept caller-supplied booleans as
 * attested root/Approval Center evidence. Even all-green remains NO-GO.
 */
function reviewCandidate(snapshot) {
  if(!exactKeys(snapshot,STATUS_KEYS))fail('attestation_shape_untrusted');
  if(!HEX64.test(snapshot.adapter_sha256)||
     !HEX64.test(snapshot.profile_sha256))fail('invalid_digest');
  const blockers=[];
  if(snapshot.adapter_sha256!==EXPECTED.installed_native_adapter_sha256)
    blockers.push('adapter_sha_drift');
  if(snapshot.profile_sha256!==EXPECTED.installed_production_profile_sha256)
    blockers.push('profile_sha_drift');
  const checks=Object.freeze([
    ['profile_identity_verified','profile_identity_unverified'],
    ['real_mysql_origin_verified','mysql_origin_unverified'],
    ['four_database_grants_exact','database_grants_not_minimal'],
    ['no_global_or_write_grants','excessive_mysql_grants'],
    ['credential_file_private_and_executor_owned','mysql_credential_not_private'],
    ['fresh_node1_database_restore_verified','offsite_recovery_evidence_missing'],
    ['native_backup_and_restore_verified','native_backup_restore_evidence_missing'],
    ['full_mysqlcheck_passed','full_database_integrity_not_verified'],
    ['financial_aggregates_unchanged','financial_consistency_not_verified'],
    ['offsite_required_true','mandatory_offsite_profile_missing'],
    ['installer_transaction_rollback_test_passed','native_transaction_rollback_unverified'],
    ['signed_one_time_l4_consumed','authentic_l4_consumption_missing'],
    ['native_root_binding_present','trusted_native_root_binding_missing']
  ]);
  for(const [key,reason] of checks)
    if(snapshot[key]!==true)blockers.push(reason);
  // No self-authorization even if all input booleans claim success.
  // A native Root-of-Trust has to verify independent original evidence.
  return Object.freeze({
    schema:EXPECTED.schema,
    action:ACTION,
    source_review_claims_satisfied:blockers.length===0,
    blockers:Object.freeze(blockers),
    trusted_registration_authorized:false,
    native_mysql_account_created:false,
    credential_file_written:false,
    production_database_mutated:false,
    production_profile_modified:false,
    level4_approval_requested_or_consumed:false,
    universal_native_backup_admitted:false,
    production_deploy_authorized:false
  });
}
module.exports=Object.freeze({ACTION,OPERATION,EXPECTED,STATUS_KEYS,noRuntimeArguments,reviewCandidate});
