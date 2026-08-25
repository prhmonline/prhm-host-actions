import assert from 'node:assert/strict';
import {
  FIXED,
  requestToolSchema,
  applyToolSchema,
  bindingPlan,
  validateBaselines
} from '../../candidates/control-plane/agent-api-fixed-one-shot-reload-runtime-binding-v1.mjs';

assert.deepEqual(requestToolSchema(),{});
assert.deepEqual(applyToolSchema(),{request_id:'uuid',second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'});
assert.equal(FIXED.action,'agent_api_fixed_one_shot_reload_v1');
assert.equal(FIXED.operation,'host_action.agent_api_fixed_one_shot_reload_v1');
assert.equal(FIXED.primitive_sha256,'3a1489b7f9a579095c82f5d7c40fec94262298da2517448ad9b11b5faf135659');
assert.equal(FIXED.executor.expected_sha256,'5a6049218c74d4c640b5e270848ea43b7dbb59f5c7e81446dcb179156b8e640a');
assert.equal(FIXED.mcp.expected_sha256,'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71');
assert.equal(FIXED.policy.expected_sha256,'4352ead2c0ec651c85e6206ae034b72e7be355c279ce1e0070626539725843fd');

const plan=bindingPlan();
assert.equal(plan.length,3);
assert.deepEqual(plan.map(x=>x.target),['executor','mcp','policy']);
assert.equal(plan.every(x=>x.arbitrary_path===false),true);
assert.equal(plan.every(x=>x.arbitrary_content===false),true);
assert.equal(plan.every(x=>x.rollback_required===true),true);
assert.equal(plan.find(x=>x.target==='executor').path,'/opt/prhm-agent-selfmaint-exec/server.js');
assert.equal(plan.find(x=>x.target==='mcp').path,'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js');
assert.equal(plan.find(x=>x.target==='policy').path,'/opt/prhm-company-control-plane/config/approval-policy.json');

assert.equal(validateBaselines({executor:FIXED.executor.expected_sha256,mcp:FIXED.mcp.expected_sha256,policy:FIXED.policy.expected_sha256}),true);
assert.throws(()=>validateBaselines({executor:'0'.repeat(64),mcp:FIXED.mcp.expected_sha256,policy:FIXED.policy.expected_sha256}),/executor_baseline_mismatch/);
assert.throws(()=>validateBaselines({executor:FIXED.executor.expected_sha256,mcp:'0'.repeat(64),policy:FIXED.policy.expected_sha256}),/mcp_baseline_mismatch/);
assert.throws(()=>validateBaselines({executor:FIXED.executor.expected_sha256,mcp:FIXED.mcp.expected_sha256,policy:'0'.repeat(64)}),/policy_baseline_mismatch/);

for(const forbidden of ['service','path','command','signal','url','sha256','payload','environment','token','credential','content']){
  assert.equal(Object.hasOwn(requestToolSchema(),forbidden),false);
}
console.log('AGENT_API_FIXED_ONE_SHOT_RELOAD_RUNTIME_BINDING_TDD=PASS');
