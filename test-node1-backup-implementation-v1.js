'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const HELPER_FILE='./node1-backup-implementation-v1.js';
const BOOTSTRAP_FILE='./bootstrap-host-actions-node1-backup-implementation-v1.js';

test('Node1 helper exists and exports only fixed bindings', () => {
  assert.equal(fs.existsSync(HELPER_FILE), true, 'implementation_missing');
  const m = require(HELPER_FILE);
  assert.equal(m.ACTION, 'node1_backup_implementation_v1');
  assert.equal(m.SERVICE, 'prhm-node1-backup-assurance.service');
  assert.equal(m.EVIDENCE_FILE, '/var/lib/prhm-backup/node1/latest.json');
  assert.equal(m.EXPECTED_SCHEMA, 'prhm.node1-backup-assurance.v1');
  assert.equal(m.assertNoArguments([]), true);
  assert.throws(() => m.assertNoArguments(['anything']), /unexpected_arguments/);
});

test('Node1 helper delegates only to one fixed service and verifies fresh closure evidence', () => {
  const m = require(HELPER_FILE);
  const c = m.contract();
  assert.deepEqual(c.allowed_services, ['prhm-node1-backup-assurance.service']);
  assert.equal(c.arbitrary_host, false);
  assert.equal(c.arbitrary_path, false);
  assert.equal(c.arbitrary_command, false);
  assert.equal(c.database_mutation, false);
  assert.equal(c.transport_implemented_in_helper, false);
  assert.equal(c.central_capacity_preflight_required, true);
  assert.deepEqual(c.required_evidence, [
    'backup_pass',
    'offsite_pass',
    'restore_pass',
    'closed',
    'central_capacity_preflight_pass'
  ]);
  const source = fs.readFileSync(HELPER_FILE, 'utf8');
  assert.doesNotMatch(source, /\bssh\b|rsync|mariadb-dump|mysqldump|rclone|pg_dump/);
  assert.match(source, /systemctl/);
  assert.match(source, /finished_at/);
});

test('Node1 bootstrap plan is Level-4, critical and SHA-bound', () => {
  assert.equal(fs.existsSync(BOOTSTRAP_FILE), true, 'bootstrap_missing');
  const b = require(BOOTSTRAP_FILE);
  const p = b.registrationPlan();
  assert.equal(p.action, 'node1_backup_implementation_v1');
  assert.equal(p.operation, 'host_action.node1_backup_implementation_v1');
  assert.equal(p.level, 4);
  assert.equal(p.risk, 'critical');
  assert.equal(p.helper_source.endsWith('/node1-backup-implementation-v1.js'), true);
  assert.equal(p.helper_target, '/opt/prhm-agent-selfmaint-exec/actions/node1-backup-implementation-v1.js');
  assert.match(p.helper_sha256, /^[a-f0-9]{64}$/);
  assert.equal(p.typed_scope.tool, 'host_action_v2_apply');
  assert.equal(p.typed_scope.project, 'control_plane');
  assert.equal(p.typed_scope.environment, 'production');
  assert.equal(p.typed_scope.principal_id, 'mohammad');
  assert.equal(p.typed_scope.role, 'mcp-operator');
  assert.equal(p.requires_level4, true);
  assert.equal(p.arbitrary_path, false);
  assert.equal(p.arbitrary_command, false);
  assert.equal(p.database_mutation, false);
  assert.equal(p.production_application_mutation, false);
});
