#!/usr/local/bin/prhm-node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ACTION = 'imotion_db_guard_install_v1';
const OPERATION = 'host_action.imotion_db_guard_install_v1';
const POLICY_VERSION = '2026-09-12.1-imotion-db-readonly-guard-v1';
const BASELINE = Object.freeze({
  base: '981a430f5448a1b0dc3c25886756ecf7cd655352660bb49905ab2650a131d764',
  executor: '451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48',
  policy: '494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70',
  mcp: '703a8f8ee0726fac47d008a69c759e3f52254c980cf551ea3f2660cc46321283'
});
const PATHS = Object.freeze({
  base: '/opt/prhm-agent-selfmaint/server.js',
  executor: '/opt/prhm-agent-selfmaint-exec/server.js',
  policy: '/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp: '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  bundle: '/opt/prhm-agent-selfmaint-exec/actions/imotion-db-readonly-guard-v1'
});
const PACKAGE = path.join(__dirname, 'packages', 'imotion-db-readonly-guard-v1');
const BUNDLE_FILES = Object.freeze([
  'manifest.json',
  'imotion-db-writability-guard',
  'imotion-db-readonly-window',
  'imotion-db-writability-guard.service',
  'imotion-db-writability-guard.timer',
  'imotion-db-forensics.rules',
  'imotion-db-guard-install-v1.js'
]);
const BACKUP_ROOT = '/var/backups/prhm-imotion-db-guard-v28-installer';
const INSTALL_RESULT = '/var/lib/prhm-agent-selfmaint-exec/imotion-db-guard-v28-installer/latest.json';
const SERVICES = Object.freeze([
  'prhm-company-approval.service',
  'prhm-agent-selfmaint.service',
  'prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp.service'
]);

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(code) { throw new Error(code); }
function once(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) fail(label + '_anchor_count_' + count);
  return source.replace(anchor, replacement);
}

function patchPolicy(source) {
  const policy = JSON.parse(source);
  if (policy.schema_version !== 'prhm.approval-policy.v1' || policy.version !== '2026-09-05.3-autonomous-operator-v1') {
    fail('policy_baseline_mismatch');
  }
  if (policy.operations?.[OPERATION] || policy.typed_scopes?.some(x => x?.action === ACTION)) {
    fail('policy_action_already_present');
  }
  policy.version = POLICY_VERSION;
  policy.operations[OPERATION] = {
    level: 4,
    risk: 'critical',
    requires_second_confirmation: true,
    one_time_use: true,
    requested_approver: 'mohammad',
    expires_seconds: 180,
    policy_version: POLICY_VERSION,
    rollback_reference: 'host-action-v2:imotion-db-guard-install-v1:exact-artifact-and-timer-rollback'
  };
  policy.typed_scopes.push({
    tool: 'host_action_v2_apply',
    project: 'control_plane',
    environment: 'production',
    action: ACTION,
    risk: 'critical',
    operation: OPERATION,
    principals: [{ principal_id: 'mohammad', roles: ['mcp-operator'] }]
  });
  return JSON.stringify(policy, null, 2) + '\n';
}

function patchBase(source) {
  if (source.includes(ACTION)) fail('base_action_already_present');
  const anchor = "  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }\n});";
  const replacement = "  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' },\n  imotion_db_guard_install_v1: { operation: 'host_action.imotion_db_guard_install_v1', rollback: 'host-action-v2:imotion-db-guard-install-v1:exact-artifact-and-timer-rollback' }\n});";
  return once(source, anchor, replacement, 'base_spec');
}

function patchMcp(source) {
  if (source.includes("'imotion_db_guard_install_v1'")) fail('mcp_action_already_present');
  const anchor = "'imotion_credential_bind_v1','control_plane_root_scripts_stage_transport_v1']);";
  const replacement = "'imotion_credential_bind_v1','control_plane_root_scripts_stage_transport_v1','imotion_db_guard_install_v1']);";
  return once(source, anchor, replacement, 'mcp_enum');
}

function patchExecutor(source, helperSha) {
  if (!/^[a-f0-9]{64}$/.test(helperSha)) fail('helper_sha_invalid');
  if (source.includes("imotion_db_guard_install_v1:{")) fail('executor_action_already_present');
  const specAnchor = "  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}\n});";
  const specReplacement = "  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'},\n  imotion_db_guard_install_v1:{operation:'host_action.imotion_db_guard_install_v1',kind:'imotion_db_guard_install_v1'}\n});";
  let out = once(source, specAnchor, specReplacement, 'executor_spec');

  const helperAnchor = "const ROOT_SCRIPTS_FIXED_STAGE_HELPER='/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js';";
  const helperCode = `const IMOTION_DB_GUARD_BUNDLE='/opt/prhm-agent-selfmaint-exec/actions/imotion-db-readonly-guard-v1';\nconst IMOTION_DB_GUARD_HELPER=IMOTION_DB_GUARD_BUNDLE+'/imotion-db-guard-install-v1.js';\nconst IMOTION_DB_GUARD_RESULT='/var/lib/prhm-agent-selfmaint-exec/imotion-db-guard-install-v1/latest.json';\nfunction applyImotionDbGuardInstallV1(){\n  const bytes=fs.readFileSync(IMOTION_DB_GUARD_HELPER);\n  const actual=require('node:crypto').createHash('sha256').update(bytes).digest('hex');\n  if(actual!=='${helperSha}')throw new Error('imotion_db_guard_helper_sha_mismatch');\n  try{if(fs.existsSync(IMOTION_DB_GUARD_RESULT))fs.unlinkSync(IMOTION_DB_GUARD_RESULT)}catch{}\n  const u='prhm-imotion-db-guard-install-v1-'+Date.now();\n  const a=['--wait','--collect','--quiet','--unit='+u,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=ProtectSystem=full','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadOnlyPaths='+IMOTION_DB_GUARD_BUNDLE,'--property=ReadWritePaths=/usr/local/sbin /etc/systemd/system /etc/audit/rules.d /var/backups/imotion-db-guard-install-v1 /var/lib/prhm-agent-selfmaint-exec/imotion-db-guard-install-v1 /var/log/imotion /run','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',IMOTION_DB_GUARD_HELPER];\n  cp.execFileSync('/usr/bin/systemd-run',a,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:300000,maxBuffer:1024*1024});\n  const r=readJson(IMOTION_DB_GUARD_RESULT);\n  if(r?.ok!==true||r?.action!=='imotion_db_guard_install_v1'||r?.schema_version!=='prhm.host-action-result.v1'||r?.installed!==true||r?.after_db?.read_only!=='0'||r?.after_db?.server_id!=='1'||r?.after_db?.slave_present!==false||r?.database_restart!==false||r?.docker_restart!==false||r?.rollback_performed!==false)throw new Error('imotion_db_guard_result_invalid');\n  return r;\n}\n`;
  out = once(out, helperAnchor, helperCode + helperAnchor, 'executor_helper');

  const applyAnchor = "applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();";
  const applyReplacement = "applyHostActionV2=async function(action){if(action==='imotion_db_guard_install_v1')return applyImotionDbGuardInstallV1();if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();";
  out = once(out, applyAnchor, applyReplacement, 'executor_apply');
  return out;
}

function readPackage() {
  const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'manifest.json'), 'utf8'));
  if (manifest?.schema_version !== 'prhm.imotion-db-readonly-guard-manifest.v1') fail('package_manifest_invalid');
  const files = {};
  for (const name of BUNDLE_FILES) {
    const file = path.join(PACKAGE, name);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync(file) !== file) fail('package_file_unsafe:' + name);
    files[name] = fs.readFileSync(file);
  }
  for (const item of manifest.payloads) {
    if (sha(files[item.source]) !== item.sha256) fail('package_payload_sha_mismatch:' + item.source);
  }
  return files;
}

function atomicWrite(file, bytes, mode, uid = 0, gid = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  const tmp = file + '.imotion-v28-' + process.pid + '-' + Date.now() + '.tmp';
  const fd = fs.openSync(tmp, 'wx', mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(tmp, mode); fs.chownSync(tmp, uid, gid); fs.renameSync(tmp, file);
  const dfd = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
}

function syntaxCheck(file) {
  const r = cp.spawnSync('/usr/local/bin/prhm-node', ['--check', file], { encoding: 'utf8', timeout: 15000 });
  if (r.error || r.status !== 0) fail('syntax_check_failed:' + file + ':' + String(r.stderr || r.stdout || '').slice(0, 800));
}

function buildInstallPlan(current, packageFiles) {
  for (const key of ['base', 'executor', 'policy', 'mcp']) {
    if (typeof current?.[key] !== 'string') fail('install_source_missing:' + key);
    if (sha(Buffer.from(current[key])) !== BASELINE[key]) fail('install_preimage_sha_mismatch:' + key + ':' + sha(Buffer.from(current[key])));
  }
  const helperSha = sha(packageFiles['imotion-db-guard-install-v1.js']);
  return {
    helperSha,
    next: {
      base: patchBase(current.base),
      executor: patchExecutor(current.executor, helperSha),
      policy: patchPolicy(current.policy),
      mcp: patchMcp(current.mcp)
    }
  };
}

function readCurrent() {
  return {
    base: fs.readFileSync(PATHS.base, 'utf8'),
    executor: fs.readFileSync(PATHS.executor, 'utf8'),
    policy: fs.readFileSync(PATHS.policy, 'utf8'),
    mcp: fs.readFileSync(PATHS.mcp, 'utf8')
  };
}

function backupCurrent(current) {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  const dir = path.join(BACKUP_ROOT, new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { mode: 0o700 });
  const files = {};
  for (const key of ['base', 'executor', 'policy', 'mcp']) {
    const sourcePath = PATHS[key];
    const st = fs.statSync(sourcePath);
    const dest = path.join(dir, key + '.bak');
    fs.writeFileSync(dest, Buffer.from(current[key]), { flag: 'wx', mode: 0o600 });
    files[key] = { backup: dest, mode: st.mode & 0o777, uid: st.uid, gid: st.gid, sha256: sha(Buffer.from(current[key])) };
  }
  return { dir, files, bundleExisted: fs.existsSync(PATHS.bundle) };
}

function writeCandidateTemp(label, source) {
  const file = '/tmp/imotion-v28-' + label + '-' + process.pid + '-' + Date.now() + '.js';
  fs.writeFileSync(file, source, { mode: 0o600, flag: 'wx' });
  syntaxCheck(file);
  fs.unlinkSync(file);
}

function installBundle(packageFiles) {
  if (fs.existsSync(PATHS.bundle)) fail('bundle_preexists_refuse_overwrite');
  fs.mkdirSync(PATHS.bundle, { recursive: false, mode: 0o700 });
  for (const name of BUNDLE_FILES) {
    const mode = name.endsWith('.js') ? 0o750 : (name === 'imotion-db-writability-guard' || name === 'imotion-db-readonly-window' ? 0o750 : 0o640);
    atomicWrite(path.join(PATHS.bundle, name), packageFiles[name], mode, 0, 0);
  }
  syntaxCheck(path.join(PATHS.bundle, 'imotion-db-guard-install-v1.js'));
  return Object.fromEntries(BUNDLE_FILES.map(name => [name, sha(fs.readFileSync(path.join(PATHS.bundle, name)))]));
}

function restore(backup) {
  const errors = [];
  for (const key of ['base', 'executor', 'policy', 'mcp']) {
    try {
      const b = backup.files[key];
      const bytes = fs.readFileSync(b.backup);
      if (sha(bytes) !== b.sha256) fail('backup_corrupt:' + key);
      atomicWrite(PATHS[key], bytes, b.mode, b.uid, b.gid);
    } catch (e) { errors.push(key + ':' + e.message); }
  }
  try { if (!backup.bundleExisted && fs.existsSync(PATHS.bundle)) fs.rmSync(PATHS.bundle, { recursive: true, force: true }); }
  catch (e) { errors.push('bundle:' + e.message); }
  for (const service of SERVICES) {
    try { cp.execFileSync('/usr/bin/systemctl', ['restart', service], { timeout: 30000, stdio: 'pipe' }); }
    catch (e) { errors.push(service + ':' + e.message); }
  }
  if (errors.length) fail('bootstrap_rollback_incomplete:' + errors.join('|'));
}

function atomicJson(file, value) {
  atomicWrite(file, Buffer.from(JSON.stringify(value, null, 2) + '\n'), 0o600, 0, 0);
}

function apply() {
  const current = readCurrent();
  const packageFiles = readPackage();
  const plan = buildInstallPlan(current, packageFiles);
  writeCandidateTemp('base', plan.next.base);
  writeCandidateTemp('executor', plan.next.executor);
  writeCandidateTemp('mcp', plan.next.mcp);
  JSON.parse(plan.next.policy);
  const backup = backupCurrent(current);
  let mutated = false;
  try {
    const bundle = installBundle(packageFiles);
    mutated = true;
    for (const key of ['policy', 'base', 'executor', 'mcp']) {
      const live = fs.statSync(PATHS[key]);
      atomicWrite(PATHS[key], Buffer.from(plan.next[key]), live.mode & 0o777, live.uid, live.gid);
    }
    for (const key of ['base', 'executor', 'mcp']) syntaxCheck(PATHS[key]);
    JSON.parse(fs.readFileSync(PATHS.policy, 'utf8'));
    for (const service of SERVICES) cp.execFileSync('/usr/bin/systemctl', ['restart', service], { timeout: 30000, stdio: 'pipe' });
    for (const service of SERVICES) {
      const state = cp.execFileSync('/usr/bin/systemctl', ['is-active', service], { encoding: 'utf8', timeout: 10000 }).trim();
      if (state !== 'active') fail('service_not_active:' + service + ':' + state);
    }
    const result = {
      ok: true,
      schema_version: 'prhm.bootstrap-result.v1',
      action: 'bootstrap_imotion_db_readonly_guard_v28',
      target_action: ACTION,
      installed: true,
      helper_sha256: plan.helperSha,
      bundle_sha256: bundle,
      baseline: BASELINE,
      runtime_sha256: {
        base: sha(fs.readFileSync(PATHS.base)),
        executor: sha(fs.readFileSync(PATHS.executor)),
        policy: sha(fs.readFileSync(PATHS.policy)),
        mcp: sha(fs.readFileSync(PATHS.mcp))
      },
      production_guard_executed: false,
      database_mutation: false,
      rollback_performed: false,
      backup_dir: backup.dir
    };
    atomicJson(INSTALL_RESULT, result);
    return result;
  } catch (error) {
    let rollbackError = null;
    if (mutated) {
      try { restore(backup); } catch (rb) { rollbackError = String(rb?.message || rb); }
    }
    const failure = {
      ok: false,
      schema_version: 'prhm.bootstrap-result.v1',
      action: 'bootstrap_imotion_db_readonly_guard_v28',
      target_action: ACTION,
      error: String(error?.message || error).slice(0, 1200),
      production_guard_executed: false,
      database_mutation: false,
      rollback_performed: mutated && rollbackError === null,
      rollback_error: rollbackError,
      backup_dir: backup.dir
    };
    try { atomicJson(INSTALL_RESULT, failure); } catch {}
    if (rollbackError) fail('bootstrap_failed_and_rollback_failed:' + failure.error + ':' + rollbackError);
    fail('bootstrap_failed_rolled_back:' + failure.error);
  }
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(apply()) + '\n'); }
  catch (error) { process.stderr.write(String(error?.stack || error) + '\n'); process.exitCode = 1; }
}

module.exports = {
  ACTION,
  OPERATION,
  POLICY_VERSION,
  BASELINE,
  PATHS,
  BUNDLE_FILES,
  patchPolicy,
  patchBase,
  patchMcp,
  patchExecutor,
  buildInstallPlan,
  apply
};
