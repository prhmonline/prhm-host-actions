#!/usr/local/bin/prhm-node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ACTION = 'drtarjomeh_containment_policy_scope_repair_v1';
const TARGET_ACTION = 'drtarjomeh_security_containment_v1';
const TARGET_OPERATION = 'host_action.drtarjomeh_security_containment_v1';
const POLICY = '/opt/prhm-company-control-plane/config/approval-policy.json';
const APPROVAL_SERVICE = 'prhm-company-approval.service';
const REGISTRY_SERVICE = 'prhm-company-registry.service';
const OLD_VERSION = '2026-08-21.1-honartik-iticket-dark-backend-batch2-v1';
const NEW_VERSION = '2026-08-21.2-drtarjomeh-containment-scope-repair-v1';
const EXPECTED_POLICY_SHA256 = 'efd825e3e9ba716ed7ca98c4da9d537a5320eca9d820ef068ec8a5c7e64fdf82';
const BACKUP_PREFIX = '/var/backups/drtarjomeh-containment-policy-scope-repair-v1-';

function fail(message) { throw new Error(message); }
function shaBytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function exactPrincipal(scope) {
  return Array.isArray(scope.principals) &&
    scope.principals.length === 1 &&
    scope.principals[0] &&
    scope.principals[0].principal_id === 'mohammad' &&
    Array.isArray(scope.principals[0].roles) &&
    scope.principals[0].roles.length === 1 &&
    scope.principals[0].roles[0] === 'mcp-operator';
}

function targetScopes(policy) {
  if (!Array.isArray(policy.typed_scopes)) fail('typed_scopes_missing');
  return policy.typed_scopes.filter(scope =>
    scope &&
    scope.tool === 'host_action_v2_apply' &&
    scope.project === 'control_plane' &&
    scope.environment === 'production' &&
    scope.action === TARGET_ACTION &&
    scope.risk === 'critical'
  );
}

function patchPolicyObject(input) {
  const policy = clone(input);
  if (policy.schema_version !== 'prhm.approval-policy.v1') fail('schema_version_mismatch');
  if (policy.version !== OLD_VERSION) fail('policy_version_mismatch');
  if (policy.default_deny !== true) fail('default_deny_not_true');
  if (!policy.operations || policy.operations[TARGET_OPERATION]?.level !== 4) fail('operation_level_mismatch');

  const matches = targetScopes(policy);
  if (matches.length !== 1) fail('target_scope_count:' + matches.length);
  const scope = matches[0];
  if (!exactPrincipal(scope)) fail('principal_mismatch');
  if (Object.prototype.hasOwnProperty.call(scope, 'operation')) fail('unexpected_existing_operation');

  const beforeScopes = policy.typed_scopes.length;
  const beforeOperations = Object.keys(policy.operations).length;
  scope.operation = TARGET_OPERATION;
  policy.version = NEW_VERSION;

  if (policy.typed_scopes.length !== beforeScopes) fail('scope_count_changed');
  if (Object.keys(policy.operations).length !== beforeOperations) fail('operation_count_changed');
  return policy;
}

function exec(file, args, options = {}) {
  const result = cp.spawnSync(file, args, { encoding: 'utf8', maxBuffer: 1024 * 1024, ...options });
  if (result.error) fail('exec_error:' + file + ':' + result.error.message);
  if (result.status !== 0) fail('exec_failed:' + file + ':' + result.status + ':' + String(result.stderr || '').slice(-1000));
  return result;
}

function registryPid() {
  const out = exec('/usr/bin/systemctl', ['show', REGISTRY_SERVICE, '-p', 'MainPID', '--value']).stdout.trim();
  if (!/^\d+$/.test(out) || out === '0') fail('registry_pid_unavailable');
  return out;
}

function approvalHealth() {
  const result = cp.spawnSync('/usr/bin/nsenter', [
    '-t', registryPid(), '-n', '/usr/bin/curl', '-fsS', '--max-time', '3', 'http://127.0.0.1:18133/health'
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function waitForHealth(expectedVersion, expectedHash) {
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 50; i++) {
    const health = approvalHealth();
    if (health && health.ok === true && health.service === 'prhm-company-approval' &&
        health.policy_version === expectedVersion && health.policy_hash === expectedHash) return health;
    Atomics.wait(sleep, 0, 0, 200);
  }
  fail('approval_health_not_ready');
}

function atomicWrite(file, bytes, mode, uid, gid) {
  const tmp = file + '.drtarjomeh-scope-repair-' + process.pid + '-' + Date.now() + '.tmp';
  const fd = fs.openSync(tmp, 'wx', mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(tmp, mode);
  fs.chownSync(tmp, uid, gid);
  fs.renameSync(tmp, file);
}

function buildPlan() {
  if (process.getuid && process.getuid() !== 0) fail('must_run_as_root');
  const stat = fs.lstatSync(POLICY);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('unsafe_policy_file');
  const currentBytes = fs.readFileSync(POLICY);
  const currentSha = shaBytes(currentBytes);
  if (currentSha !== EXPECTED_POLICY_SHA256) fail('policy_sha_mismatch:' + currentSha);
  const current = JSON.parse(currentBytes.toString('utf8'));
  const patched = patchPolicyObject(current);
  const patchedBytes = Buffer.from(JSON.stringify(patched, null, 2) + '\n', 'utf8');
  const parsedAgain = JSON.parse(patchedBytes.toString('utf8'));
  if (parsedAgain.version !== NEW_VERSION) fail('patched_version_invalid');
  if (targetScopes(parsedAgain)[0]?.operation !== TARGET_OPERATION) fail('patched_scope_invalid');
  const expectedPolicyHash = shaBytes(Buffer.from(JSON.stringify(parsedAgain), 'utf8'));
  return { stat, currentBytes, currentSha, patchedBytes, patchedFileSha: shaBytes(patchedBytes), expectedPolicyHash };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + crypto.randomBytes(4).toString('hex');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--preflight-only')) fail('unexpected_arguments');
  const plan = buildPlan();
  const beforeHealth = approvalHealth();
  if (!beforeHealth || beforeHealth.ok !== true || beforeHealth.policy_version !== OLD_VERSION) fail('approval_health_before_invalid');

  if (args[0] === '--preflight-only') {
    console.log(JSON.stringify({
      ok: true,
      schema_version: 'prhm.host-action-remediation-preflight.v1',
      action: ACTION,
      preflight_only: true,
      policy_sha256_before: plan.currentSha,
      policy_sha256_after: plan.patchedFileSha,
      policy_version_before: OLD_VERSION,
      policy_version_after: NEW_VERSION,
      target_action: TARGET_ACTION,
      target_operation: TARGET_OPERATION,
      typed_scope_count_delta: 0,
      operation_count_delta: 0,
      service_restart: false,
      production_application_mutation: false,
      database_mutation: false
    }));
    return;
  }

  const backup = BACKUP_PREFIX + timestamp() + '.json';
  fs.copyFileSync(POLICY, backup, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup, 0o600);
  if (shaBytes(fs.readFileSync(backup)) !== plan.currentSha) fail('backup_sha_mismatch');

  let wrote = false;
  try {
    atomicWrite(POLICY, plan.patchedBytes, plan.stat.mode & 0o777, plan.stat.uid, plan.stat.gid);
    wrote = true;
    if (shaBytes(fs.readFileSync(POLICY)) !== plan.patchedFileSha) fail('post_write_sha_mismatch');
    exec('/usr/bin/systemctl', ['restart', APPROVAL_SERVICE], { timeout: 60000 });
    const afterHealth = waitForHealth(NEW_VERSION, plan.expectedPolicyHash);
    console.log(JSON.stringify({
      ok: true,
      schema_version: 'prhm.host-action-remediation-result.v1',
      action: ACTION,
      installed: true,
      backup,
      policy_sha256_before: plan.currentSha,
      policy_sha256_after: plan.patchedFileSha,
      policy_version_before: OLD_VERSION,
      policy_version_after: NEW_VERSION,
      approval_health_after: {
        ok: afterHealth.ok,
        service: afterHealth.service,
        policy_version: afterHealth.policy_version,
        policy_hash: afterHealth.policy_hash
      },
      typed_scope_count_delta: 0,
      operation_count_delta: 0,
      service_restart: true,
      production_application_mutation: false,
      database_mutation: false,
      rollback: { performed: false }
    }));
  } catch (error) {
    let rollbackError = null;
    let rollbackPerformed = false;
    if (wrote) {
      try {
        atomicWrite(POLICY, fs.readFileSync(backup), plan.stat.mode & 0o777, plan.stat.uid, plan.stat.gid);
        exec('/usr/bin/systemctl', ['restart', APPROVAL_SERVICE], { timeout: 60000 });
        rollbackPerformed = true;
      } catch (rb) { rollbackError = String(rb && (rb.stack || rb.message || rb)).slice(0, 1000); }
    }
    const wrapped = new Error(String(error && (error.message || error)) + ';rollback=' + rollbackPerformed + (rollbackError ? ';rollback_error=' + rollbackError : ''));
    throw wrapped;
  }
}

module.exports = { patchPolicyObject, buildPlan };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(String(error && (error.stack || error)) + '\n'); process.exit(1); }
}
