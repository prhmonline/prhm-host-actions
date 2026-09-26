'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const m = require('./rahekomak-registry-launch-pack-v1.js');

test('RahKomak Registry helper exposes only the fixed launch-pack binding', () => {
  assert.equal(m.ACTION, 'rahekomak_registry_launch_pack_v1');
  assert.equal(m.PROJECT_ROOT, '/home/prhm/projects/generated/rahekomak');
  assert.equal(m.EXPECTED_HEAD, 'b20423da27be6a5765d1946d9c236d41cb191ada');
  assert.equal(m.SERVICE_SHA256, '26731c9d85c5c5285ff427992365de2bbdd8ecee3992c02c91f3ca094417ab31');
  assert.equal(m.COMMAND_SHA256, '17878f9a45fa3a8bdc302ab4871531cf73c20e017bc06e4d4b956deeca654da1');
});

test('RahKomak Registry helper fixes command argv and accepts no passthrough input', () => {
  assert.deepEqual(m.APPLY_ARGV, ['apps/api/artisan', 'rahekomak:registry-launch-pack-v1']);
  assert.deepEqual(m.PREFLIGHT_ARGV, ['apps/api/artisan', 'rahekomak:registry-launch-pack-v1', '--preflight-only']);
  assert.equal(m.assertNoArguments([]), true);
  assert.throws(() => m.assertNoArguments(['anything']), /unexpected_arguments/);
});

test('RahKomak Registry helper is bounded to lock, result shape and safe mutations', () => {
  assert.equal(m.LOCK_PATH, '/run/lock/prhm-rahekomak-registry-launch-pack-v1.lock');
  assert.deepEqual(m.RESULT_FIELDS, ['ok','action','created','already_present','conflicts','resource_slugs','published_count','direct_verified_count']);
  const c = m.contract();
  assert.equal(c.database_mutation, true);
  assert.equal(c.publication_mutation, false);
  assert.equal(c.direct_verification_mutation, false);
  assert.equal(c.dns_mutation, false);
  assert.equal(c.tls_mutation, false);
  assert.equal(c.deploy_mutation, false);
  assert.equal(c.arbitrary_command, false);
  assert.equal(c.arbitrary_path, false);
  assert.equal(c.arbitrary_sql, false);
  assert.equal(c.exclusive_lock, true);
});

test('result parser fails closed on malformed or unsafe output', () => {
  assert.throws(() => m.parseAndValidateResult('not-json'), /result_json_invalid/);
  const good = {
    ok: true,
    action: 'rahekomak_registry_launch_pack_v1',
    created: 6,
    already_present: 0,
    conflicts: [],
    resource_slugs: [
      'police-emergency-110','medical-emergency-115','social-emergency-123',
      'behzisti-counselling-1480','addiction-counselling-09628','judiciary-legal-counselling-129'
    ],
    published_count: 0,
    direct_verified_count: 0
  };
  assert.deepEqual(m.parseAndValidateResult(JSON.stringify(good)), good);
  assert.throws(() => m.parseAndValidateResult(JSON.stringify({...good, published_count: 1})), /published_count_nonzero/);
  assert.throws(() => m.parseAndValidateResult(JSON.stringify({...good, direct_verified_count: 1})), /direct_verified_count_nonzero/);
  assert.throws(() => m.parseAndValidateResult(JSON.stringify({...good, conflicts: ['x']})), /conflicts_nonzero/);
});

const bootstrap = require('./bootstrap-host-actions-rahekomak-registry-launch-pack-v1.js');

test('bootstrap registration is fixed-scope and policy-classified at install time', () => {
  const p = bootstrap.registrationPlan();
  assert.equal(p.action, 'rahekomak_registry_launch_pack_v1');
  assert.equal(p.operation, 'host_action.rahekomak_registry_launch_pack_v1');
  assert.equal(p.helper_sha256, 'b8e73d7bb50a7ea11eedbff38f6832430aa940f960df1ecd5a3e12b5a3b79880');
  assert.equal(p.helper_source, '/home/prhm/worktrees/prhm-host-actions-rahekomak-registry-launch-pack-v1/rahekomak-registry-launch-pack-v1.js');
  assert.equal(p.helper_target, '/opt/prhm-agent-selfmaint-exec/actions/rahekomak-registry-launch-pack-v1.js');
  assert.equal(p.typed_scope.tool, 'host_action_v2_apply');
  assert.equal(p.typed_scope.project, 'control_plane');
  assert.equal(p.typed_scope.environment, 'production');
  assert.equal(p.policy_classification, 'compute_at_install');
  assert.equal(p.accepts_user_payload, false);
  assert.equal(p.arbitrary_command, false);
  assert.equal(p.arbitrary_path, false);
  assert.equal(p.arbitrary_sql, false);
  assert.equal(p.production_application_deploy, false);
  assert.equal(p.database_mutation, true);
  assert.equal(p.transaction_owned_by_application, true);
});

test('preflight parser accepts only the fixed read-only Laravel preflight shape', () => {
  const pre = {
    ok: true,
    action: 'rahekomak_registry_launch_pack_v1',
    conflicts: [],
    resource_slugs: [
      'police-emergency-110','medical-emergency-115','social-emergency-123',
      'behzisti-counselling-1480','addiction-counselling-09628','judiciary-legal-counselling-129'
    ],
    existing_count: 0,
    absent_count: 6
  };
  assert.deepEqual(m.parseAndValidateResult(JSON.stringify(pre), {preflightOnly: true}), pre);
});

test('exclusive lock refuses concurrent invocation and cleans up deterministically', () => {
  const release = m.acquireLock();
  try {
    assert.throws(() => m.acquireLock(), /exclusive_lock_busy/);
  } finally {
    release();
  }
  const release2 = m.acquireLock();
  release2();
});

test('helper source contains no unrelated production roots or publish/direct-verify override argv', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('./rahekomak-registry-launch-pack-v1.js'), 'utf8');
  for (const forbidden of ['/home/honartik','/home/fitness','/home/drtarjomeh','/mnt/imotion-prod-vm','--publish','--direct-verified','--sql']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
