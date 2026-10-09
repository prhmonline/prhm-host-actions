'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const activation=require('./rahekomak-host-action-activation-v2.js');
const installer=require('./rahekomak-host-action-repair-installer-v2.js');

function validStage(){
  return {action:'rahekomak_host_action_repair_v2',
    status:'staged_pending_activation',
    original_sha256:activation.OLD_SHA,
    candidate_sha256:'a'.repeat(64),
    release_head:activation.RELEASE_HEAD,
    worker_git_blob:activation.WORKER_BLOB,
    worker_preexisting:false,worker_original_mode:null,executor_original_mode:0o755,
    backup:'/var/backups/prhm-rahekomak-host-action-repair-v2/20261008220200-1234'};
}

test('activation stage schema is fixed-SHA-bound and path-confined',()=>{
  assert.equal(activation.validateStageContract(validStage()).status,'staged_pending_activation');
  for(const malformed of [
    {action:'arbitrary_action'},
    {status:'activated'},
    {original_sha256:'0'.repeat(64)},
    {candidate_sha256:'notsha'},
    {release_head:'0'.repeat(40)},
    {worker_git_blob:'0'.repeat(40)},
    {worker_preexisting:'false'},
    {executor_original_mode:-1},
    {executor_original_mode:0o7777},
    {worker_preexisting:true,worker_original_mode:-1},
    {worker_preexisting:true,worker_original_mode:0o7777},
    {backup:'/tmp/untrusted'},
    {backup:'/var/backups/prhm-rahekomak-host-action-repair-v2/../evil'},
  ]){
    assert.throws(()=>activation.validateStageContract({...validStage(),...malformed}));
  }
});

test('staged installer emits the exact state schema consumed by activation',()=>{
  const src=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-repair-installer-v2.js'),'utf8');
  assert.equal(installer.STAGE,activation.STAGE);
  assert.match(src,/status:'staged_pending_activation'/);
  assert.match(src,/worker_preexisting:workerExisted/);
  assert.match(src,/original_sha256:EXECUTOR_PREIMAGE_SHA256/);
  assert.match(src,/candidate_sha256:pre\.candidate_sha256/);
  assert.match(src,/activation_stage_already_exists/);
  assert.match(src,/atomic\(STAGE/);
  assert.match(src,/for\(const p of \[STAGE,executorCandidate,workerCandidate\]\)/);
  assert.match(src,/production_code_written:false/);
  assert.match(src,/live_executor_drift_during_stage/);
});

test('activation is independently gated and does not restart on contract-only invocation',()=>{
  const src=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-activation-v2.js'),'utf8');
  const manifest=activation.manifest();
  assert.equal(manifest.level,4);
  assert.equal(manifest.one_time_confirmation_required,true);
  assert.equal(manifest.activation_policy,'separate_deferred_transient_unit_only');
  assert.equal(manifest.installer_status,'development_only');
  assert.equal(activation.activateApproved.length,0);
  assert.match(src,/activation_already_recorded/);
  assert.match(src,/rollback_live_drift/);
  assert.match(src,/staged_executor_sha_drift/);
  assert.match(src,/live_executor_not_old_version/);
  assert.match(src,/atomic\(EXECUTOR,candidate/);
  assert.match(src,/atomic\(WORKER,worker/);
  assert.match(src,/rollback_performed:wrote&&!rollbackError/);
  assert.match(src,/persistJson\(RESULT,record\)/);
  assert.match(src,/socketPath:SOCKET,path:'\/health'/);
  assert.doesNotMatch(src,/ProtectHome=no|shell\s*:\s*true|execSync\(/);
  const output=cp.execFileSync(process.execPath,[path.join(__dirname,'rahekomak-host-action-activation-v2.js')],{encoding:'utf8'});
  assert.equal(JSON.parse(output).action,activation.ACTION);
});

test('activation cannot select an arbitrary service or path',()=>{
  const src=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-activation-v2.js'),'utf8');
  assert.match(src,/const SERVICE='prhm-agent-selfmaint-exec.service'/);
  assert.match(src,/const EXECUTOR='\/opt\/prhm-agent-selfmaint-exec\/server.js'/);
  assert.match(src,/process\.argv\.length===3&&process\.argv\[2\]==='--activate'/);
  assert.doesNotMatch(src,/process\.argv\[3\]|body\.service|input\.path/);
});
