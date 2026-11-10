'use strict';
/**
 * PRHM owner-controlled delivery policy (SOURCE ONLY, no privileged executor).
 *
 * Normal development is not gated by external Provider registration/signing.
 * Production is controlled by the PRHM owner through the existing GitHub
 * protected-environment / owner OIDC pathway with independent host policy,
 * scoped credentials, backup, integrity tests and recoverable deployment.
 *
 * This module NEVER issues a token, authorizes a deployment, or calls host tools.
 */
const POLICY=Object.freeze({
  schema:'prhm.delivery.owner-controlled-policy.v1',
  ordinary_development_external_provider_required:false,
  ordinary_development_level4_required:false,
  ordinary_development_host_action_registration_required:false,
  production_external_provider_required:false,
  owner_identity_path:'GitHub protected environment and verified owner OIDC',
  owner_recovery_workflow:'.github/workflows/universal-owner-recovery-oidc-v1.yml',
  owner_approval_is_not_source_review:true,
  owner_approval_is_not_host_execution_authority:true,
  root_executor_remains_confined:true,
  production_requires_exact_git_sha:true,
  production_requires_explicit_owner_decision:true,
  production_requires_backup_restore_evidence:true,
  production_requires_health_and_rollback:true,
  production_requires_audited_execution:true,
  production_auto_deploy_enabled:false,
});
const KINDS=Object.freeze(['git_change','read_only_host_audit','production_mutation']);
function classify(kind,assessment={}) {
  if(!KINDS.includes(kind))throw new Error('unknown_operation_type');
  if(!assessment||typeof assessment!=='object'||Array.isArray(assessment))
    throw new Error('invalid_assessment');
  const production=kind==='production_mutation';
  const expected=production?['source_sha_pinned','owner_environment_approval_verified',
    'host_scope_verified','native_backup_restore_verified','rollback_test_verified',
    'audit_log_configured']:[];
  // Source-only assessment: never promote caller-provided green fields to
  // permission. The on-host verifier must authenticate official evidence.
  return Object.freeze({
    schema:POLICY.schema,operation_kind:kind,
    external_provider_approval_required:false,
    needs_owner_production_authorization:production,
    review_checks:Object.freeze(expected),
    source_only_git_can_proceed:kind==='git_change',
    read_only_audit_can_proceed:kind==='read_only_host_audit',
    production_approved:false,
    level4_token_issued:false,
    action_registered:false,
    production_mutated:false
  });
}
module.exports=Object.freeze({POLICY,KINDS,classify});
