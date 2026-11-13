'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const t=require('./solo-company-runtime-signed-registration-transaction-v1.js');
const reg=require('./solo-company-runtime-l4-registration-candidate-v1.js');
const worker=require('./solo-company-runtime-root-action-v1.js');

function syntheticPlan(){
  return {
    schema:'prhm.solo-runtime.registration-plan.v1',action:t.ACTION,
    operation:t.OPERATION,release_sha:reg.RELEASE_SHA,
    source_commits:t.SOURCE_COMMITS,root_helper_sha:t.PINS.worker_sha,
    steps:t.ORDER.map(kind=>{
      const bytes=Buffer.from('synthetic-test-'+kind);
      return {
        kind,path:t.TARGETS[kind],bytes,
        before_sha256:kind==='worker'?null:
          kind==='core'?t.PINS.core_before:reg.EXPECTED[kind],
        after_sha256:t.hash(bytes),uid:0,gid:0,mode:0o600
      };
    })
  };
}
test('six fixed target paths and pinned two-repository SHA identities',()=>{
  assert.deepEqual(t.ORDER,['worker','core','approval','executor','policy','mcp']);
  assert.equal(t.OPERATION,'host_action.solo_company_runtime_registration_v1');
  assert.equal(t.PINS.core_before,'fac8458d3a85bef0d30ba3864f1b9368e921ee66483528f4cdfb91fb4cc395b7');
  assert.equal(t.PINS.core_after,worker.SOURCE_SHA256);
  assert.equal(t.PINS.worker_sha,reg.ROOT_HELPER_SHA256);
  assert.equal(t.TARGETS.worker,'/opt/prhm-agent-selfmaint-exec/actions/solo-company-runtime-root-action-v1.js');
  assert.equal(t.TARGETS.core,'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js');
  t.verifySources();
});
test('transaction core contains no CLI capability',()=>{
  const p=cp.spawnSync(process.execPath,[path.join(__dirname,'solo-company-runtime-signed-registration-transaction-v1.js')],{encoding:'utf8'});
  assert.equal(p.status,64);
  assert.match(p.stderr,/NO_CLI/);
});
test('exact plan identifies every write and detects mutations',()=>{
  const plan=syntheticPlan();
  t.verifyPlan(plan);
  plan.steps[4].bytes[0]=42;
  assert.throws(()=>t.verifyPlan(plan),/installation_plan_step_invalid_policy/);
  assert.throws(()=>t.verifyPlan({...syntheticPlan(),operation:'host_action.malicious'}),/installation_plan_binding_invalid/);
  assert.throws(()=>t.verifyPlan({...syntheticPlan(),source_commits:{...t.SOURCE_COMMITS,host:'fake'}}),/installation_plan_binding_invalid/);
});
test('six live preimages are mandatory; no network, write or grant on mismatch',()=>{
  let reads=0,sourceReads=0;
  assert.throws(()=>t.getPlan({inspect(){reads++;return {exists:false}},pinnedGitRead(){sourceReads++;return Buffer.alloc(0)}}),/root_worker_target_already_exists|production_preimage_mismatch/);
  assert.ok(reads>0);
  assert.equal(sourceReads,0);
  assert.throws(()=>t.getPlan(null),/trusted_adapter_required/);
});
test('signed critical approval must be replay-consumed before lock, backup or write',async()=>{
  let writes=0,locks=0;
  const adapter={
    consumeSignedL4:async()=>({verified:true,consumed:false,
      operation:t.OPERATION,level:4,risk:'critical',
      request_id:'11111111-1111-4111-8111-111111111111'}),
    lock:async()=>{locks++;return async()=>{}},
    snapshot:async()=>[],backup:async()=>{},writeExact:async()=>{writes++},
    verifyExact:async()=>{},reloadAndHealth:async()=>({}),restoreExact:async()=>{},
    verifyRestore:async()=>{},record:async()=>{}
  };
  await assert.rejects(()=>t.applyPrepared(syntheticPlan(),adapter),/signed_level4_grant_unverified/);
  assert.equal(writes,0);
  assert.equal(locks,0);
});
test('grant cannot bypass under-lock production SHA revalidation',async()=>{
  let writes=0,backups=0,released=0;
  const adapter={
    consumeSignedL4:async()=>({verified:true,consumed:true,
      operation:t.OPERATION,level:4,risk:'critical',
      request_id:'22222222-2222-4222-8222-222222222222'}),
    lock:async()=>async()=>{released++},
    inspect:()=>({exists:false}),
    pinnedGitRead:()=>Buffer.alloc(0),
    snapshot:async()=>[],backup:async()=>{backups++},writeExact:async()=>{writes++},
    verifyExact:async()=>{},reloadAndHealth:async()=>({}),restoreExact:async()=>{},
    verifyRestore:async()=>{},record:async()=>{}
  };
  await assert.rejects(()=>t.applyPrepared(syntheticPlan(),adapter),/production_preimage_mismatch/);
  assert.equal(writes,0);assert.equal(backups,0);assert.equal(released,1);
});
