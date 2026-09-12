#!/usr/local/bin/prhm-node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ACTION = 'imotion_db_guard_install_v1';
const HOSTNAME = 'prhm-production.prhm.ir';
const CONTAINER = 'imotion-db';
const EXPECTED_SERVER_ID = '1';
const ARBITRARY_COMMAND_INPUT = false;
const ARBITRARY_SQL_INPUT = false;
const PACKAGE_ROOT = __dirname;
const MANIFEST_FILE = path.join(PACKAGE_ROOT, 'manifest.json');
const RESULT_DIR = '/var/lib/prhm-agent-selfmaint-exec/imotion-db-guard-install-v1';
const RESULT_FILE = path.join(RESULT_DIR, 'latest.json');
const BACKUP_ROOT = '/var/backups/imotion-db-guard-install-v1';
const TIMER = 'imotion-db-writability-guard.timer';
const SERVICE = 'imotion-db-writability-guard.service';
const ADMIN_URL = 'https://admin.i-motion.ir/';
const AUDIT_KEY = 'imotion-db-docker-root';
const SHA_RE = /^[a-f0-9]{64}$/;
const HOSTNAME_BIN = '/usr/bin/hostname';
const DOCKER = '/usr/bin/docker';
const SYSTEMCTL = '/usr/bin/systemctl';
const BASH = '/usr/bin/bash';
const CURL = '/usr/bin/curl';
const AUDITCTL = '/usr/sbin/auditctl';

const APPROVED_PREIMAGES = Object.freeze({
  '/usr/local/sbin/imotion-db-writability-guard': Object.freeze([
    '3c4170fe5cc0014b539807ccc22288cf20f60f77a2b885a1eccc5b307d7b74a7',
    '707b55b34455c16e8c4d6b9506b6a226b2dc1e44d37dbaf90e7279616b4b75e0'
  ]),
  '/usr/local/sbin/imotion-db-readonly-window': Object.freeze([
    '7db224c36ccf503cb38a7e1ec2aeebae80ca333079bee2d4cb4fe9176ded93d2'
  ]),
  '/etc/systemd/system/imotion-db-writability-guard.service': Object.freeze([
    'f091670309ec0befcd5bef7f0b6f173e87cdd06de1b89a53e37fac6dd5040a8f'
  ]),
  '/etc/systemd/system/imotion-db-writability-guard.timer': Object.freeze([
    '3d6f446dc782e4703f634b2c91ee35628cbf4468e2d28d0bbb19f4cc94a06bf7'
  ]),
  '/etc/audit/rules.d/imotion-db-forensics.rules': Object.freeze([
    '7ec95213643a6346ce096a801f8bd8f55a3a93b206b28b01ae88c31bcea31fa0'
  ])
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fail(code) {
  throw new Error(code);
}

function loadManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  if (manifest?.schema_version !== 'prhm.imotion-db-readonly-guard-manifest.v1') {
    fail('manifest_schema_mismatch');
  }
  if (!Array.isArray(manifest.payloads) || manifest.payloads.length !== 5) {
    fail('manifest_payload_count_mismatch');
  }
  const seen = new Set();
  for (const item of manifest.payloads) {
    if (!item || typeof item !== 'object') fail('manifest_payload_invalid');
    if (typeof item.source !== 'string' || typeof item.destination !== 'string') fail('manifest_path_invalid');
    if (!SHA_RE.test(String(item.sha256 || ''))) fail('manifest_sha_invalid');
    if (!/^(0640|0644|0750)$/.test(String(item.mode || ''))) fail('manifest_mode_invalid');
    if (seen.has(item.destination)) fail('manifest_duplicate_destination');
    seen.add(item.destination);
    const expectedPreimages = APPROVED_PREIMAGES[item.destination];
    if (!expectedPreimages) fail('manifest_destination_not_approved:' + item.destination);
    const source = path.join(PACKAGE_ROOT, item.source);
    const st = fs.lstatSync(source);
    if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync(source) !== source) {
      fail('payload_source_unsafe:' + item.source);
    }
    const actual = sha256(fs.readFileSync(source));
    if (actual !== item.sha256) fail('payload_sha_mismatch:' + item.source + ':' + actual);
  }
  return manifest;
}

const TARGETS = Object.freeze(
  loadManifest().payloads.map(x => Object.freeze({
    source: x.source,
    destination: x.destination,
    mode: x.mode,
    sha256: x.sha256,
    approved_preimages: Object.freeze([...APPROVED_PREIMAGES[x.destination]])
  }))
);

function run(file, args, options = {}) {
  const result = cp.spawnSync(file, args, {
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout || 30000,
    maxBuffer: options.maxBuffer || 1024 * 1024,
    env: options.env || { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C', HOME: '/root' },
    input: options.input,
    stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe']
  });
  if (result.error) fail('exec_error:' + path.basename(file) + ':' + result.error.message);
  if (result.status !== 0 && options.allowFailure !== true) {
    fail('exec_failed:' + path.basename(file) + ':' + String(result.stderr || result.stdout || result.status).slice(-1200));
  }
  return {
    status: Number.isInteger(result.status) ? result.status : null,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  };
}

function dbq(sql) {
  const allowed = new Set([
    'SELECT @@global.read_only;',
    'SELECT @@global.server_id;',
    'SHOW SLAVE STATUS;',
    'SHOW FULL PROCESSLIST;'
  ]);
  if (!allowed.has(sql)) fail('sql_not_allowlisted');
  const script = 'exec mariadb -N -B -uroot -p"$(cat /run/secrets/db_root_password)" -e "$IMOTION_INSTALL_SQL"';
  const r = run(DOCKER, ['exec', '-e', 'IMOTION_INSTALL_SQL=' + sql, CONTAINER, 'sh', '-lc', script], { timeout: 15000 });
  return r.stdout;
}

function dbState() {
  const read_only = dbq('SELECT @@global.read_only;').replace(/\s+/g, '');
  const server_id = dbq('SELECT @@global.server_id;').replace(/\s+/g, '');
  const slave = dbq('SHOW SLAVE STATUS;').trim();
  return { read_only, server_id, slave_present: slave.length > 0 };
}

function verifyWritablePrimary() {
  const state = dbState();
  if (state.read_only !== '0') fail('db_not_writable:' + state.read_only);
  if (state.server_id !== EXPECTED_SERVER_ID) fail('db_server_id_mismatch:' + state.server_id);
  if (state.slave_present) fail('db_replica_state_detected');
  return state;
}

function verifyHostIdentity() {
  const host = run(HOSTNAME_BIN, ['-f'], { timeout: 5000 }).stdout;
  if (host !== HOSTNAME) fail('wrong_host:' + host);
  const inspect = run(DOCKER, ['inspect', '-f', '{{.State.Running}}', CONTAINER], { timeout: 10000 }).stdout;
  if (inspect !== 'true') fail('imotion_db_container_not_running');
  return host;
}

function targetState(target) {
  if (!fs.existsSync(target.destination)) {
    return { exists: false, destination: target.destination };
  }
  const st = fs.lstatSync(target.destination);
  if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync(target.destination) !== target.destination) {
    fail('target_unsafe:' + target.destination);
  }
  const bytes = fs.readFileSync(target.destination);
  const actual = sha256(bytes);
  if (!target.approved_preimages.includes(actual)) {
    fail('target_preimage_not_approved:' + target.destination + ':' + actual);
  }
  return {
    exists: true,
    destination: target.destination,
    bytes,
    sha256: actual,
    mode: st.mode & 0o777,
    uid: st.uid,
    gid: st.gid
  };
}

function fsyncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function atomicWrite(file, bytes, mode, uid = 0, gid = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  const tmp = file + '.imotion-db-guard-' + process.pid + '-' + Date.now() + '.tmp';
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, mode);
  fs.chownSync(tmp, uid, gid);
  fs.renameSync(tmp, file);
  fsyncDir(path.dirname(file));
}

function backupPreimages(states) {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + crypto.randomBytes(4).toString('hex');
  const dir = path.join(BACKUP_ROOT, stamp);
  fs.mkdirSync(dir, { mode: 0o700 });
  const manifest = [];
  for (const state of states) {
    if (!state.exists) {
      manifest.push({ destination: state.destination, existed: false });
      continue;
    }
    const file = path.join(dir, Buffer.from(state.destination).toString('hex') + '.bak');
    fs.writeFileSync(file, state.bytes, { flag: 'wx', mode: 0o600 });
    if (sha256(fs.readFileSync(file)) !== state.sha256) fail('backup_sha_mismatch:' + state.destination);
    manifest.push({ destination: state.destination, existed: true, backup: file, sha256: state.sha256, mode: state.mode, uid: state.uid, gid: state.gid });
  }
  const mf = path.join(dir, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify({ schema_version: 'prhm.imotion-db-guard-backup.v1', files: manifest }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { dir, files: manifest };
}

function timerState() {
  const enabled = run(SYSTEMCTL, ['is-enabled', TIMER], { allowFailure: true, timeout: 10000 }).stdout;
  const active = run(SYSTEMCTL, ['is-active', TIMER], { allowFailure: true, timeout: 10000 }).stdout;
  return { enabled, active };
}

function auditRules() {
  if (!fs.existsSync(AUDITCTL)) return { available: false, text: '' };
  const out = run(AUDITCTL, ['-l'], { allowFailure: true, timeout: 10000 });
  return { available: out.status === 0, text: out.stdout };
}

const AUDIT_B64 = ['always,exit', '-F', 'arch=b64', '-S', 'execve', '-F', 'exe=/usr/bin/docker', '-F', 'auid=0', '-k', AUDIT_KEY];
const AUDIT_B32 = ['always,exit', '-F', 'arch=b32', '-S', 'execve', '-F', 'exe=/usr/bin/docker', '-F', 'auid=0', '-k', AUDIT_KEY];

function ensureAuditRules() {
  if (!fs.existsSync(AUDITCTL)) fail('auditctl_missing');
  let before = auditRules().text;
  const added = [];
  if (!before.includes('arch=b64') || !before.includes('key=' + AUDIT_KEY)) {
    run(AUDITCTL, ['-a', ...AUDIT_B64], { timeout: 10000 });
    added.push('b64');
    before = auditRules().text;
  }
  if (!before.includes('arch=b32') || !before.includes('key=' + AUDIT_KEY)) {
    run(AUDITCTL, ['-a', ...AUDIT_B32], { timeout: 10000 });
    added.push('b32');
  }
  const after = auditRules().text;
  if (!after.includes(AUDIT_KEY)) fail('audit_rule_verify_failed');
  return added;
}

function removeAddedAuditRules(added) {
  if (!fs.existsSync(AUDITCTL)) return;
  if (added.includes('b64')) run(AUDITCTL, ['-d', ...AUDIT_B64], { allowFailure: true, timeout: 10000 });
  if (added.includes('b32')) run(AUDITCTL, ['-d', ...AUDIT_B32], { allowFailure: true, timeout: 10000 });
}

function verifyInstalled() {
  const result = {};
  for (const target of TARGETS) {
    const st = fs.lstatSync(target.destination);
    if (!st.isFile() || st.isSymbolicLink()) fail('installed_target_unsafe:' + target.destination);
    const actual = sha256(fs.readFileSync(target.destination));
    if (actual !== target.sha256) fail('installed_sha_mismatch:' + target.destination + ':' + actual);
    result[target.destination] = actual;
  }
  run(BASH, ['-n', '/usr/local/sbin/imotion-db-writability-guard'], { timeout: 10000 });
  run(BASH, ['-n', '/usr/local/sbin/imotion-db-readonly-window'], { timeout: 10000 });
  return result;
}

function verifyTimer() {
  const state = timerState();
  if (state.enabled !== 'enabled') fail('timer_not_enabled:' + state.enabled);
  if (state.active !== 'active') fail('timer_not_active:' + state.active);
  return state;
}

function verifyHttp() {
  const r = run(CURL, ['-k', '-sS', '--max-time', '10', '-o', '/dev/null', '-w', '%{http_code}', ADMIN_URL], { timeout: 15000 });
  const status = Number(r.stdout);
  if (!Number.isInteger(status) || status < 200 || status >= 500) fail('admin_http_5xx_or_invalid:' + r.stdout);
  return status;
}

function restoreTimer(prior) {
  if (prior.enabled === 'enabled') run(SYSTEMCTL, ['enable', TIMER], { allowFailure: true });
  else run(SYSTEMCTL, ['disable', TIMER], { allowFailure: true });
  if (prior.active === 'active') run(SYSTEMCTL, ['start', TIMER], { allowFailure: true });
  else run(SYSTEMCTL, ['stop', TIMER], { allowFailure: true });
}

function rollback(backup, priorTimer, addedAudit) {
  const errors = [];
  try { removeAddedAuditRules(addedAudit); } catch (e) { errors.push('audit:' + e.message); }
  for (const item of [...backup.files].reverse()) {
    try {
      if (!item.existed) {
        if (fs.existsSync(item.destination)) fs.unlinkSync(item.destination);
      } else {
        const bytes = fs.readFileSync(item.backup);
        if (sha256(bytes) !== item.sha256) fail('rollback_backup_corrupt:' + item.destination);
        atomicWrite(item.destination, bytes, item.mode, item.uid, item.gid);
      }
    } catch (e) {
      errors.push(item.destination + ':' + e.message);
    }
  }
  try { run(SYSTEMCTL, ['daemon-reload']); } catch (e) { errors.push('daemon-reload:' + e.message); }
  try { restoreTimer(priorTimer); } catch (e) { errors.push('timer:' + e.message); }
  for (const item of backup.files) {
    try {
      if (!item.existed) {
        if (fs.existsSync(item.destination)) fail('rollback_created_target_still_exists:' + item.destination);
      } else if (sha256(fs.readFileSync(item.destination)) !== item.sha256) {
        fail('rollback_sha_mismatch:' + item.destination);
      }
    } catch (e) { errors.push('verify:' + e.message); }
  }
  if (errors.length) fail('rollback_incomplete:' + errors.join('|'));
  return true;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  atomicWrite(file, bytes, 0o600, 0, 0);
}

function execute() {
  const started_at = new Date().toISOString();
  verifyHostIdentity();
  const beforeDb = verifyWritablePrimary();
  const priorTimer = timerState();
  const states = TARGETS.map(targetState);
  const backup = backupPreimages(states);
  let mutated = false;
  let addedAudit = [];
  try {
    for (const target of TARGETS) {
      const bytes = fs.readFileSync(path.join(PACKAGE_ROOT, target.source));
      const existing = states.find(x => x.destination === target.destination);
      atomicWrite(target.destination, bytes, Number.parseInt(target.mode, 8), existing?.exists ? existing.uid : 0, existing?.exists ? existing.gid : 0);
      mutated = true;
    }
    verifyInstalled();
    run(SYSTEMCTL, ['daemon-reload']);
    run(SYSTEMCTL, ['enable', '--now', TIMER]);
    addedAudit = ensureAuditRules();
    run(SYSTEMCTL, ['start', SERVICE]);
    const installed = verifyInstalled();
    const timer = verifyTimer();
    const afterDb = verifyWritablePrimary();
    const http_status = verifyHttp();
    if (fs.existsSync('/run/imotion-db-readonly-authorized')) fail('unexpected_active_maintenance_lease');
    const result = {
      ok: true,
      schema_version: 'prhm.host-action-result.v1',
      action: ACTION,
      started_at,
      finished_at: new Date().toISOString(),
      installed: true,
      hostname: HOSTNAME,
      container: CONTAINER,
      before_db: beforeDb,
      after_db: afterDb,
      timer,
      http_status,
      installed_sha256: installed,
      backup_dir: backup.dir,
      audit_rules_added: addedAudit,
      production_application_mutation: false,
      database_state_mutation: false,
      database_restart: false,
      docker_restart: false,
      rollback_performed: false
    };
    atomicJson(RESULT_FILE, result);
    return result;
  } catch (error) {
    let rollbackError = null;
    if (mutated) {
      try { rollback(backup, priorTimer, addedAudit); }
      catch (rb) { rollbackError = String(rb?.message || rb); }
    }
    const failure = {
      ok: false,
      schema_version: 'prhm.host-action-result.v1',
      action: ACTION,
      started_at,
      finished_at: new Date().toISOString(),
      error: String(error?.message || error).slice(0, 1200),
      backup_dir: backup.dir,
      rollback_performed: mutated && rollbackError === null,
      rollback_error: rollbackError,
      database_restart: false,
      docker_restart: false
    };
    try { atomicJson(RESULT_FILE, failure); } catch {}
    if (rollbackError) fail('install_failed_and_rollback_failed:' + failure.error + ':' + rollbackError);
    fail('install_failed_rolled_back:' + failure.error);
  }
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(execute()) + '\n');
  } catch (error) {
    process.stderr.write(String(error?.stack || error) + '\n');
    process.exitCode = 1;
  }
}

module.exports = {
  ACTION,
  HOSTNAME,
  CONTAINER,
  EXPECTED_SERVER_ID,
  ARBITRARY_COMMAND_INPUT,
  ARBITRARY_SQL_INPUT,
  TARGETS,
  APPROVED_PREIMAGES,
  sha256,
  loadManifest,
  execute
};
