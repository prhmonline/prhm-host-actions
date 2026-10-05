'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ACTION = 'safe_delivery_profile_enable_next_v1';
const STATE_ROOT = '/var/lib/prhm-agent-instant-delivery-v1/instant-delivery';
const STATE_FILE = path.join(STATE_ROOT, 'profile-enablement.json');
const PROFILE_MODULE = '/home/agent/candidates/agent3-safe-delivery-profile-expansion/api/instant-delivery-v1/profile-enablement.cjs';
const PROFILE_MODULE_SHA256 = '700c8e0e7374a03021b5e45b3e624f8c2e834a73f176546cd9bb5dfc04af5825';
const RESULT_ROOT = '/var/lib/prhm-agent-selfmaint-exec/safe-delivery-profile-enable-next-v1';
const RESULT_FILE = path.join(RESULT_ROOT, 'latest.json');
const IMOTION_SCRIPT = '/mnt/imotion-prod-vm/domains/i-motion.ir/public_html/scripts/safe-build-deploy.sh';
const IMOTION_SCRIPT_SHA256 = 'd8cf5911d40cc52f4891993e6961a766c851d1984bb94b9c4adb37db0c761cb9';
const ROLLOUT_ORDER = Object.freeze(['drtarjomeh_prod','rahekomak','cfpark_front_prod','titan_front_prod','imotion_front_prod']);
const MUTABLE_TARGETS = Object.freeze(['cfpark_front_prod','titan_front_prod','imotion_front_prod']);
const HEALTH = Object.freeze({
  cfpark_front_prod: Object.freeze({ service: 'cfpark-frontend.service', url: 'https://cfpark.ir/' }),
  titan_front_prod: Object.freeze({ service: 'titan-front.service', url: 'https://titanfitness-club.com/' }),
  imotion_front_prod: Object.freeze({ service: null, url: 'https://i-motion.ir/' })
});

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code){ throw new Error(code); }
function strictRegular(file, expectedSha, label){
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) fail(label + '_not_regular');
  if (fs.realpathSync(file) !== file) fail(label + '_realpath_mismatch');
  const bytes = fs.readFileSync(file);
  if (expectedSha && sha256(bytes) !== expectedSha) fail(label + '_sha_mismatch');
  return { st, bytes, sha: sha256(bytes) };
}
function validateRawState(value){
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('safe_delivery_state_invalid');
  if (value.version !== 1) fail('safe_delivery_state_version_invalid');
  if (!value.enabled || typeof value.enabled !== 'object' || Array.isArray(value.enabled)) fail('safe_delivery_state_enabled_invalid');
  const keys = Object.keys(value.enabled).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...ROLLOUT_ORDER].sort())) fail('safe_delivery_state_keys_invalid');
  let seenDisabled = false;
  for (const project of ROLLOUT_ORDER) {
    const enabled = value.enabled[project];
    if (typeof enabled !== 'boolean') fail('safe_delivery_state_boolean_invalid');
    if (!enabled) seenDisabled = true;
    else if (seenDisabled) fail('safe_delivery_state_non_contiguous');
  }
  return value;
}
function readStrictState(){
  const bound = strictRegular(STATE_FILE, null, 'safe_delivery_state_file');
  let value;
  try { value = JSON.parse(bound.bytes.toString('utf8')); }
  catch { fail('safe_delivery_state_json_invalid'); }
  validateRawState(value);
  return { ...bound, value };
}
function deriveNextProject(value){
  validateRawState(value);
  return ROLLOUT_ORDER.find(project => value.enabled[project] === false) || null;
}
function assertMutableTarget(project){
  if (project === null) return;
  if (!MUTABLE_TARGETS.includes(project)) fail('safe_delivery_rollout_baseline_regressed');
}
function validateTransition(before, after, target){
  validateRawState(before); validateRawState(after);
  if (deriveNextProject(before) !== target) fail('safe_delivery_transition_target_invalid');
  assertMutableTarget(target);
  for (const project of ROLLOUT_ORDER) {
    const expected = project === target ? true : before.enabled[project];
    if (after.enabled[project] !== expected) fail('safe_delivery_transition_invalid');
  }
  if (before.enabled[target] !== false) fail('safe_delivery_transition_invalid');
}
function run(file, args, timeoutMs = 30000){
  const result = cp.spawnSync(file, args, { encoding:'utf8', timeout:timeoutMs, maxBuffer:512000,
    env:{ PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL:'C', HOME:'/nonexistent' } });
  if (result.error || result.status !== 0) fail('safe_delivery_preflight_exec_failed:' + path.basename(file));
  return String(result.stdout || '').trim();
}
function httpHealth(url){
  const status = run('/usr/bin/curl', ['--silent','--show-error','--location','--max-time','15','--output','/dev/null','--write-out','%{http_code}',url], 25000);
  const code = Number(status);
  if (!Number.isInteger(code) || code < 200 || code >= 400) fail('safe_delivery_public_health_failed');
  return code;
}
function preflightTarget(target){
  const config = HEALTH[target];
  if (!config) fail('safe_delivery_target_health_contract_missing');
  if (config.service) run('/usr/bin/systemctl', ['is-active','--quiet',config.service], 15000);
  if (target === 'imotion_front_prod') strictRegular(IMOTION_SCRIPT, IMOTION_SCRIPT_SHA256, 'safe_delivery_imotion_script');
  return { service_active: config.service ? true : null, http_status: httpHealth(config.url) };
}
function atomicRestore(bytes, st){
  const dir = path.dirname(STATE_FILE);
  const tmp = path.join(dir, '.profile-enablement.rollback-' + process.pid + '-' + Date.now() + '.tmp');
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', st.mode & 0o777);
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.chownSync(tmp, st.uid, st.gid); fs.chmodSync(tmp, st.mode & 0o777);
    fs.renameSync(tmp, STATE_FILE);
    const dfd = fs.openSync(dir, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch (error) {
    try { if (fd !== undefined) fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}
function writeResult(value){
  fs.mkdirSync(RESULT_ROOT, { recursive:true, mode:0o700 });
  const tmp = path.join(RESULT_ROOT, '.latest-' + process.pid + '-' + Date.now() + '.tmp');
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  fs.writeFileSync(tmp, bytes, { mode:0o600, flag:'wx' });
  fs.renameSync(tmp, RESULT_FILE);
}
function successBase(beforeSha){
  return { ok:true, schema_version:'prhm.host-action-result.v1', action:ACTION,
    state_old_sha256:beforeSha, database_mutation:false, production_application_mutation:false, rollback_performed:false };
}
function main(){
  strictRegular(PROFILE_MODULE, PROFILE_MODULE_SHA256, 'safe_delivery_profile_module');
  const before = readStrictState();
  const target = deriveNextProject(before.value);
  if (target === null) {
    writeResult({ ...successBase(before.sha), already_complete:true, target_project:null, state_mutation:false, state_new_sha256:before.sha });
    return;
  }
  assertMutableTarget(target);
  const preflight = preflightTarget(target);
  const loaded = require(PROFILE_MODULE);
  if (JSON.stringify(loaded.ROLLOUT_ORDER) !== JSON.stringify(ROLLOUT_ORDER) || typeof loaded.createProfileEnablement !== 'function') {
    fail('safe_delivery_profile_module_contract_mismatch');
  }
  const profile = loaded.createProfileEnablement({ root: STATE_ROOT });
  if (profile.file !== STATE_FILE || typeof profile.enable !== 'function') fail('safe_delivery_profile_binding_mismatch');
  try {
    profile.enable(target);
    const after = readStrictState();
    validateTransition(before.value, after.value, target);
    const postflight = preflightTarget(target);
    writeResult({ ...successBase(before.sha), target_project:target, state_mutation:true, state_new_sha256:after.sha,
      preflight_verified:true, postflight_verified:true, preflight, postflight });
  } catch (error) {
    let rollbackPerformed = false;
    let rollbackFailed = false;
    let rollbackError = null;
    try {
      const current = fs.readFileSync(STATE_FILE);
      if (sha256(current) !== before.sha) {
        atomicRestore(before.bytes, before.st);
        rollbackPerformed = true;
      }
      if (sha256(fs.readFileSync(STATE_FILE)) !== before.sha) fail('safe_delivery_rollback_sha_mismatch');
    } catch (rollback) {
      rollbackFailed = true;
      rollbackError = String(rollback && rollback.message || rollback);
    }
    try { writeResult({ ok:false, schema_version:'prhm.host-action-result.v1', action:ACTION, target_project:target,
      state_old_sha256:before.sha, database_mutation:false, production_application_mutation:false,
      rollback_performed:rollbackPerformed, rollback_failed:rollbackFailed, error:String(error && error.message || error), rollback_error:rollbackError }); } catch {}
    if (rollbackFailed) fail('safe_delivery_enable_next_failed_rollback_failed:' + String(error && error.message || error) + ':' + rollbackError);
    fail('safe_delivery_enable_next_failed' + (rollbackPerformed ? '_rolled_back:' : ':') + String(error && error.message || error));
  }
}
main();
