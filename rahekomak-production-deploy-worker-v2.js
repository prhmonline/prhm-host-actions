#!/usr/bin/env node
'use strict';

/*
 * RahKomak production-deploy worker v2.
 * Runs ONLY in a dedicated systemd transient unit with ProtectHome=read-only.
 * The resident Host Actions executor must retain ProtectHome=yes.
 * Never invoke this file directly on production; it must be installed through
 * the approved Git-SHA-bound Host Actions bootstrap path.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ROOT = '/home/prhm/projects/generated/rahekomak';
const HELPER = ROOT + '/infra/docker/production-deploy-v1.cjs';
const HEAD = '7f2ea82b0865bb64c8adbc3192e8547fe4f43c25';
const HELPER_SHA256 = 'd61140507300b4e2fc6650f2fc5e4b769543d9937dd2ff58574827af9c40696f';
const RESULT_ROOT = '/var/lib/prhm-agent-selfmaint-exec';
const ACTION = 'rahekomak_production_deploy_v1';
const SCRIPT_SCHEMA = 'prhm.rahekomak-production-deploy-result.v1';

function fail(message) { throw new Error(message); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function checkRegularExact(p) {
  const st = fs.lstatSync(p);
  if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync(p) !== p) fail('helper_not_regular_exact');
}
function fixedGit(args) {
  const out = cp.spawnSync('/usr/bin/git', ['-C', ROOT, ...args], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 200000,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', HOME: '/root', GIT_TERMINAL_PROMPT: '0' },
  });
  if (out.error || out.status !== 0) fail('git_read_failed');
  return String(out.stdout || '').trim();
}
function preflightIdentity() {
  checkRegularExact(HELPER);
  if (sha256(fs.readFileSync(HELPER)) !== HELPER_SHA256) fail('deploy_helper_sha_mismatch');
  if (fixedGit(['rev-parse', 'HEAD']) !== HEAD) fail('release_head_mismatch');
  if (fixedGit(['status', '--porcelain']) !== '') fail('release_worktree_dirty');
  return true;
}
function validateResult(result, mode) {
  if (result?.ok !== true || result.action !== ACTION || result.schema_version !== SCRIPT_SCHEMA) fail('deploy_result_invalid');
  if (mode === '--apply') {
    if (result.deployed_head !== HEAD || result.rollback_performed !== false
        || result.public_dns_mutation !== false || result.edge_tls_mutation !== false) fail('deploy_result_postcondition_failed');
    if (result.local_smoke?.public !== 200 || result.local_smoke?.admin !== 200
        || result.local_smoke?.api !== 200) fail('deploy_smoke_failed');
  } else if (result.preflight_only !== true || result.expected_head !== HEAD) {
    fail('deploy_preflight_invalid');
  }
  return result;
}
function reportPath(mode, nonce) {
  if (!/^[a-f0-9]{32}$/.test(nonce)) fail('invalid_nonce');
  return path.join(RESULT_ROOT, 'rahekomak-v2-' + nonce + '-' +
    (mode === '--apply' ? 'apply' : 'preflight') + '.json');
}
function writeReport(p, body) {
  const temp = p + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(body) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, p);
}
function execute(mode, nonce) {
  if (!['--preflight', '--apply'].includes(mode)) fail('invalid_mode');
  const dest = reportPath(mode, nonce);
  if (fs.existsSync(dest) || fs.existsSync(dest + '.tmp')) fail('report_already_exists');
  let record;
  try {
    preflightIdentity();
    const out = cp.spawnSync('/usr/local/bin/prhm-node', [HELPER, mode], {
      cwd: ROOT, encoding: 'utf8', timeout: mode === '--apply' ? 1800000 : 120000,
      maxBuffer: 4194304, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        RAHEKOMAK_EXPECTED_HEAD: HEAD,
        // Application writes this when possible; the worker always persists the final status.
        RAHEKOMAK_DEPLOY_RESULT: dest + '.app',
      },
    });
    if (out.error || out.status !== 0) fail('deploy_process_failed:' + String(out.status));
    let result;
    try { result = JSON.parse(String(out.stdout).trim()); }
    catch { fail('deploy_output_not_json'); }
    validateResult(result, mode);
    record = { ok: true, action: ACTION, mode, release_sha: HEAD,
      target: 'rahekomak.ir', timestamp: new Date().toISOString(),
      deploy: result, rollback_performed: result.rollback_performed === true };
  } catch (error) {
    record = { ok: false, action: ACTION, mode, release_sha: HEAD,
      target: 'rahekomak.ir', timestamp: new Date().toISOString(),
      error: String(error?.message || error).slice(0,400),
      deploy_status: 'failed_or_unverified', rollback_status: 'check_application_report' };
  }
  writeReport(dest, record);
  if (!record.ok) fail(record.error);
  return record;
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) fail('unexpected_arguments');
    const report = execute(process.argv[2], process.argv[3]);
    process.stdout.write(JSON.stringify(report) + '\n');
  } catch (err) {
    process.stderr.write(String(err?.message || err) + '\n');
    process.exitCode = 1;
  }
}
module.exports = { ROOT, HELPER, HEAD, HELPER_SHA256, RESULT_ROOT, ACTION,
  preflightIdentity, validateResult, reportPath, execute };
