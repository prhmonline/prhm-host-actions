'use strict';

const fs = require('node:fs');
const cp = require('node:child_process');

const ACTION = 'node1_backup_implementation_v1';
const SERVICE = 'prhm-node1-backup-assurance.service';
const EVIDENCE_FILE = '/var/lib/prhm-backup/node1/latest.json';
const EXPECTED_SCHEMA = 'prhm.node1-backup-assurance.v1';
const NODE1_HOST_FIXED = '185.191.76.138';
const SERVICE_RUNNER = '/usr/local/sbin/prhm-node1-backup-assurance';
const FIXED_SCOPES = Object.freeze([
  '/usr/local/directadmin',
  '/home',
  '/etc',
  '/etc/libvirt',
  '/var/lib/libvirt',
  '/etc/haproxy'
]);
const REQUIRED_EVIDENCE = Object.freeze([
  'backup_pass',
  'offsite_pass',
  'restore_pass',
  'closed',
  'central_capacity_preflight_pass'
]);

function fail(message) {
  throw new Error(message);
}

function assertNoArguments(args) {
  if (!Array.isArray(args) || args.length !== 0) fail('unexpected_arguments');
  return true;
}

function contract() {
  return Object.freeze({
    schema_version: 'prhm.node1-backup-host-action-contract.v1',
    action: ACTION,
    node1_host_fixed: NODE1_HOST_FIXED,
    fixed_scopes: [...FIXED_SCOPES],
    allowed_services: [SERVICE],
    service_runner: SERVICE_RUNNER,
    evidence_file: EVIDENCE_FILE,
    expected_evidence_schema: EXPECTED_SCHEMA,
    required_evidence: [...REQUIRED_EVIDENCE],
    arbitrary_host: false,
    arbitrary_path: false,
    arbitrary_command: false,
    database_mutation: false,
    transport_implemented_in_helper: false,
    central_capacity_preflight_required: true,
    rollback: 'service-owned-fail-closed',
    requires_level4: true
  });
}

function runSystemctl(args) {
  const allowed = [
    JSON.stringify(['show', SERVICE, '--no-pager', '-p', 'LoadState', '-p', 'FragmentPath']),
    JSON.stringify(['start', SERVICE])
  ];
  if (!allowed.includes(JSON.stringify(args))) fail('systemctl_arguments_rejected');
  const r = cp.spawnSync('/usr/bin/systemctl', args, {
    encoding: 'utf8',
    timeout: 12 * 60 * 60 * 1000,
    maxBuffer: 1024 * 1024,
    env: {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      LC_ALL: 'C',
      HOME: '/root'
    }
  });
  if (r.error || r.status !== 0) {
    fail('systemctl_failed:' + String(r.stderr || r.stdout || r.error?.message || '').slice(-2000));
  }
  return String(r.stdout || '');
}

function preflightService() {
  const out = runSystemctl(['show', SERVICE, '--no-pager', '-p', 'LoadState', '-p', 'FragmentPath']);
  if (!/(?:^|\n)LoadState=loaded(?:\n|$)/.test(out)) fail('service_not_loaded');
  const m = out.match(/(?:^|\n)FragmentPath=([^\n]+)(?:\n|$)/);
  if (!m || m[1] !== '/etc/systemd/system/' + SERVICE) fail('service_fragment_path_mismatch');
  return true;
}

function readEvidence() {
  const st = fs.lstatSync(EVIDENCE_FILE);
  if (!st.isFile() || st.isSymbolicLink()) fail('evidence_file_invalid');
  if (st.size < 2 || st.size > 262144) fail('evidence_file_size_invalid');
  let value;
  try {
    value = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
  } catch {
    fail('evidence_json_invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('evidence_shape_invalid');
  return value;
}

function verifyEvidence(evidence, startedAtMs) {
  if (evidence.schema_version !== EXPECTED_SCHEMA) fail('evidence_schema_mismatch');
  if (evidence.node1_host !== undefined && evidence.node1_host !== NODE1_HOST_FIXED) fail('evidence_host_mismatch');
  for (const key of REQUIRED_EVIDENCE) {
    if (evidence[key] !== true) fail('evidence_gate_failed:' + key);
  }
  const finished = Date.parse(String(evidence.finished_at || ''));
  if (!Number.isFinite(finished)) fail('evidence_finished_at_invalid');
  if (finished < startedAtMs - 5000) fail('evidence_not_fresh');
  if (finished > Date.now() + 60000) fail('evidence_finished_at_future');
  return Object.freeze({
    schema_version: evidence.schema_version,
    finished_at: evidence.finished_at,
    backup_pass: true,
    offsite_pass: true,
    restore_pass: true,
    central_capacity_preflight_pass: true,
    closed: true
  });
}

function main(args = process.argv.slice(2)) {
  assertNoArguments(args);
  const startedAtMs = Date.now();
  preflightService();
  runSystemctl(['start', SERVICE]);
  const evidence = verifyEvidence(readEvidence(), startedAtMs);
  return Object.freeze({
    ok: true,
    schema_version: 'prhm.host-action-result.v1',
    action: ACTION,
    service: SERVICE,
    production_application_mutation: false,
    database_mutation: false,
    arbitrary_host: false,
    arbitrary_path: false,
    arbitrary_command: false,
    evidence
  });
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(main()) + '\n');
  } catch (error) {
    process.stderr.write(String(error && error.stack || error) + '\n');
    process.exit(1);
  }
}

module.exports = {
  ACTION,
  SERVICE,
  EVIDENCE_FILE,
  EXPECTED_SCHEMA,
  NODE1_HOST_FIXED,
  SERVICE_RUNNER,
  FIXED_SCOPES,
  REQUIRED_EVIDENCE,
  assertNoArguments,
  contract,
  verifyEvidence,
  main
};
