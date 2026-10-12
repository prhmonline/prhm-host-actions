#!/usr/local/bin/prhm-node
'use strict';
// Candidate mirrored byte-for-byte from the SHA-pinned canonical on-server helper
// (source SHA256 d61140507300b4e2fc6650f2fc5e4b769543d9937dd2ff58574827af9c40696f,
// local application HEAD 13917a36df76c0dfdd75f4a84111ba68391f166e) except for
// the single deterministic API categories smoke replacement below.
// This is a Git-only source candidate and is NOT installed in Production.


const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');

const ACTION = 'rahekomak_production_deploy_v1';
const SCHEMA = 'prhm.rahekomak-production-deploy-result.v1';
const ROOT = '/home/prhm/projects/generated/rahekomak';
const API = path.join(ROOT, 'apps/api');
const WEB = path.join(ROOT, 'apps/web');
const ADMIN = path.join(ROOT, 'apps/admin');
const INFRA = path.join(ROOT, 'infra/docker');
const COMPOSE = path.join(INFRA, 'compose.infrastructure.yml');
const HTTPD_SOURCE = path.join(INFRA, 'rahekomak-httpd.conf');
const HTTPD_TARGET = '/etc/httpd/conf.d/rahekomak.conf';
const ENV_FILE = path.join(API, '.env');
const SECRET_DIR = path.join(INFRA, 'secrets');
const PG_SECRET = path.join(SECRET_DIR, 'postgres_password');
const ADMIN_SECRET = path.join(SECRET_DIR, 'admin_key');
const APP_KEY_SECRET = path.join(SECRET_DIR, 'app_key');
const BACKUP_ROOT = path.join(INFRA, 'runtime/deploy-backups');
const LOCK = '/run/prhm-rahekomak-production-deploy-v1.lock';
const RESULT = process.env.RAHEKOMAK_DEPLOY_RESULT || '';
const EXPECTED_HEAD = process.env.RAHEKOMAK_EXPECTED_HEAD || '';
const CONTAINERS = ['rahekomak-postgres', 'rahekomak-redis'];
const SELINUX_RULES = [
  [ROOT + '(/.*)?', 'httpd_sys_content_t'],
  [path.join(API, 'storage') + '(/.*)?', 'httpd_sys_rw_content_t'],
  [path.join(API, 'bootstrap/cache') + '(/.*)?', 'httpd_sys_rw_content_t'],
];
const APACHE_TRAVERSE_PATHS = [
  '/home/prhm',
  '/home/prhm/projects',
  '/home/prhm/projects/generated',
  ROOT,
  path.join(ROOT, 'apps'),
  WEB,
  ADMIN,
  API,
];
const APACHE_READ_TREES = [
  path.join(WEB, 'out'),
  path.join(ADMIN, 'out'),
  path.join(API, 'public'),
];
const PHP_FPM_TRAVERSE_PATHS = [
  '/home/prhm',
  '/home/prhm/projects',
  '/home/prhm/projects/generated',
  ROOT,
  path.join(ROOT, 'apps'),
  API,
];

function fail(code) { throw new Error(code); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function nowTag() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function run(bin, args, opts = {}) {
  const r = cp.spawnSync(bin, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 600000,
    maxBuffer: opts.maxBuffer || 8 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}), PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error || (!opts.allowNonzero && r.status !== 0)) {
    fail('command_failed:' + path.basename(bin) + ':' + String(r.status) + ':' + String(r.stderr || r.stdout || '').slice(-2400));
  }
  return { status: r.status, stdout: String(r.stdout || '').trim(), stderr: String(r.stderr || '').trim() };
}
function runRetry(bin, args, opts = {}, attempts = 3) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return run(bin, args, opts); }
    catch (error) {
      last = error;
      if (attempt < attempts) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
    }
  }
  throw last;
}
function atomicWrite(file, bytes, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, bytes, { mode, flag: 'wx' });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}
function readOrCreateSecret(file, generator) {
  if (fs.existsSync(file)) {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) fail('secret_path_invalid:' + path.basename(file));
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!value) fail('secret_empty:' + path.basename(file));
    return { value, created: false };
  }
  const value = generator();
  atomicWrite(file, Buffer.from(value + '\n'), 0o600);
  return { value, created: true };
}
function appKeyValue() {
  return 'base64:' + crypto.randomBytes(32).toString('base64');
}
function exactHead() {
  return run('/usr/bin/git', ['rev-parse', 'HEAD']).stdout;
}
function ensureGitBound() {
  if (!/^[a-f0-9]{40}$/.test(EXPECTED_HEAD)) fail('expected_head_missing_or_invalid');
  const head = exactHead();
  if (head !== EXPECTED_HEAD) fail('git_head_mismatch');
  const dirty = run('/usr/bin/git', ['status', '--porcelain']).stdout;
  if (dirty) fail('git_worktree_not_clean');
  return head;
}
function containerExists(name) {
  return run('/usr/bin/docker', ['inspect', name], { allowNonzero: true, timeout: 30000 }).status === 0;
}
function waitHealthy(name) {
  for (let i = 0; i < 50; i++) {
    const r = run('/usr/bin/docker', ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', name], { allowNonzero: true, timeout: 30000 });
    if (r.status === 0 && (r.stdout === 'healthy' || r.stdout === 'running')) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  fail('container_not_healthy:' + name);
}
function psql(password, sql, allowNonzero = false) {
  return run('/usr/bin/psql', ['-h', '127.0.0.1', '-p', '55436', '-U', 'rahekomak_app', '-d', 'rahekomak', '-tAc', sql], {
    allowNonzero,
    timeout: 30000,
    env: { PGPASSWORD: password },
  });
}
function migrationBatch(password) {
  const sql = "SELECT CASE WHEN to_regclass('public.migrations') IS NULL THEN 0 ELSE COALESCE((SELECT max(batch) FROM migrations),0) END";
  const r = psql(password, sql, true);
  if (r.status !== 0) return 0;
  const n = Number(r.stdout.trim() || '0');
  return Number.isFinite(n) ? n : 0;
}
function httpProbe(host, pathname = '/') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 80,
      method: 'GET',
      path: pathname,
      headers: { Host: host, Accept: 'text/html,application/json' },
      timeout: 5000,
    }, res => {
      let size = 0;
      const chunks = [];
      res.on('data', d => {
        size += d.length;
        if (size <= 1024 * 1024) chunks.push(d);
      });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('probe_timeout')));
    req.on('error', reject);
    req.end();
  });
}
async function smoke() {
  const web = await httpProbe('rahekomak.ir', '/');
  if (web.status !== 200 || !web.body.includes('راه کمک')) fail('public_smoke_failed:' + web.status + ':' + web.body.slice(0, 240).replace(/\s+/g, ' '));
  const admin = await httpProbe('admin.rahekomak.ir', '/');
  if (admin.status !== 200 || !admin.body.includes('مدیریت راه کمک')) fail('admin_smoke_failed:' + admin.status + ':' + admin.body.slice(0, 240).replace(/\s+/g, ' '));
  const api = await httpProbe('api.rahekomak.ir', '/v1/categories');
  if (api.status !== 200) fail('api_smoke_status:' + api.status);
  let data;
  try { data = JSON.parse(api.body); } catch { fail('api_smoke_json'); }
  // Check required public API slugs rather than the obsolete 8-item snapshot.
  // New additive categories are safe, but duplicates or missing critical routes are not.
  const required = ['emergency','mental-health','violence','addiction','medical',
    'social-support','legal','child-youth','medicine-poisoning','hiv-sexual-health'];
  if (!Array.isArray(data?.data)) fail('api_smoke_categories_shape');
  const slugs = data.data.map(row => row && row.slug);
  if (slugs.some(slug => typeof slug !== 'string' || !slug) ||
      new Set(slugs).size !== slugs.length ||
      required.some(slug => !slugs.includes(slug))) fail('api_smoke_categories');
  return { public: web.status, admin: admin.status, api: api.status, categories: data.data.length };
}
function selinuxLocalRules() {
  if (!fs.existsSync('/usr/sbin/semanage') || !fs.existsSync('/usr/sbin/restorecon')) return null;
  return run('/usr/sbin/semanage', ['fcontext', '-l', '-C'], { allowNonzero: true, timeout: 30000 }).stdout;
}
function configureSelinux() {
  const current = selinuxLocalRules();
  if (current === null) return { supported: false, added: [] };
  const added = [];
  for (const [expr, type] of SELINUX_RULES) {
    if (!current.includes(expr)) {
      run('/usr/sbin/semanage', ['fcontext', '-a', '-t', type, expr], { timeout: 30000 });
      added.push(expr);
    }
  }
  run('/usr/sbin/restorecon', ['-RF', ROOT], { timeout: 120000 });
  return { supported: true, added };
}
function rollbackSelinux(state) {
  if (!state?.supported || !state.added?.length) return;
  for (const expr of [...state.added].reverse()) {
    run('/usr/sbin/semanage', ['fcontext', '-d', expr], { allowNonzero: true, timeout: 30000 });
  }
  run('/usr/sbin/restorecon', ['-RF', ROOT], { allowNonzero: true, timeout: 120000 });
}
function aclTreeEntries(root) {
  const dirs = [], files = [], stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink()) fail('apache_acl_symlink_rejected:' + current);
    if (st.isDirectory()) {
      dirs.push(current);
      for (const name of fs.readdirSync(current)) stack.push(path.join(current, name));
    } else if (st.isFile()) {
      files.push(current);
    } else {
      fail('apache_acl_special_file_rejected:' + current);
    }
  }
  return { dirs, files };
}
function setAclBatch(user, perms, paths) {
  for (let i = 0; i < paths.length; i += 100) {
    run('/usr/bin/setfacl', ['-m', 'u:' + user + ':' + perms, ...paths.slice(i, i + 100)], { timeout: 120000 });
  }
}
function configureApacheAcl(backupDir) {
  for (const p of [...APACHE_TRAVERSE_PATHS, ...APACHE_READ_TREES, ...PHP_FPM_TRAVERSE_PATHS]) {
    const st = fs.lstatSync(p);
    if (!st.isDirectory() || st.isSymbolicLink()) fail('apache_acl_path_invalid:' + p);
  }
  const backup = path.join(backupDir, 'apache-acl.before');
  const parentSnapshotPaths = [...new Set([...APACHE_TRAVERSE_PATHS, ...PHP_FPM_TRAVERSE_PATHS])].filter(p => p !== API);
  let snapshot = run('/usr/bin/getfacl', ['-p', ...parentSnapshotPaths], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }).stdout + '\n';
  for (const tree of [path.join(WEB, 'out'), path.join(ADMIN, 'out')]) {
    snapshot += run('/usr/bin/getfacl', ['-R', '-p', tree], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }).stdout + '\n';
  }
  snapshot += run('/usr/bin/getfacl', ['-R', '-p', API], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }).stdout + '\n';
  atomicWrite(backup, Buffer.from(snapshot), 0o600);
  try {
    setAclBatch('apache', '--x', APACHE_TRAVERSE_PATHS);
    for (const tree of APACHE_READ_TREES) {
      const entries = aclTreeEntries(tree);
      setAclBatch('apache', 'r-x', entries.dirs);
      setAclBatch('apache', 'r--', entries.files);
    }
    setAclBatch('prhm', '--x', PHP_FPM_TRAVERSE_PATHS);
    const apiEntries = aclTreeEntries(API);
    setAclBatch('prhm', 'r-x', apiEntries.dirs);
    setAclBatch('prhm', 'r--', apiEntries.files);
    return { backup };
  } catch (error) {
    run('/usr/bin/setfacl', ['--restore=' + backup], { allowNonzero: true, timeout: 180000 });
    fail('apache_acl_configure_failed_rolled_back:' + String(error?.message || error));
  }
}
function rollbackApacheAcl(state) {
  if (!state?.backup || !fs.existsSync(state.backup)) return;
  run('/usr/bin/setfacl', ['--restore=' + state.backup], { timeout: 180000 });
}
function buildEnv(pgPassword, adminKey, appKey) {
  return [
    'APP_NAME=RahKomak',
    'APP_ENV=production',
    'APP_KEY=' + appKey,
    'APP_DEBUG=false',
    'APP_URL=https://api.rahekomak.ir',
    'LOG_CHANNEL=stack',
    'LOG_LEVEL=warning',
    'DB_CONNECTION=pgsql',
    'DB_HOST=127.0.0.1',
    'DB_PORT=55436',
    'DB_DATABASE=rahekomak',
    'DB_USERNAME=rahekomak_app',
    'DB_PASSWORD=' + pgPassword,
    'CACHE_STORE=redis',
    'SESSION_DRIVER=redis',
    'QUEUE_CONNECTION=redis',
    'REDIS_CLIENT=phpredis',
    'REDIS_HOST=127.0.0.1',
    'REDIS_PORT=56382',
    'RAHEKOMAK_ADMIN_KEY=' + adminKey,
    '',
  ].join('\n');
}
function preflight() {
  const head = ensureGitBound();
  for (const p of [COMPOSE, HTTPD_SOURCE, path.join(API, 'artisan'), path.join(WEB, 'package.json'), path.join(ADMIN, 'package.json')]) {
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.isSymbolicLink()) fail('required_file_invalid:' + p);
  }
  run('/usr/bin/docker', ['compose', '-f', COMPOSE, 'config'], { timeout: 60000 });
  run('/usr/bin/php', ['artisan', '--version'], { cwd: API, timeout: 30000 });
  run('/usr/sbin/httpd', ['-t'], { timeout: 30000 });
  return {
    ok: true,
    action: ACTION,
    schema_version: SCHEMA,
    preflight_only: true,
    expected_head: head,
    public_port: 80,
    postgres_port: 55436,
    redis_port: 56382,
    php_fpm_socket: '/run/php-fpm/prhm.sock',
    rollback_available: true,
    arbitrary_command: false,
    arbitrary_path: false,
  };
}
async function apply() {
  const head = ensureGitBound();
  const backupDir = path.join(BACKUP_ROOT, nowTag());
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const before = {
    httpdExists: fs.existsSync(HTTPD_TARGET),
    httpdBytes: fs.existsSync(HTTPD_TARGET) ? fs.readFileSync(HTTPD_TARGET) : null,
    envExists: fs.existsSync(ENV_FILE),
    envBytes: fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE) : null,
    configCacheExists: fs.existsSync(path.join(API, 'bootstrap/cache/config.php')),
    configCacheBytes: fs.existsSync(path.join(API, 'bootstrap/cache/config.php')) ? fs.readFileSync(path.join(API, 'bootstrap/cache/config.php')) : null,
    configCacheStat: fs.existsSync(path.join(API, 'bootstrap/cache/config.php')) ? fs.statSync(path.join(API, 'bootstrap/cache/config.php')) : null,
    containers: Object.fromEntries(CONTAINERS.map(n => [n, containerExists(n)])),
  };

  let pg = null, admin = null, appKey = null, preBatch = 0, postBatch = 0, selinux = null, apacheAcl = null, httpdInstalled = false;
  try {
    run('/usr/bin/npm', ['--prefix', WEB, 'run', 'typecheck'], { timeout: 300000 });
    run('/usr/bin/npm', ['--prefix', WEB, 'run', 'lint'], { timeout: 300000 });
    runRetry('/usr/bin/npm', ['--prefix', WEB, 'run', 'build'], { timeout: 600000 }, 3);
    run('/usr/bin/npm', ['--prefix', ADMIN, 'run', 'typecheck'], { timeout: 300000 });
    run('/usr/bin/npm', ['--prefix', ADMIN, 'run', 'lint'], { timeout: 300000 });
    runRetry('/usr/bin/npm', ['--prefix', ADMIN, 'run', 'build'], { timeout: 600000 }, 3);
    run('/usr/bin/php', ['vendor/bin/pint', '--test'], { cwd: API, timeout: 300000 });
    run('/usr/bin/php', ['artisan', 'config:clear'], { cwd: API, timeout: 60000 });
    run('/usr/bin/php', ['artisan', 'test'], { cwd: API, timeout: 600000 });

    fs.mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
    pg = readOrCreateSecret(PG_SECRET, () => crypto.randomBytes(32).toString('hex'));
    admin = readOrCreateSecret(ADMIN_SECRET, () => crypto.randomBytes(32).toString('hex'));
    appKey = readOrCreateSecret(APP_KEY_SECRET, appKeyValue);

    atomicWrite(ENV_FILE, Buffer.from(buildEnv(pg.value, admin.value, appKey.value)), 0o640);
    const prhm = fs.statSync('/home/prhm');
    fs.chownSync(ENV_FILE, 0, prhm.gid);

    run('/usr/bin/docker', ['compose', '-f', COMPOSE, 'up', '-d'], { timeout: 600000 });
    for (const name of CONTAINERS) waitHealthy(name);

    preBatch = migrationBatch(pg.value);
    run('/usr/bin/php', ['artisan', 'migrate', '--force'], { cwd: API, timeout: 300000 });
    postBatch = migrationBatch(pg.value);
    run('/usr/bin/php', ['artisan', 'db:seed', '--class=Database\\Seeders\\ReferenceDataSeeder', '--force'], { cwd: API, timeout: 300000 });
    run('/usr/bin/php', ['artisan', 'optimize'], { cwd: API, timeout: 300000 });

    run('/usr/bin/chown', ['-R', String(prhm.uid) + ':' + String(prhm.gid), path.join(API, 'storage'), path.join(API, 'bootstrap/cache')], { timeout: 120000 });
    selinux = configureSelinux();
    apacheAcl = configureApacheAcl(backupDir);

    atomicWrite(HTTPD_TARGET, fs.readFileSync(HTTPD_SOURCE), 0o644);
    httpdInstalled = true;
    run('/usr/sbin/httpd', ['-t'], { timeout: 30000 });
    run('/usr/bin/systemctl', ['reload', 'httpd'], { timeout: 60000 });

    const smokeResult = await smoke();
    const result = {
      ok: true,
      action: ACTION,
      schema_version: SCHEMA,
      deployed_head: head,
      builds: { web: true, admin: true, api_tests: true, pint: true },
      infrastructure: { postgres: true, redis: true, apache: true, apache_acl: true, selinux_supported: selinux.supported },
      migration: { before_batch: preBatch, after_batch: postBatch },
      seed: { reference_only: true, real_crisis_resources_seeded: false },
      local_smoke: smokeResult,
      admin_key_fingerprint: sha256(Buffer.from(admin.value)).slice(0, 12),
      rollback_performed: false,
      rollback_failed: false,
      public_dns_mutation: false,
      edge_tls_mutation: false,
    };
    if (RESULT) atomicWrite(RESULT, Buffer.from(JSON.stringify(result, null, 2) + '\n'), 0o600);
    return result;
  } catch (error) {
    const rollbackErrors = [];
    try {
      if (postBatch > preBatch && fs.existsSync(ENV_FILE)) {
        run('/usr/bin/php', ['artisan', 'migrate:rollback', '--force', '--batch=' + String(postBatch)], { cwd: API, timeout: 300000, allowNonzero: true });
      }
    } catch (e) { rollbackErrors.push('migration:' + e.message); }
    try {
      if (before.httpdExists) atomicWrite(HTTPD_TARGET, before.httpdBytes, 0o644);
      else if (httpdInstalled && fs.existsSync(HTTPD_TARGET)) fs.unlinkSync(HTTPD_TARGET);
      run('/usr/sbin/httpd', ['-t'], { allowNonzero: true, timeout: 30000 });
      run('/usr/bin/systemctl', ['reload', 'httpd'], { allowNonzero: true, timeout: 60000 });
    } catch (e) { rollbackErrors.push('httpd:' + e.message); }
    try { rollbackApacheAcl(apacheAcl); } catch (e) { rollbackErrors.push('apache_acl:' + e.message); }
    try { rollbackSelinux(selinux); } catch (e) { rollbackErrors.push('selinux:' + e.message); }
    try {
      if (before.envExists) atomicWrite(ENV_FILE, before.envBytes, 0o640);
      else if (fs.existsSync(ENV_FILE)) fs.unlinkSync(ENV_FILE);
    } catch (e) { rollbackErrors.push('env:' + e.message); }
    try {
      const configCache = path.join(API, 'bootstrap/cache/config.php');
      if (before.configCacheExists) {
        atomicWrite(configCache, before.configCacheBytes, before.configCacheStat.mode & 0o777);
        fs.chownSync(configCache, before.configCacheStat.uid, before.configCacheStat.gid);
      } else if (fs.existsSync(configCache)) {
        fs.unlinkSync(configCache);
      }
    } catch (e) { rollbackErrors.push('config_cache:' + e.message); }
    try {
      if (CONTAINERS.every(n => before.containers[n] === false)) {
        run('/usr/bin/docker', ['compose', '-f', COMPOSE, 'down'], { allowNonzero: true, timeout: 180000 });
      }
    } catch (e) { rollbackErrors.push('containers:' + e.message); }

    const result = {
      ok: false,
      action: ACTION,
      schema_version: SCHEMA,
      error: String(error?.message || error).slice(0, 3000),
      rollback_performed: true,
      rollback_failed: rollbackErrors.length > 0,
      rollback_errors: rollbackErrors,
      secrets_preserved_for_safe_retry: true,
      public_dns_mutation: false,
      edge_tls_mutation: false,
    };
    if (RESULT) {
      try { atomicWrite(RESULT, Buffer.from(JSON.stringify(result, null, 2) + '\n'), 0o600); } catch {}
    }
    if (rollbackErrors.length) fail('deploy_failed_and_rollback_incomplete:' + rollbackErrors.join('|'));
    fail('deploy_failed_rolled_back:' + String(error?.message || error));
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--contract', '--preflight', '--apply'].includes(args[0])) fail('unexpected_arguments');
  if (args[0] === '--contract') {
    return {
      ok: true,
      action: ACTION,
      schema_version: SCHEMA,
      modes: ['--contract', '--preflight', '--apply'],
      fixed_root: ROOT,
      expected_head_required: true,
      rollback_available: true,
      public_dns_mutation: false,
      edge_tls_mutation: false,
      arbitrary_command: false,
      arbitrary_path: false,
    };
  }
  if (process.getuid && process.getuid() !== 0) fail('root_required');
  const lockFd = fs.openSync(LOCK, 'wx', 0o600);
  try {
    const out = args[0] === '--preflight' ? preflight() : await apply();
    if (args[0] === '--preflight' && RESULT) {
      atomicWrite(RESULT, Buffer.from(JSON.stringify(out, null, 2) + '\n'), 0o600);
    }
    return out;
  } finally {
    try { fs.closeSync(lockFd); } catch {}
    try { fs.unlinkSync(LOCK); } catch {}
  }
}

if (require.main === module) {
  main().then(out => process.stdout.write(JSON.stringify(out) + '\n')).catch(error => {
    process.stderr.write(String(error?.stack || error) + '\n');
    process.exitCode = 1;
  });
}
module.exports = { ACTION, SCHEMA, ROOT, COMPOSE, HTTPD_SOURCE, HTTPD_TARGET, preflight, apply, smoke };
