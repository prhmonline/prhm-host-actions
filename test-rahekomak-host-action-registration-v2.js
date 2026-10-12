'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const reg=require('./rahekomak-host-action-registration-v2.js');

function fixtures(){
  const base=[
    "'use strict';",
    "const HOST_ACTION_V2_SPECS=Object.freeze({",
    reg.ANCHOR_BASE,
    "});"
  ].join('\n');
  const executor=[
    "'use strict';",
    "const HOST_ACTION_V2_SPECS=Object.freeze({",
    reg.ANCHOR_EXEC,
    "});",
    reg.ANCHOR_BLOCK,
    "async function applyHostActionV2(){}",
    "applyHostActionV2=async function(action){"+reg.ANCHOR_DISPATCH,
  ].join('\n');
  const mcp="const z={enum() {}}; const HostActionV2=z.enum(['"+'rahekomak_production_deploy_v1'+"']);\n";
  const policy=JSON.stringify({
    operations:{'host_action.rahekomak_production_deploy_v1':{level:4,risk:'critical'}},
    typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',
      environment:'production',action:'rahekomak_production_deploy_v1',
      operation:'host_action.rahekomak_production_deploy_v1'}]
  },null,2);
  return {base,executor,mcp,policy};
}

test('two operations have fixed names, exact live source SHA-256 bindings and one-time Level-4 policy',()=>{
  const m=reg.manifest();
  assert.equal(m.production_mutation,false);
  assert.equal(m.registration_installed,false);
  assert.equal(m.external_approved_bootstrap_required,true);
  assert.equal(m.stage_mutates_live_executor,false);
  assert.equal(m.activate_requires_separate_level4,true);
  assert.deepEqual(m.actions,[
    'rahekomak_host_action_repair_stage_v2',
    'rahekomak_host_action_repair_activate_v2']);
  assert.deepEqual(reg.PREIMAGE,{
    base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
    executor:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
    mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',
    policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'
  });
  const artifacts=Object.keys(reg.ARTIFACTS);
  assert.equal(artifacts.length,5);
  for(const name of artifacts){
    const bytes=fs.readFileSync(path.join(__dirname,name));
    const actual=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    assert.equal(actual,reg.ARTIFACTS[name],'artifact drift: '+name);
  }
});
test('executor registrations use an isolated transient unit rather than exposing the resident /home',()=>{
  const fx=fixtures();
  const out=reg.patchExecutor(fx.executor);
  new vm.Script(out);
  for(const action of reg.manifest().actions)assert.match(out,new RegExp(action));
  assert.match(out,/ProtectHome=yes/);
  assert.match(out,/ReadWritePaths=\/var\/lib\/prhm-agent-selfmaint-exec/);
  assert.match(out,/ReadWritePaths=\/var\/backups/);
  assert.match(out,/stage\?\[\]:\['--property=ReadWritePaths=\/opt\/prhm-agent-selfmaint-exec'\]/);
  assert.match(out,/--on-active=5s/);
  assert.match(out,/activated:false/);
  assert.match(out,/verification_required:true/);
  assert.match(out,/rahekomak_artifact_blob_mismatch/);
  assert.match(out,/rahekomak_stage_report_contract_failed/);
  assert.doesNotMatch(out,/ProtectHome=no|ProtectHome=false|shell\s*:\s*true/);
  assert.doesNotMatch(out,/ReadWritePaths=\/home\/prhm/);
  assert.equal(out.split('rahekomak_host_action_repair_stage_v2:').length-1,1);
});
test('base, MCP and policy preserve original identity and add only fixed typed Level-4 actions',()=>{
  const x=fixtures();
  const b=reg.patchBase(x.base);
  const m=reg.patchMcp(x.mcp);
  const policy=JSON.parse(reg.patchPolicy(x.policy));
  for(const a of reg.actionSpecs()){
    assert.match(b,new RegExp(a.name));
    assert.match(m,new RegExp(a.name));
    assert.equal(policy.operations[a.operation].level,4);
    assert.equal(policy.operations[a.operation].risk,'critical');
    assert.equal(policy.operations[a.operation].requires_second_confirmation,true);
    assert.equal(policy.operations[a.operation].one_time_use,true);
    assert.equal(policy.operations[a.operation].expires_seconds,180);
    const scope=policy.typed_scopes.find(x=>x.operation===a.operation);
    assert.equal(scope.action,a.name);
    assert.equal(scope.environment,'production');
    assert.equal(scope.project,'control_plane');
    assert.equal(scope.tool,'host_action_v2_apply');
    assert.deepEqual(scope.principals,[{principal_id:'mohammad',roles:['mcp-operator']}]);
  }
  assert.ok(policy.operations['host_action.rahekomak_production_deploy_v1']);
  assert.equal(policy.typed_scopes.length,3);
});
test('fail closed on missing/duplicated anchors, existing actions, malformed policy, or hash drift',()=>{
  const x=fixtures();
  assert.throws(()=>reg.patchBase('no anchor'),/anchor_missing/);
  assert.throws(()=>reg.patchBase(x.base+'\n'+reg.ANCHOR_BASE),/anchor_missing/);
  assert.throws(()=>reg.patchExecutor(x.executor.replace(reg.ANCHOR_DISPATCH,'no dispatch')),/anchor_missing/);
  assert.throws(()=>reg.patchExecutor(reg.patchExecutor(x.executor)),/executor_action_already_present|anchor_missing/);
  assert.throws(()=>reg.patchMcp("const HostActionV2=z.enum([]);"),/anchor_missing/);
  assert.throws(()=>reg.patchMcp(reg.patchMcp(x.mcp)),/mcp_action_already_present/);
  assert.throws(()=>reg.patchPolicy('{}'),/policy_schema_mismatch/);
  assert.throws(()=>reg.patchPolicy(reg.patchPolicy(x.policy)),/policy_action_already_present/);
  assert.throws(()=>reg.verifyPreimages(x),/preimage_sha_drift/);
  assert.throws(()=>reg.buildCandidate(x),/preimage_sha_drift/);
});
test('registered executor helper refuses arbitrary action parameters and only verifies pinned blobs',()=>{
  const source=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-registration-v2.js'),'utf8');
  assert.doesNotMatch(source,/fs\.writeFileSync\(|fs\.renameSync\(|execSync\(|shell\s*:\s*true/);
  assert.match(source,/return rahKomakRepairTransientV2\('stage'\)/);
  assert.match(source,/return rahKomakRepairTransientV2\('activate'\)/);
  const script=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-stage-v2.js'),'utf8');
  assert.match(script,/installer\.applyApproved\(\)/);
  assert.match(script,/process\.argv\.length!==2/);
  assert.match(script,/production_code_written!==false/);
});
