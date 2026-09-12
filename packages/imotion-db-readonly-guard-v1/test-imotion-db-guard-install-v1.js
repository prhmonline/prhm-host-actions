'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const HELPER = path.join(ROOT, 'imotion-db-guard-install-v1.js');
const BOOTSTRAP = path.join(ROOT, '..', '..', 'bootstrap-host-actions-v28-imotion-db-readonly-guard-v1.js');

const EXPECTED_TARGETS = [
  '/usr/local/sbin/imotion-db-writability-guard',
  '/usr/local/sbin/imotion-db-readonly-window',
  '/etc/systemd/system/imotion-db-writability-guard.service',
  '/etc/systemd/system/imotion-db-writability-guard.timer',
  '/etc/audit/rules.d/imotion-db-forensics.rules'
];

test('helper exports the fixed iMotion guard installer contract', () => {
  assert.equal(fs.existsSync(HELPER), true, 'helper missing');
  const h = require(HELPER);
  assert.equal(h.ACTION, 'imotion_db_guard_install_v1');
  assert.equal(h.HOSTNAME, 'prhm-production.prhm.ir');
  assert.equal(h.CONTAINER, 'imotion-db');
  assert.equal(h.EXPECTED_SERVER_ID, '1');
  assert.deepEqual(h.TARGETS.map(x => x.destination), EXPECTED_TARGETS);
  assert.equal(h.ARBITRARY_COMMAND_INPUT, false);
  assert.equal(h.ARBITRARY_SQL_INPUT, false);
});

test('helper is SHA-bound, symlink-safe, atomic and rollback capable', () => {
  const s = fs.readFileSync(HELPER, 'utf8');
  assert.match(s, /manifest\.json/);
  assert.match(s, /approved_preimages/i);
  assert.match(s, /sha256/i);
  assert.match(s, /lstatSync/);
  assert.match(s, /isSymbolicLink/);
  assert.match(s, /renameSync/);
  assert.match(s, /fsyncSync/);
  assert.match(s, /rollback/i);
  assert.match(s, /bash.*-n|'-n'/s);
});

test('helper verifies writable primary and does not restart MariaDB or Docker', () => {
  const s = fs.readFileSync(HELPER, 'utf8');
  assert.match(s, /SELECT @@global\.read_only/);
  assert.match(s, /SELECT @@global\.server_id/);
  assert.match(s, /SHOW SLAVE STATUS/);
  assert.match(s, /read_only.*0/s);
  assert.match(s, /server_id.*1/s);
  assert.doesNotMatch(s, /docker\s+restart/i);
  assert.doesNotMatch(s, /systemctl[^\n]*(restart|try-restart)[^\n]*(maria|mysql|docker)/i);
  assert.doesNotMatch(s, /SET GLOBAL read_only=ON/);
});

test('helper manages only the fixed timer/audit bundle and verifies HTTP', () => {
  const s = fs.readFileSync(HELPER, 'utf8');
  assert.match(s, /imotion-db-writability-guard\.timer/);
  assert.match(s, /daemon-reload/);
  assert.match(s, /enable/);
  assert.match(s, /auditctl/);
  assert.match(s, /imotion-db-docker-root/);
  assert.match(s, /admin\.i-motion\.ir/);
  assert.match(s, /5xx|>=\s*500|status.*500/i);
});

test('bootstrap is fixed to current live v28 baselines and Level-4 policy', () => {
  assert.equal(fs.existsSync(BOOTSTRAP), true, 'bootstrap missing');
  const b = require(BOOTSTRAP);
  assert.equal(b.ACTION, 'imotion_db_guard_install_v1');
  assert.equal(b.OPERATION, 'host_action.imotion_db_guard_install_v1');
  assert.deepEqual(b.BASELINE, {
    base: '981a430f5448a1b0dc3c25886756ecf7cd655352660bb49905ab2650a131d764',
    executor: '451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48',
    policy: '494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70',
    mcp: '703a8f8ee0726fac47d008a69c759e3f52254c980cf551ea3f2660cc46321283'
  });

  const policyFixture = JSON.stringify({
    schema_version: 'prhm.approval-policy.v1',
    version: '2026-09-05.3-autonomous-operator-v1',
    operations: {},
    typed_scopes: []
  });
  const next = JSON.parse(b.patchPolicy(policyFixture));
  assert.equal(next.operations['host_action.imotion_db_guard_install_v1'].level, 4);
  assert.equal(next.operations['host_action.imotion_db_guard_install_v1'].risk, 'critical');
  const scope = next.typed_scopes.find(x => x.action === 'imotion_db_guard_install_v1');
  assert.equal(scope.tool, 'host_action_v2_apply');
  assert.equal(scope.project, 'control_plane');
  assert.equal(scope.environment, 'production');
  assert.equal(scope.risk, 'critical');
});

test('bootstrap registers helper only and cannot execute Production during install', () => {
  const s = fs.readFileSync(BOOTSTRAP, 'utf8');
  assert.match(s, /imotion_db_guard_install_v1/);
  assert.match(s, /host_action\.imotion_db_guard_install_v1/);
  assert.match(s, /install/i);
  assert.doesNotMatch(s, /SET GLOBAL read_only=ON/);
  assert.doesNotMatch(s, /host_action_v2_apply\s*\(/);
  assert.doesNotMatch(s, /imotion-db-writability-guard\.timer[^\n]*start/);
});
