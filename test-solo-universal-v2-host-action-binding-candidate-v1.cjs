'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const b = require('./solo-universal-v2-host-action-binding-candidate-v1.cjs');

const evidence = () => ({
  profile_sha256: b.PIN.profile_sha256,
  current_universal_digest: b.PIN.universal_v1_before,
  candidate_universal_digest: b.PIN.universal_v2_candidate,
  solo_release_sha: b.PIN.release_sha,
  solo_active: true,
  solo_loopback_only: true,
  solo_state_unchanged: true,
  existing_v1_profiles_unchanged: true,
  root_driver_approved: false,
  signed_level4_permit_present: false,
  production_registry_changed: false
});

test('only immutable Universal v2 observe-only source binding is accepted', () => {
  const x = b.verifyBinding(b.PIN);
  assert.equal(x.registered, false);
  assert.equal(x.executable, false);
  assert.equal(x.owner_permit_available, false);
  assert.equal(x.managed_by_universal, false);
  assert.equal(x.operation, 'universal.existing_stateful_service_observe_adoption_v2');
  assert.equal(b.ACTION, 'universal_existing_stateful_service_observe_adoption_v2');
  assert.equal(b.PIN.level, 4);
  assert.equal(b.PIN.risk, 'critical');
  assert.equal(b.PIN.one_time_use, true);
  assert.equal(b.PIN.approval_expires_seconds, 180);
  assert.equal(b.PIN.approval_issuer, 'owner_ed25519');
  assert.equal(b.PIN.status, 'SOURCE_ONLY_NO_GO');
});

test('reject any mutable authority, SHA or target changes', () => {
  for (const [k, value] of Object.entries({
    risk: 'low', level: 3, one_time_use: false,
    permit_issued: true, operation_registered: true,
    installed_in_production: true,
    approval_expires_seconds: 86400,
    allows_runtime_restart: true,
    allows_runtime_install: true,
    allows_runtime_state_write: true,
    allows_runtime_deploy: true,
    allows_public_listener: true,
    allows_v1_profile_mutation: true,
    signed_scope_required: false,
    requires_separate_root_driver: false,
    universal_v2_candidate: 'f'.repeat(64),
    profile_sha256: 'a'.repeat(64),
    solo_unit: 'fake.service',
    loopback: '0.0.0.0:8782',
    deploy_control_source_commit: '0'.repeat(40)
  })) {
    assert.throws(() => b.verifyBinding({...b.PIN, [k]: value}),
      /identity_or_scope_drift/, k);
  }
  assert.throws(() => b.verifyBinding({...b.PIN, unknown: true}),
    /identity_or_scope_drift/);
});

test('source review readiness never grants production authority', () => {
  const x = b.reviewPreflight(b.PIN, evidence());
  assert.equal(x.result, 'SOURCE_REVIEW_PASS_PRODUCTION_NO_GO');
  assert.equal(x.approved_for_production, false);
  assert.equal(x.root_execution_enabled, false);
  assert.equal(x.runtime_restart_allowed, false);
  assert.equal(x.missing.length, 4);
  assert.equal(x.binding_sha256,
    crypto.createHash('sha256').update(JSON.stringify(b.PIN)).digest('hex'));
});

test('preflight rejects missing live health or compromised v1', () => {
  for (const k of Object.keys(evidence())) {
    const e = evidence();
    e[k] = typeof e[k] === 'boolean' ? !e[k] : 'drift';
    assert.throws(() => b.reviewPreflight(b.PIN, e), /evidence_drift/, k);
  }
});

test('source-only contract cannot request, approve or install anything', () => {
  const f = path.join(__dirname, 'solo-universal-v2-host-action-binding-candidate-v1.cjs');
  const source = fs.readFileSync(f, 'utf8');
  for (const pattern of [/spawnSync\s*\(/, /execSync\s*\(/, /systemctl restart/,
      /fs\.writeFile/, /https\.request/, /process\.env\.[A-Z_]+/]) {
    assert.doesNotMatch(source, pattern);
  }
  for (const method of ['apply', 'install', 'restart', 'register', 'issueReceipt']) {
    assert.equal(typeof b[method], 'undefined');
  }
  const r = cp.spawnSync(process.execPath, [f], {encoding: 'utf8'});
  assert.equal(r.status, 64);
  assert.match(r.stderr, /SOURCE_ONLY_NO_LIVE_REGISTRATION/);
});
