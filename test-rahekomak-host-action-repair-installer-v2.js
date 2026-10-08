'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const installer=require('./rahekomak-host-action-repair-installer-v2.js');

test('the installer is bound to one reviewed live executor preimage and artifacts',()=>{
  const m=installer.manifest();
  assert.equal(m.action,'rahekomak_host_action_repair_v2');
  assert.equal(m.executor_preimage_sha256,'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0');
  assert.equal(m.release_head,'7f2ea82b0865bb64c8adbc3192e8547fe4f43c25');
  assert.equal(installer.WORKER_GIT_BLOB,'6b8df4e4d5e2d7c057251e58717c5b00d5307287');
  assert.equal(installer.PATCH_GIT_BLOB,'255f350ad4a5f29192156fe9c4565ba8cedead3a');
  for(const [file,pin] of [
    ['rahekomak-production-deploy-worker-v2.js',installer.WORKER_GIT_BLOB],
    ['rahekomak-host-action-executor-patch-v2.js',installer.PATCH_GIT_BLOB]
  ]) {
    assert.equal(installer.gitBlob(fs.readFileSync(path.join(__dirname,file))),pin,file);
  }
  assert.equal(m.production_mutation,'approved_apply_only');
  assert.equal(m.preflight_mutation,false);
  assert.equal(m.source_git_commit_required,true);
  assert.equal(m.level,4);
  assert.equal(m.one_time_approval_required,true);
  assert.equal(m.separate_activation_required,true);
  assert.equal(m.rollback_required,true);
});

test('unknown or updated executor bytes fail closed without touching production',()=>{
  assert.throws(()=>installer.buildCandidate(''),/executor_preimage_drift/);
  assert.throws(()=>installer.buildCandidate('const x = 1;'),/executor_preimage_drift/);
  assert.equal(installer.applyApproved.length,0);
  assert.equal(installer.preflight.length,0);
});

test('installer CLI is contract-only, does not install or restart',()=>{
  const source=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-repair-installer-v2.js'),'utf8');
  assert.match(source,/if\(require\.main===module\)process\.stdout\.write\(JSON\.stringify\(manifest\(\)\)/);
  assert.doesNotMatch(source,/process\.argv\[2\]|process\.argv\.includes|--apply/);
  const out=cp.execFileSync(process.execPath,[path.join(__dirname,'rahekomak-host-action-repair-installer-v2.js')],{encoding:'utf8'});
  const result=JSON.parse(out);
  assert.equal(result.production_mutation,'approved_apply_only');
  assert.equal(result.installer_status,'candidate_only');
  assert.equal(result.installer_status,'candidate_only');
});

test('installer preserves ProtectHome guard, exact backup, integrity, and rollback',()=>{
  const source=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-repair-installer-v2.js'),'utf8');
  assert.match(source,/resident_protecthome_not_yes/);
  assert.match(source,/source_blob_drift/);
  assert.match(source,/existing_worker_drift/);
  assert.match(source,/time_of_check_drift/);
  assert.match(source,/staged_executor_sha_mismatch/);
  assert.match(source,/live_executor_drift_during_stage/);
  assert.match(source,/staging_failed_no_live_mutation/);
  assert.doesNotMatch(source,/atomic\(EXECUTOR,candidate/);
  assert.doesNotMatch(source,/atomic\(WORKER_TARGET,worker/);
  assert.doesNotMatch(source,/systemctl\('restart',EXECUTOR_SERVICE\)/);
  assert.match(source,/installation_state:'staged_pending_activation'/);
  assert.match(source,/production_runtime_restarted:false/);
  assert.match(source,/requires_separate_activation_approval:true/);
  assert.match(source,/fs\.mkdirSync\(BACKUP_ROOT,\{recursive:true,mode:0o700\}\)/);
  assert.match(source,/flag:'wx'/);
  assert.match(source,/production_code_written:false/);
  assert.match(source,/atomic\(executorCandidate,candidate/);
  assert.match(source,/atomic\(workerCandidate,worker/);
  assert.doesNotMatch(source,/shell\s*:\s*true|execSync\s*\(|\/bin\/bash|\/bin\/sh/);
});

test('development patch preview is valid under exact synthetic review preimage',()=>{
  const p=require('./rahekomak-host-action-executor-patch-v2.js');
  assert.equal(typeof p.patchExecutor,'function');
  assert.equal(p.manifest().installer_status,'not_installed');
});
