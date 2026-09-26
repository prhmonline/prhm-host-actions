'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ACTION = 'rahekomak_registry_launch_pack_v1';
const PROJECT_ROOT = '/home/prhm/projects/generated/rahekomak';
const EXPECTED_HEAD = 'b20423da27be6a5765d1946d9c236d41cb191ada';
const PHP = '/usr/bin/php';
const SERVICE_FILE = 'apps/api/app/Services/Registry/RegistryLaunchPack.php';
const COMMAND_FILE = 'apps/api/app/Console/Commands/RegistryLaunchPackCommand.php';
const SERVICE_SHA256 = '26731c9d85c5c5285ff427992365de2bbdd8ecee3992c02c91f3ca094417ab31';
const COMMAND_SHA256 = '17878f9a45fa3a8bdc302ab4871531cf73c20e017bc06e4d4b956deeca654da1';
const APPLY_ARGV = Object.freeze(['apps/api/artisan', 'rahekomak:registry-launch-pack-v1']);
const PREFLIGHT_ARGV = Object.freeze([...APPLY_ARGV, '--preflight-only']);
const LOCK_PATH = '/run/lock/prhm-rahekomak-registry-launch-pack-v1.lock';
const RESULT_PATH = '/var/lib/prhm-agent-selfmaint-exec/rahekomak-registry-launch-pack-v1/latest.json';
const RESULT_FIELDS = Object.freeze([
  'ok','action','created','already_present','conflicts','resource_slugs','published_count','direct_verified_count'
]);
const PREFLIGHT_FIELDS = Object.freeze([
  'ok','action','conflicts','resource_slugs','existing_count','absent_count'
]);
const EXPECTED_SLUGS = Object.freeze([
  'police-emergency-110',
  'medical-emergency-115',
  'social-emergency-123',
  'behzisti-counselling-1480',
  'addiction-counselling-09628',
  'judiciary-legal-counselling-129'
]);

const fail = message => { throw new Error(message); };
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function assertNoArguments(args) {
  if (!Array.isArray(args) || args.length !== 0) fail('unexpected_arguments');
  return true;
}

function contract() {
  return Object.freeze({
    schema_version: 'prhm.rahekomak-registry-launch-pack.contract.v1',
    action: ACTION,
    project_root: PROJECT_ROOT,
    expected_head: EXPECTED_HEAD,
    service_sha256: SERVICE_SHA256,
    command_sha256: COMMAND_SHA256,
    apply_argv: [...APPLY_ARGV],
    preflight_argv: [...PREFLIGHT_ARGV],
    lock_path: LOCK_PATH,
    exclusive_lock: true,
    database_mutation: true,
    publication_mutation: false,
    direct_verification_mutation: false,
    dns_mutation: false,
    tls_mutation: false,
    deploy_mutation: false,
    arbitrary_command: false,
    arbitrary_path: false,
    arbitrary_sql: false,
    arbitrary_resource: false,
    credential_input: false,
    writable_paths: [
      '/home/prhm/projects/generated/rahekomak/apps/api/storage',
      '/run/lock'
    ]
  });
}

function run(bin, args, { cwd = PROJECT_ROOT, timeout = 120000, maxBuffer = 131072 } = {}) {
  const r = cp.spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer,
    shell: false,
    env: {
      ...process.env,
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      LC_ALL: 'C.UTF-8'
    }
  });
  if (r.error) fail('exec_error:' + path.basename(bin) + ':' + r.error.message);
  if (r.status !== 0) fail('exec_failed:' + path.basename(bin) + ':' + String(r.stderr || r.stdout || r.status).slice(0, 1800));
  return String(r.stdout || '').trim();
}

function git(args) {
  return run('/usr/bin/git', ['-c', 'safe.directory=' + PROJECT_ROOT, '-C', PROJECT_ROOT, ...args], { timeout: 30000 });
}

function fileSha(rel) {
  const file = path.join(PROJECT_ROOT, rel);
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync(file) !== file) fail('bound_file_invalid:' + rel);
  return sha256(fs.readFileSync(file));
}

function verifyProjectBinding() {
  const st = fs.lstatSync(PROJECT_ROOT);
  if (!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(PROJECT_ROOT) !== PROJECT_ROOT) fail('project_root_invalid');
  if (git(['symbolic-ref', '--short', 'HEAD']) !== 'main') fail('branch_mismatch');
  if (git(['rev-parse', 'HEAD']) !== EXPECTED_HEAD) fail('head_mismatch');
  if (git(['status', '--porcelain=v1', '--untracked-files=all']) !== '') fail('worktree_dirty');
  if (fileSha(SERVICE_FILE) !== SERVICE_SHA256) fail('service_sha_mismatch');
  if (fileSha(COMMAND_FILE) !== COMMAND_SHA256) fail('command_sha_mismatch');
  return true;
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true, mode: 0o755 });
  let fd;
  try {
    fd = fs.openSync(LOCK_PATH, 'wx', 0o600);
    fs.writeFileSync(fd, String(process.pid) + '\n');
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    if (error && error.code === 'EEXIST') fail('exclusive_lock_busy');
    throw error;
  }
  fs.closeSync(fd);
  return () => { try { fs.unlinkSync(LOCK_PATH); } catch {} };
}

function parseAndValidateResult(raw, { preflightOnly = false } = {}) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 65536) fail('result_size_invalid');
  let result;
  try { result = JSON.parse(raw); } catch { fail('result_json_invalid'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('result_shape_invalid');
  const fields = preflightOnly ? PREFLIGHT_FIELDS : RESULT_FIELDS;
  const actualKeys = Object.keys(result).sort();
  const expectedKeys = [...fields].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) fail('result_keyset_invalid');
  if (result.ok !== true || result.action !== ACTION) fail('result_identity_invalid');
  if (!Array.isArray(result.conflicts) || !Array.isArray(result.resource_slugs)) fail('result_array_invalid');
  if (result.conflicts.length !== 0) fail('conflicts_nonzero');
  if (JSON.stringify(result.resource_slugs) !== JSON.stringify(EXPECTED_SLUGS)) fail('resource_slugs_mismatch');

  if (preflightOnly) {
    for (const key of ['existing_count','absent_count']) {
      if (!Number.isInteger(result[key]) || result[key] < 0) fail('result_count_invalid:' + key);
    }
    if (result.existing_count + result.absent_count !== 6) fail('preflight_resource_count_mismatch');
    return Object.fromEntries(PREFLIGHT_FIELDS.map(key => [key, result[key]]));
  }

  for (const key of ['created','already_present','published_count','direct_verified_count']) {
    if (!Number.isInteger(result[key]) || result[key] < 0) fail('result_count_invalid:' + key);
  }
  if (result.published_count !== 0) fail('published_count_nonzero');
  if (result.direct_verified_count !== 0) fail('direct_verified_count_nonzero');
  if (result.created + result.already_present !== 6) fail('resource_count_mismatch');
  return Object.fromEntries(RESULT_FIELDS.map(key => [key, result[key]]));
}

function persistResult(result) {
  fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true, mode: 0o700 });
  const tmp = RESULT_PATH + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, RESULT_PATH);
}

function preflight() {
  verifyProjectBinding();
  const release = acquireLock();
  try {
    const raw = run(PHP, [...PREFLIGHT_ARGV], { timeout: 120000, maxBuffer: 131072 });
    return parseAndValidateResult(raw, { preflightOnly: true });
  } finally { release(); }
}

function apply() {
  assertNoArguments(process.argv.slice(2));
  verifyProjectBinding();
  const release = acquireLock();
  try {
    const raw = run(PHP, [...APPLY_ARGV], { timeout: 180000, maxBuffer: 131072 });
    const result = parseAndValidateResult(raw, { preflightOnly: false });
    persistResult(result);
    return result;
  } finally { release(); }
}

module.exports = {
  ACTION, PROJECT_ROOT, EXPECTED_HEAD, PHP, SERVICE_FILE, COMMAND_FILE,
  SERVICE_SHA256, COMMAND_SHA256, APPLY_ARGV, PREFLIGHT_ARGV, LOCK_PATH,
  RESULT_PATH, RESULT_FIELDS, PREFLIGHT_FIELDS, EXPECTED_SLUGS, assertNoArguments, contract,
  verifyProjectBinding, acquireLock, parseAndValidateResult, preflight, apply
};

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(apply()) + '\n'); }
  catch (error) { process.stderr.write(String(error?.stack || error) + '\n'); process.exit(1); }
}
