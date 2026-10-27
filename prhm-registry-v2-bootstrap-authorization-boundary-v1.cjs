'use strict';
/**
 * SHA-bound root-bootstrap authorization identity (review-only).
 *
 * IMPORTANT: The existing five-field Honartik enrollment approval authorizes
 * a *different transaction* than installation of the Shared Registry V2 root
 * bootstrap. This module constructs the immutable initial-stage identity and
 * rejects attempts to reuse enrollment approval. Neither constructing an
 * identity nor verifying its structure is an approval or an executable route.
 *
 * Only an independently reviewed and authenticated Root-of-Trust transport
 * may subsequently add Ed25519 signature, actual Approval Center consumption,
 * host preimage attestation, crash-safe filesystem journal and rollback.
 */
const crypto = require('node:crypto');
const runner = require('./manifests/honartik-shared-registry-v2-independent-root-launcher-stage-v2.json');
const sidecar = require('./manifests/honartik-shared-registry-v2-root-capabilities-stage-v1.json');
const unit = require('./manifests/honartik-shared-registry-v2-sidecar-unit-stage-v1.json');
const boundary = require('./honartik-staging-privilege-boundary-install-v1.js');
const enrollment = require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const ROOT = '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2';
const UNIT = '/etc/systemd/system/prhm-shared-registry-approval-v2.service';
const ACTION = 'prhm_shared_registry_root_bootstrap_v2';
const PROJECT = 'control_plane';
const PINS = Object.freeze({
  runner: 'cdf622e7b2db4e098f667a522c483e0b02b24bed',
  sidecar: 'a5e1fae442085cdbc59c4dbc2b82b83d6c1efebd',
  unit: '68f0ebfe75e1f12466277b80ad356eb3fb130f56'
});
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const RELATIVE = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/;
function reject(code) {
  throw Error('registry_root_bootstrap_binding_' + code);
}
function check(ok, code) { if (!ok) reject(code); }
function canonicalJson(input) {
  if (input === null || typeof input !== 'object')
    return JSON.stringify(input);
  if (Array.isArray(input))
    return '[' + input.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(input).sort()
    .map(k => JSON.stringify(k) + ':' + canonicalJson(input[k])).join(',') + '}';
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
function immutableCandidate() {
  check(runner.schema === 'prhm.honartik.registry-v2.independent-root-launcher-stage.v2' &&
    runner.root === ROOT && runner.status === 'REVIEWED_SOURCE_ONLY_NOT_STAGED' &&
    runner.declared_runtime_source_count === 28 &&
    runner.reviewed_code?.length === 28 &&
    runner.standalone_execution_authorized === false &&
    runner.root_staged === false, 'runner_stage_not_review_only');
  check(sidecar.schema === 'prhm.honartik.shared-registry-v2.root-capability-provider-stage.v1' &&
    sidecar.destination_root === ROOT && sidecar.status === 'NOT_STAGED' &&
    sidecar.files?.length === 7 && sidecar.installation_authorized === false &&
    sidecar.requires_fresh_signed_l4 === true, 'sidecar_stage_not_review_only');
  check(unit.schema === 'prhm.honartik.shared-registry-v2.sidecar-unit-stage.v1' &&
    unit.destination === UNIT && unit.status === 'NOT_STAGED' &&
    unit.source_units?.[0]?.git_blob_sha1 ===
      'dc87ad2937b63ab965944cef081f55a6a0984cdd' &&
    unit.non_installable_without_signed_five_field_bootstrap === true,
    'unit_not_review_only');
  check(Object.keys(boundary.PINS).sort().join('|') ===
    Object.keys(PINS).sort().join('|'), 'source_manifest_set_drift');
  for (const k of Object.keys(PINS))
    check(boundary.PINS[k].blob === PINS[k], 'stage_manifest_pin_drift_' + k);

  const sources = [...runner.reviewed_code, ...sidecar.files];
  check(sources.length === 35, 'runtime_source_count');
  const seen = new Set();
  const files = sources.map(f => {
    check(RELATIVE.test(f.source_path) &&
      f.source_path.split('/').every(k => k !== '.' && k !== '..') &&
      f.destination === ROOT + '/' + f.source_path &&
      HEX40.test(f.source_commit) && HEX40.test(f.git_blob_sha1) &&
      !seen.has(f.destination), 'source_path_or_blob_untrusted');
    seen.add(f.destination);
    return Object.freeze({
      source_commit: f.source_commit,
      source_path: f.source_path,
      git_blob_sha1: f.git_blob_sha1,
      destination: f.destination
    });
  });
  const service = unit.source_units[0];
  check(RELATIVE.test(service.source_path) &&
    HEX40.test(service.source_commit) &&
    HEX40.test(service.git_blob_sha1) &&
    !seen.has(UNIT), 'unit_source_or_target_drift');
  files.push(Object.freeze({
    source_commit: service.source_commit,
    source_path: service.source_path,
    git_blob_sha1: service.git_blob_sha1,
    destination: UNIT
  }));
  check(files.length === 36 &&
    new Set(files.map(f => f.destination)).size === 36,
    'incomplete_or_duplicate_root_stage');
  check(Object.keys(boundary.OWNERS).sort().join('|') ===
    'base|executor|mcp|policy' &&
    Object.values(boundary.OWNERS).every(s => HEX64.test(s)),
    'protected_owner_baseline_invalid');

  const immutable = Object.freeze({
    schema: 'prhm.shared-registry.root-bootstrap-admission.v1',
    action: ACTION, project: PROJECT,
    artifacts: files,
    manifest_git_blobs: PINS,
    protected_owner_sha256: boundary.OWNERS
  });
  const manifest_sha256 = sha256(Buffer.from(canonicalJson(immutable)));
  check(HEX64.test(manifest_sha256) &&
    ACTION !== enrollment.REQUEST.action &&
    manifest_sha256 !== enrollment.REQUEST.manifest_sha256,
    'enrollment_and_bootstrap_identity_collision');
  return Object.freeze({
    ...immutable, manifest_sha256,
    required_l4_level: 4, required_one_time_receipt: true,
    status: 'SOURCE_ONLY_NOT_SIGNED_NOT_INSTALLED',
    eligible_for_approval: false,
    installable: false
  });
}
function assertNotEnrollmentAuthorization(args) {
  check(args && typeof args === 'object' && !Array.isArray(args),
    'authorization_arguments_missing');
  // NO approval object, JWS or consumed-ledger JSON can be manufactured or
  // accepted by this review helper: enforce a distinct fixed root action.
  check(args.action !== enrollment.REQUEST.action,
    'enrollment_approval_cannot_install_root_bootstrap');
  check(args.project !== enrollment.REQUEST.project ||
    args.manifest_sha256 !== enrollment.REQUEST.manifest_sha256,
    'enrollment_release_not_bootstrap_bundle');
  check(args.action === ACTION && args.project === PROJECT &&
    args.manifest_sha256 === immutableCandidate().manifest_sha256,
    'root_bundle_identity_not_pinned');
  return Object.freeze({
    identity_matching: true,
    signed_approval_verified: false,
    consumed_ledger_verified: false,
    execution_authorized: false
  });
}
function execute() { reject('independent_signed_root_of_trust_not_installed'); }
module.exports = Object.freeze({
  ACTION, PROJECT, ROOT, UNIT, PINS, immutableCandidate,
  assertNotEnrollmentAuthorization, execute
});
