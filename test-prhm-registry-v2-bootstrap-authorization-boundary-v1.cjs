'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const root = require('./prhm-registry-v2-bootstrap-authorization-boundary-v1.cjs');
const enrollment = require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');

test('fixed bootstrap admission identity covers 35 runtime assets and one unit', () => {
  const x = root.immutableCandidate();
  assert.equal(x.action, 'prhm_shared_registry_root_bootstrap_v2');
  assert.equal(x.project, 'control_plane');
  assert.equal(x.artifacts.length, 36);
  assert.equal(new Set(x.artifacts.map(f => f.destination)).size, 36);
  assert.equal(x.artifacts.at(-1).destination,
    '/etc/systemd/system/prhm-shared-registry-approval-v2.service');
  assert.match(x.manifest_sha256, /^[0-9a-f]{64}$/);
  assert.equal(root.immutableCandidate().manifest_sha256, x.manifest_sha256);
  assert.equal(x.required_l4_level, 4);
  assert.equal(x.required_one_time_receipt, true);
  assert.equal(x.status, 'SOURCE_ONLY_NOT_SIGNED_NOT_INSTALLED');
  assert.equal(x.eligible_for_approval, false);
  assert.equal(x.installable, false);
  assert.equal(Object.keys(x.protected_owner_sha256).length, 4);
});

test('enrollment approval identity cannot authorize root Bootstrap', () => {
  const x = root.immutableCandidate();
  const enroll = enrollment.REQUEST;
  assert.notEqual(x.action, enroll.action);
  assert.notEqual(x.manifest_sha256, enroll.manifest_sha256);
  assert.throws(() => root.assertNotEnrollmentAuthorization({...enroll}),
    /enrollment_approval_cannot_install_root_bootstrap/);
  assert.throws(() => root.assertNotEnrollmentAuthorization({
    ...enroll, action: root.ACTION
  }), /enrollment_release_not_bootstrap_bundle/);
  assert.throws(() => root.assertNotEnrollmentAuthorization({
    action: root.ACTION, project: root.PROJECT,
    manifest_sha256: enroll.manifest_sha256
  }), /root_bundle_identity_not_pinned/);
});

test('even a matching root bundle identity is not signed consumed authorization', () => {
  const x = root.immutableCandidate();
  const report = root.assertNotEnrollmentAuthorization({
    action: x.action, project: x.project, manifest_sha256: x.manifest_sha256
  });
  assert.deepEqual(report, {
    identity_matching: true,
    signed_approval_verified: false,
    consumed_ledger_verified: false,
    execution_authorized: false
  });
  assert.throws(() => root.execute(),
    /independent_signed_root_of_trust_not_installed/);
});

test('an arbitrary identity, missing fields or forged boolean fail closed', () => {
  const x = root.immutableCandidate();
  for (const obj of [null, {}, {action:'*',project:'*',manifest_sha256:'*'},
    {action:x.action,project:'other',manifest_sha256:x.manifest_sha256},
    {action:x.action,project:x.project,manifest_sha256:'0'.repeat(64),
      signed_approved:true}]) {
    assert.throws(() => root.assertNotEnrollmentAuthorization(obj));
  }
  assert.throws(() => root.assertNotEnrollmentAuthorization({
    ...enrollment.REQUEST, signed_approved:true, consumed:true
  }), /enrollment_approval_cannot_install_root_bootstrap/);
});
