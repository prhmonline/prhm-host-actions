'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./bootstrap-host-actions-v30-safe-delivery-profile-enable-next.js');

test('exports current SHA-bound Level-4 installer contract',()=>{
  assert.equal(m.ACTION,'safe_delivery_profile_enable_next_v1');
  assert.equal(m.OPERATION,'host_action.safe_delivery_profile_enable_next_v1');
  assert.equal(m.POLICY_SHA,'aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c');
  assert.equal(m.BASE_SHA,'ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f');
  assert.equal(m.EXEC_SHA,'a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4');
  assert.equal(m.MCP_SHA,'8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075');
  assert.equal(m.CANDIDATE_MCP_SHA,'103dfdf49f95794e84dfa40d97d1622aabb2efb7a373809010262def63fd00d8');
  assert.equal(m.PATHS.candidateMcp,'/home/agent/candidates/agent3-safe-delivery-profile-expansion/mcp/src/plugins/hostActionsV2.js');
});

test('policy candidate adds only one critical typed zero-input action',()=>{
  const base={schema_version:'prhm.approval-policy.v1',version:m.CURRENT_POLICY_VERSION,operations:{},typed_scopes:[]};
  const out=JSON.parse(m.buildPolicyCandidate(JSON.stringify(base)));
  assert.equal(out.version,m.POLICY_VERSION);
  assert.deepEqual(out.operations[m.OPERATION],{level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:m.POLICY_VERSION,rollback_reference:'host-action-v2:safe-delivery-profile-enable-next-v1:profile-state-preimage-restore'});
  assert.equal(out.typed_scopes.filter(x=>x.action===m.ACTION).length,1);
  assert.throws(()=>m.buildPolicyCandidate(JSON.stringify(out)),/policy_baseline_mismatch|already_present/);
});

test('MCP candidate exposes only the fixed action enum',()=>{
  const src="const HostActionV2=z.enum(['imotion_credential_bind_v1','control_plane_root_scripts_stage_transport_v1']);\n";
  const out=m.buildMcpCandidate(src);
  assert.ok(out.includes("'control_plane_root_scripts_stage_transport_v1','safe_delivery_profile_enable_next_v1']"));
  assert.throws(()=>m.buildMcpCandidate(out),/already_present/);
});

test('base candidate registers action as Level-4 and never Level-3',()=>{
  const src=["const HOST_ACTION_V2_SPECS = Object.freeze({","  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }","});","const HOST_ACTION_V2_LEVEL3 = new Set(['agent_zdt_source_sha_refresh_publisher_v1']);"].join('\n');
  const out=m.buildBaseCandidate(src);
  assert.ok(out.includes("safe_delivery_profile_enable_next_v1: { operation: 'host_action.safe_delivery_profile_enable_next_v1'"));
  const level3=out.match(/HOST_ACTION_V2_LEVEL3 = new Set\((\[[^;]+\])\)/)?.[1]||'';
  assert.equal(level3.includes('safe_delivery_profile_enable_next_v1'),false);
});

test('executor candidate SHA-binds helper and uses bounded sandbox',()=>{
  const src=["const ACTION_SPECS=Object.freeze({","  agent_zdt_source_sha_refresh_publisher_v1:{operation:'host_action.agent_zdt_source_sha_refresh_publisher_v1',kind:'agent_zdt_source_sha_refresh_publisher_v1'}","});","applyHostActionV2=async function(action){return applyHostActionV2Original(action);};"].join('\n');
  const h='f'.repeat(64); const out=m.buildExecCandidate(src,h);
  assert.ok(out.includes("actual!=='"+h+"'"));
  assert.ok(out.includes("ReadWritePaths=/var/lib/prhm-agent-instant-delivery-v1/instant-delivery /var/lib/prhm-agent-selfmaint-exec/safe-delivery-profile-enable-next-v1"));
  assert.ok(out.includes("if(action==='safe_delivery_profile_enable_next_v1')return applySafeDeliveryProfileEnableNextV1();"));
  for(const bad of ['req.body.command','arbitrary_path','eval(','child_process.exec('])assert.equal(out.includes(bad),false);
});

test('helper strictly binds existing profile primitive, health contracts and exact rollback',()=>{
  const h=m.buildHelperSource();
  assert.ok(h.includes("PROFILE_MODULE_SHA256 = '700c8e0e7374a03021b5e45b3e624f8c2e834a73f176546cd9bb5dfc04af5825'"));
  assert.ok(h.includes("STATE_FILE = path.join(STATE_ROOT, 'profile-enablement.json')"));
  assert.ok(h.includes("safe_delivery_state_non_contiguous"));
  assert.ok(h.includes("safe_delivery_rollout_baseline_regressed"));
  assert.ok(h.includes("cfpark-frontend.service"));
  assert.ok(h.includes("titan-front.service"));
  assert.ok(h.includes("IMOTION_SCRIPT_SHA256 = 'd8cf5911d40cc52f4891993e6961a766c851d1984bb94b9c4adb37db0c761cb9'"));
  assert.ok(h.includes('atomicRestore(before.bytes, before.st)'));
  assert.ok(h.includes('safe_delivery_rollback_sha_mismatch'));
  assert.ok(h.includes('production_application_mutation:false'));
  assert.equal(h.includes('process.argv'),false);
  assert.equal(h.includes('process.env.TARGET'),false);
});

test('installer accepts independent canonical/candidate MCP baselines and restarts owners with rollback',()=>{
  assert.deepEqual(m.SERVICES,['prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp-safe-delivery-candidate.service']);
  const src=m.install.toString();
  assert.ok(src.includes('preflight'));
  assert.ok(src.includes('backupDir'));
  assert.ok(src.includes("runSystemctl(['restart',service])"));
  assert.ok(src.includes('installer_rollback_sha_mismatch'));
  const planSrc=m.buildInstallPlan.toString();
  assert.equal(planSrc.includes('mcp_source_parity_mismatch'),false);
  assert.equal(src.includes('process.argv'),false);
});
