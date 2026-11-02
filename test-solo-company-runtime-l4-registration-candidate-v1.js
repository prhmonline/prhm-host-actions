'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('./solo-company-runtime-l4-registration-candidate-v1.js');
const approval="const HOST_ACTION_V2_SPECS = Object.freeze({\n  solo_company_selftest_v1:{operation:'host_action.solo_company_selftest_v1'},\n});";
const executor="const HOST_ACTION_V2_SPECS = Object.freeze({\n  solo_company_selftest_v1:{operation:'host_action.solo_company_selftest_v1'},\n});\napplyHostActionV2=async function(action){return applyHostActionV2Original(action)};";
const mcp="const HostActionV2=z.enum(['solo_company_selftest_v1','other_v1']);";
const policy=JSON.stringify({operations:{},typed_scopes:[{action:'rahekomak_production_deploy_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]});
test('fixed target and immutable production SHA inventory',()=>{
  assert.equal(mod.RELEASE_SHA,'0eb43d72aab3f10db22172c8be4c0411cf22d074');
  assert.deepEqual(Object.keys(mod.EXPECTED).sort(),['approval','executor','mcp','policy']);
  for(const v of Object.values(mod.EXPECTED))assert.match(v,/^[a-f0-9]{64}$/);
});
test('four registration candidates include a CLOSED privileged dispatch',()=>{
  const a=mod.approval(approval), e=mod.executor(executor), m=mod.mcp(mcp), p=JSON.parse(mod.policy(policy));
  assert.equal((a.match(/host_action\.solo_company_runtime_install_v1/g)||[]).length,1);
  assert.match(e,/function applySoloCompanyRuntimeInstallV1\(\)/);
  assert.match(e,/solo_root_helper_sha_mismatch/);
  assert.match(e,/--property=ProtectSystem=full/);
  assert.match(e,/ConfigurationDirectory=prhm-solo-company/);
  assert.match(e,/EnvironmentFile=\/etc\/prhm-agent-mcp-auth.env/);
  assert.match(e,/solo_root_result_binding_invalid/);
  assert.match(e,/155000/);
  assert.match(e,/return applySoloCompanyRuntimeInstallV1\(\)/);
  assert.match(m,/'solo_company_runtime_install_v1'/);
  assert.equal(p.operations['host_action.solo_company_runtime_install_v1'].level,4);
  assert.equal(p.operations['host_action.solo_company_runtime_install_v1'].one_time_use,true);
  assert.equal(p.operations['host_action.solo_company_runtime_install_v1'].requires_second_confirmation,true);
  assert.equal(p.typed_scopes.at(-1).risk,'critical');
  assert.deepEqual(p.typed_scopes.at(-1).principals,[{principal_id:'mohammad',roles:['mcp-operator']}]);
});
test('duplicate registration and anchor drift fail closed',()=>{
  assert.throws(()=>mod.approval(mod.approval(approval)),/already_registered/);
  assert.throws(()=>mod.executor(mod.executor(executor)),/already_registered/);
  assert.throws(()=>mod.mcp(mod.mcp(mcp)),/already_registered/);
  assert.throws(()=>mod.policy(mod.policy(policy)),/duplicate/);
  assert.throws(()=>mod.executor(''),/executor_anchor_invalid/);
  assert.throws(()=>mod.mcp(''),/mcp_enum_invalid/);
});
test('baseline authorization is never bypassed by arbitrary input',()=>{
  const raw={approval:Buffer.from(approval),executor:Buffer.from(executor),mcp:Buffer.from(mcp),policy:Buffer.from(policy)};
  assert.throws(()=>mod.buildCandidates(raw),/baseline_sha_mismatch/);
  assert.equal(typeof mod.buildCandidates,'function');
  assert.match(mod.ROOT_HELPER_SHA256,/^[a-f0-9]{64}$/);
});
