'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const r=require('./drtarjomeh-incident47-runtime-registration-v1.js');
const runner=require('./drtarjomeh-incident47-reviewed-host-runner-v1.js');
const pins=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');
const app=r.ACTION;
const base="const HOST_ACTION_V2_SPECS = Object.freeze({\n  previous_v1:{operation:'host_action.previous_v1'}\n});";
const executor="const HOST_ACTION_V2_SPECS = Object.freeze({\n  previous_v1:{operation:'host_action.previous_v1'}\n});\nasync function applyHostActionV2(action){const spec=hostActionV2Spec(action);if(action==='previous_v1')return old();}";
const mcp="const HostActionV2=z.enum(['previous_v1','control_plane_current_owner_binding_refresh_v1']);";
test('registration only changes the one fixed action in four approved sites',()=>{
  const a=r.baseTransform(base),e=r.executorTransform(executor),m=r.mcpTransform(mcp);
  assert.equal(a.split(app).length-1,2); // registry key and operation name
  assert.match(a,/rollback: 'host-action-v2:drtarjomeh-incident47-guard-v1:preimage-restore'/);
  assert.match(e,/applyDrtI47GuardAfterTrustedApproval/);
  assert.match(e,/runner_source_mismatch/);
  assert.match(e,/if\(action==='drtarjomeh_incident47_uploads_guard_install_v1'\)/);
  assert.equal(e.split("if(action==='previous_v1')").length-1,1);
  assert.doesNotThrow(()=>new Function(e), 'generated executor JS must compile');
  assert.ok(m.includes("'control_plane_current_owner_binding_refresh_v1','"+app+"'"));
  assert.ok(a.includes("previous_v1"));assert.ok(e.includes("previous_v1"));
});
test('all string transforms refuse replay, duplicate action, and moving anchors',()=>{
  for(const [fn,src] of [[r.baseTransform,base],[r.executorTransform,executor],[r.mcpTransform,mcp]]){
    assert.throws(()=>fn(src+' '+app),/already_registered/);
    assert.throws(()=>fn(fn(src)),/already_registered/);
    assert.throws(()=>fn('different anchor'),/anchor_count/);
    assert.throws(()=>fn(src+src),/anchor_count/);
  }
});
test('host policy transform refuses unverifiable source before any grants',()=>{
  assert.throws(()=>r.policyTransform(Buffer.from('{}')),/policy_sha_drift/);
  assert.throws(()=>r.policyTransform(Buffer.from('changed policy')),/policy_sha_drift/);
  assert.throws(()=>r.assertLiveBytePreimage('base',Buffer.from('drift')),/live_preimage_mismatch/);
  assert.throws(()=>r.assertLiveBytePreimage('something',Buffer.from('fake')),/bytes_missing/);
});
test('runner is exactly pinned by Git blob and never caller-supplied',()=>{
  const name='drtarjomeh-incident47-reviewed-host-runner-v1.js';
  const bytes=fs.readFileSync(path.join(__dirname,name));
  assert.equal(r.verifyRunner(()=>bytes).git_blob_sha,r.RUNNER_GIT_BLOB);
  assert.throws(()=>r.verifyRunner(()=>Buffer.from('tampered')),/runner_git_blob_mismatch/);
  assert.equal(r.RUNNER_TARGET,'/opt/prhm-agent-selfmaint-exec/actions/'+name);
  assert.equal(runner.APP_SHA,pins.SOURCE_COMMIT);
  assert.ok(runner.INVOKE_PYTHON.includes("m.install_guard(policy,"));
  assert.ok(runner.INVOKE_PYTHON.includes("m.preflight('"+pins.SOURCE_COMMIT+"')"));
});
test('live target SHA or source branch change fails closed before mutation',()=>{
  const deny=()=>{throw Error('unexpected read')};
  assert.throws(()=>r.buildCandidates({hostMainSha:'f'.repeat(40),readOwner:deny,readRunner:deny}),/host_main_sha_drift/);
  assert.throws(()=>r.buildCandidates({readOwner:()=>Buffer.from('wrong preimage'),readRunner:deny}),/base_live_preimage_mismatch/);
  assert.throws(()=>runner.inspectPrerequisites({readFile:deny,cmd:()=> 'wrong-head'}),/application_head_sha_changed/);
  assert.throws(()=>runner.runAfterTrustedApproval({readFile:deny,cmd:()=> 'wrong-head'}),/application_head_sha_changed/);
});
test('old containment action is not re-used for wrong release',()=>{
  assert.notEqual(r.ACTION,'drtarjomeh_security_containment_v1');
  assert.notEqual(runner.APP_SHA,'20260805-011747-672d32f490bd');
  assert.equal(pins.approvalPolicyOperation().one_time_use,true);
  assert.equal(pins.approvalPolicyOperation().level,4);
  assert.equal(pins.approvalPolicyOperation().expires_seconds,180);
});
test('registration candidate and reviewed runner do not expose install CLI',()=>{
  for(const [name,arg] of [['drtarjomeh-incident47-runtime-registration-v1.js','--apply'],
    ['drtarjomeh-incident47-runtime-registration-v1.js','--install'],
    ['drtarjomeh-incident47-reviewed-host-runner-v1.js','--apply']]){
    const p=cp.spawnSync(process.execPath,[path.join(__dirname,name),arg],
      {encoding:'utf8',timeout:5000});
    assert.notEqual(p.status,0);
  }
  const check=cp.spawnSync(process.execPath,
    [path.join(__dirname,'drtarjomeh-incident47-runtime-registration-v1.js'),'--selftest'],
    {encoding:'utf8',timeout:5000});
  assert.equal(check.status,0,check.stderr);
  const out=JSON.parse(check.stdout);
  assert.equal(out.production_mutation,false);
  assert.equal(out.read_only,true);
});
