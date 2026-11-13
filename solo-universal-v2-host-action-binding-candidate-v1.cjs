'use strict';
/*
 * Fixed Host Actions v2 BINDING CANDIDATE for Universal Solo observation.
 * SOURCE ONLY — NO active registry insertion, request issuance or root apply.
 * Owner-governed Level-4 production admission remains a separate operation.
 * The committed six-file Solo root registration MUST NOT be replayed.
 */
const crypto = require('node:crypto');

const ACTION = 'universal_existing_stateful_service_observe_adoption_v2';
const HOST_ACTION = 'host_action.' + ACTION;
const OPERATION = 'universal.existing_stateful_service_observe_adoption_v2';
const PIN = Object.freeze({
  schema: 'prhm.host-actions.solo-universal-v2-fixed-binding-candidate.v1',
  action: ACTION,
  host_action_operation: HOST_ACTION,
  owner_signed_operation: OPERATION,
  environment: 'production',
  project: 'solo_company',
  host: 'prhm-production.prhm.ir',
  release_sha: '0eb43d72aab3f10db22172c8be4c0411cf22d074',
  solo_unit: 'prhm-solo-company-runtime.service',
  loopback: '127.0.0.1:8782',
  universal_v1_before: '08889c18a570cc2bff408dfbe78b7e5f4f8da24f465b4fdd445640cd7f89d17d',
  universal_v2_candidate: '20d8a4f5a972fcfb33812c67e935b38a65d9b71be8a4c7cf21d9f7b4999b929a',
  profile_sha256: 'f767738f3059650e22c137c22e9b4c93f6f28db14ebe8ee3d20eb9c99e7a6df4',
  deploy_control_source_commit: 'eb780b7d518270e23a0e0b813e554a7ac6d8cfc9',
  risk: 'critical',
  level: 4,
  one_time_use: true,
  approval_expires_seconds: 180,
  approval_issuer: 'owner_ed25519',
  signed_scope_required: true,
  exact_preimage_required: true,
  requires_separate_root_driver: true,
  allows_only_observation_adoption: true,
  allows_runtime_restart: false,
  allows_runtime_install: false,
  allows_runtime_state_write: false,
  allows_runtime_deploy: false,
  allows_public_listener: false,
  allows_v1_profile_mutation: false,
  requires_rollback: true,
  installed_in_production: false,
  operation_registered: false,
  permit_issued: false,
  status: 'SOURCE_ONLY_NO_GO'
});
const fail = s => { throw Error('solo_universal_v2_binding_' + s); };
function exact(value, pinned) {
  if (typeof value !== typeof pinned) return false;
  if (pinned && typeof pinned === 'object') {
    if (!value || Array.isArray(value) || Array.isArray(pinned)) return false;
    const a = Object.keys(value).sort(), b = Object.keys(pinned).sort();
    return a.length === b.length &&
      a.every((k, i) => k === b[i] && exact(value[k], pinned[k]));
  }
  return value === pinned;
}
function verifyBinding(payload) {
  if (!exact(payload, PIN)) fail('identity_or_scope_drift');
  return Object.freeze({
    valid: true, source_only: true, registered: false, executable: false,
    owner_permit_available: false, release_sha: PIN.release_sha,
    operation: PIN.owner_signed_operation,
    managed_by_universal: false
  });
}
function reviewPreflight(payload, evidence) {
  verifyBinding(payload);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
    fail('evidence_missing');
  const expected = {
    profile_sha256: PIN.profile_sha256,
    current_universal_digest: PIN.universal_v1_before,
    candidate_universal_digest: PIN.universal_v2_candidate,
    solo_release_sha: PIN.release_sha,
    solo_active: true,
    solo_loopback_only: true,
    solo_state_unchanged: true,
    existing_v1_profiles_unchanged: true,
    root_driver_approved: false,
    signed_level4_permit_present: false,
    production_registry_changed: false
  };
  if (!exact(evidence, expected)) fail('evidence_drift');
  return Object.freeze({
    result: 'SOURCE_REVIEW_PASS_PRODUCTION_NO_GO',
    binding_sha256: crypto.createHash('sha256')
      .update(JSON.stringify(PIN)).digest('hex'),
    operation: PIN.owner_signed_operation,
    approved_for_production: false,
    root_execution_enabled: false,
    runtime_restart_allowed: false,
    missing: [
      'reviewed_limited_root_installer',
      'registered_fixed_host_action',
      'fresh_owner_signed_level4_permit',
      'signed_production_acceptance'
    ]
  });
}
module.exports = Object.freeze({ACTION, HOST_ACTION, OPERATION, PIN,
  verifyBinding, reviewPreflight});
if (require.main === module) {
  process.stderr.write('SOURCE_ONLY_NO_LIVE_REGISTRATION: not an executor or issuer\n');
  process.exitCode = 64;
}
