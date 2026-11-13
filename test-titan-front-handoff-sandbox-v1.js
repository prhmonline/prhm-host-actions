'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const m = require('./titan-front-handoff-sandbox-v1.js');

test('Titan handoff helper exposes only the fixed production binding', () => {
  assert.equal(m.ACTION, 'titan_front_handoff_sandbox_v1');
  assert.equal(m.PROD_ROOT, '/home/fitness/domains/titanfitness-club.com/public_html');
  assert.equal(m.SERVICE, 'titan-front.service');
  assert.equal(m.OLD_SHA, '0d781ca811461805b28656b1765124bef664cd70');
  assert.equal(m.TARGET_SHA, '1ab3d075ecf25800ded63a5d3b1b88d601161dac');
  assert.equal(m.TARGET_REF, 'refs/heads/fix/full-audit-2026-08-16');
  assert.equal(m.BRANCHES_SHA256, '9174c929ff4cc70c58b57655d4ce103bca757dd400ef7dc00e959c3cec4acbe2');
});

test('Titan handoff helper confines writable paths and keeps home read-only', () => {
  assert.deepEqual(m.WRITABLE_PATHS, [
    '/home/fitness/domains/titanfitness-club.com/public_html',
    '/home/fitness/.titan-handoff-deploy-v2'
  ]);
  const props = m.systemdProperties();
  assert.ok(props.includes('ProtectHome=read-only'));
  assert.ok(props.includes('ProtectSystem=strict'));
  assert.ok(!props.includes('RestrictSUIDSGID=true'));
  assert.ok(!props.includes('LockPersonality=true'));
  assert.deepEqual(
    props.filter(x => x.startsWith('ReadWritePaths=')),
    [
      'ReadWritePaths=/home/fitness/domains/titanfitness-club.com/public_html',
      'ReadWritePaths=/home/fitness/.titan-handoff-deploy-v2'
    ]
  );
});

test('Titan handoff helper fixes the release diff to the six approved files', () => {
  assert.deepEqual(m.TARGET_FILES, [
    '.github/workflows/audit.yml',
    '.github/workflows/live-smoke.yml',
    'scripts/source-regression.mjs',
    'scripts/studios-regression.mjs',
    'src/components/pages/home/branches.tsx',
    'tsconfig.json'
  ]);
});

test('Titan handoff helper accepts no arbitrary execution input', () => {
  assert.equal(m.assertNoArguments([]), true);
  assert.throws(() => m.assertNoArguments(['anything']), /unexpected_arguments/);
});

test('Titan handoff contract declares rollback and all mandatory verification gates', () => {
  const c = m.contract();
  assert.equal(c.database_mutation, false);
  assert.equal(c.arbitrary_command, false);
  assert.equal(c.arbitrary_path, false);
  assert.equal(c.arbitrary_revision, false);
  assert.equal(c.arbitrary_host, false);
  assert.equal(c.credential_input, false);
  assert.equal(c.rollback, 'automatic');
  assert.deepEqual(c.pre_cutover_gates, [
    'source_regression',
    'studios_regression',
    'lint',
    'build',
    'target_sha',
    'branches_sha256'
  ]);
  assert.deepEqual(c.post_cutover_gates, [
    'service_active',
    'local_smoke',
    'public_home_smoke',
    'placeholder_absent',
    'clubs_api_json_valid',
    'branches_sha256'
  ]);
});

const bootstrap = require('./bootstrap-host-actions-titan-front-handoff-sandbox-v1.js');

test('Titan bootstrap is Level-4, fixed-scope and SHA-bound to the helper', () => {
  const p = bootstrap.registrationPlan();
  assert.equal(p.action, 'titan_front_handoff_sandbox_v1');
  assert.equal(p.operation, 'host_action.titan_front_handoff_sandbox_v1');
  assert.equal(p.level, 4);
  assert.equal(p.risk, 'critical');
  assert.equal(p.helper_sha256, 'd876f5700260cf9133b1568369b23fde779e70a8ba19ab1884226603bcf0c691');
  assert.equal(p.typed_scope.tool, 'host_action_v2_apply');
  assert.equal(p.typed_scope.project, 'control_plane');
  assert.equal(p.typed_scope.environment, 'production');
  assert.equal(p.typed_scope.principal_id, 'mohammad');
  assert.equal(p.typed_scope.role, 'mcp-operator');
  assert.equal(p.production_application_mutation, false);
  assert.equal(p.database_mutation, false);
  assert.equal(p.arbitrary_path, false);
  assert.equal(p.arbitrary_command, false);
  assert.equal(p.requires_level4, true);
});
