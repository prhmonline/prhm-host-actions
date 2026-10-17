'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const p=require('./honartik-iticket-current-owner-structural-preflight-v2.cjs');

const base=()=>`'use strict';
const HOST_ACTION_V2_SPECS = Object.freeze({
  control_plane_current_owner_binding_refresh_v1: { operation: 'host_action.control_plane_current_owner_binding_refresh_v1', rollback: 'trusted-rollback' },
  honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1', rollback: 'helper-file-rollback' },
  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },
  imotion_marketing_target_register_v1: { operation: 'host_action.imotion_marketing_target_register_v1', rollback: 'trusted-rollback' }
});
const HOST_ACTION_V2_LEVEL3=new Set(['host_action_v2_installer_v1']);
function hostActionV2ApprovalMeta(action){const spec=HOST_ACTION_V2_SPECS[String(action||'')];const level=HOST_ACTION_V2_LEVEL3.has(action)?3:4;return {spec,level}}
`;
const exec=()=>`'use strict';
const HOST_ACTION_V2_SPECS = Object.freeze({
  control_plane_current_owner_binding_refresh_v1:{operation:'host_action.control_plane_current_owner_binding_refresh_v1',kind:'control_plane_current_owner_binding_refresh_v1'},
  honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1:{operation:'host_action.honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1',kind:'honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1'},
  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},
  imotion_marketing_target_register_v1:{operation:'host_action.imotion_marketing_target_register_v1',kind:'imotion_marketing_target_register_v1'}
});
let applyHostActionV2=async function(){throw Error('existing handler');};
const applyHostActionV2Original=applyHostActionV2;
async function applyControlPlaneCurrentOwnerBindingRefreshV1(){return {ok:true};}
async function applyAgentZdtSourceShaRefreshPublisherV1(){return {ok:true};}
applyHostActionV2=async function(action){if(action==='control_plane_current_owner_binding_refresh_v1')return applyControlPlaneCurrentOwnerBindingRefreshV1();if(action==='agent_zdt_source_sha_refresh_publisher_v1')return applyAgentZdtSourceShaRefreshPublisherV1();return applyHostActionV2Original(action);};
`;
const mcp=()=>`'use strict';
const z={enum:vals=>vals};
const HostActionV2=z.enum(['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1','agent_api_capability_minimize_v1','honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1','host_action_v2_installer_v1','imotion_marketing_target_register_v1','selfmaint_exec_route_refresh_v1']);
`;
const policy=()=>JSON.stringify({policy_version:'current-safe-operator-2026',
  operations:{'host_action.host_action_v2_installer_v1':{level:3},
    'host_action.agent_zero_downtime_bootstrap_v1':{level:3}},
  typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:'host_action_v2_installer_v1',risk:'high'}]},null,2)+'\n';
const fixtures=()=>({base:base(),exec:exec(),policy:policy(),mcp:mcp()});

test('patch moves from obsolete anchors to uniquely scoped CURRENT spec registries',()=>{
  const input=fixtures(),out=p.patchAll(input);
  for(const key of Object.keys(input))assert.notEqual(out[key],input[key]);
  assert.equal(out.base.split('honartik_git_worktree_fixed_v1:').length-1,1);
  assert.equal(out.exec.split('honartik_git_worktree_fixed_v1:').length-1,1);
  assert.equal(out.mcp.split("'honartik_git_worktree_fixed_v1'").length-1,1);
  assert.equal(out.exec.includes('requires_separate_signed_helper_activation'),true);
  const oldDispatch="applyHostActionV2=async function(action){if(action==='control_plane_current_owner_binding_refresh_v1')";
  assert.equal(out.exec.includes(oldDispatch),false);
  assert.equal(out.exec.includes("if(action==='control_plane_current_owner_binding_refresh_v1')"),true);
  new vm.Script(out.base);new vm.Script(out.exec);new vm.Script(out.mcp);
  assert.equal(patchPolicyTarget(out.policy).operation.level,4);
});
function patchPolicyTarget(source){
  const doc=JSON.parse(source);return {
    operation:doc.operations['host_action.honartik_git_worktree_fixed_v1'],
    scope:doc.typed_scopes.find(x=>x.action==='honartik_git_worktree_fixed_v1')
  };
}
test('security: new policy is Level4 critical typed scope, not the old Level3',()=>{
  const doc=patchPolicyTarget(p.patchPolicy(policy()));
  assert.equal(doc.operation.level,4);
  assert.equal(doc.scope.risk,'critical');
  assert.equal(doc.scope.environment,'production');
  assert.equal(doc.operation.one_time_use,undefined);
  assert.equal(doc.operation.requires_second_confirmation,undefined);
});
test('dispatcher insertion disabled and existing registration chain preserved',()=>{
  const src=exec(),out=p.patchExec(src);
  assert.ok(out.includes('const applyHostActionV2Original=applyHostActionV2;'));
  assert.ok(out.includes("if(action==='agent_zdt_source_sha_refresh_publisher_v1')"));
  assert.ok(out.includes("if(action==='honartik_git_worktree_fixed_v1')throw new Error("));
  assert.equal(out.split("applyHostActionV2=async function(action){").length-1,1);
});
test('no duplicate registry insertion is possible in any of 4 owners',()=>{
  const out=p.patchAll(fixtures());
  for(const key of ['base','exec','mcp','policy'])
    assert.throws(()=>({
      base:()=>p.patchBase(out.base),
      exec:()=>p.patchExec(out.exec),
      mcp:()=>p.patchMcp(out.mcp),
      policy:()=>p.patchPolicy(out.policy)
    })[key](),/already_registered|already_registered|dispatch_duplicate/);
});
test('fail-closed on ambiguous Base V2 dictionary declaration',()=>{
  const src=base();assert.throws(()=>p.patchBase(src+src),/anchor_count_base_declaration_2/);
});
test('fail-closed when V2 spec entry missing in scoped dictionary',()=>{
  const src=base().replace(/  host_action_v2_installer_v1: \{[^\n]*\},\n/,'');
  assert.throws(()=>p.patchBase(src),/registry_reference_count_base_0/);
});
test('fail-closed when Exec current dispatcher does not match',()=>{
  const src=exec().replace('applyHostActionV2=async function(action){','applyHostActionV2 = function(other){');
  assert.throws(()=>p.patchExec(src),/anchor_count_exec_dispatch_0/);
});
test('fail-closed when MCP z.enum is absent',()=>{
  assert.throws(()=>p.patchMcp("const Different=z.enum(['host_action_v2_installer_v1'])"),/anchor_count_mcp_enum_declaration_0/);
});
test('fail-closed when MCP actions list already includes new worktree handler',()=>{
  const src=mcp().replace("'host_action_v2_installer_v1',","'host_action_v2_installer_v1','honartik_git_worktree_fixed_v1',");
  assert.throws(()=>p.patchMcp(src),/mcp_enum_already_registered/);
});
test('fail-closed policy duplicate in operations',()=>{
  const obj=JSON.parse(policy());
  obj.operations['host_action.honartik_git_worktree_fixed_v1']={level:4};
  assert.throws(()=>p.patchPolicy(JSON.stringify(obj)),/policy_already_registered/);
});
test('fail-closed policy typed scope duplicate',()=>{
  const obj=JSON.parse(policy());obj.typed_scopes.push({action:'honartik_git_worktree_fixed_v1'});
  assert.throws(()=>p.patchPolicy(JSON.stringify(obj)),/policy_already_registered/);
});
test('fail-closed malformed policy and malformed typed scope',()=>{
  assert.throws(()=>p.patchPolicy('{'),/policy_json_invalid/);
  assert.throws(()=>p.patchPolicy('{}'),/policy_shape_invalid/);
});
test('strict byte verification stops mock owners from masquerading as production',()=>{
  const input=fixtures(),liveOwnerBytes=Object.fromEntries(Object.entries(input).map(([k,v])=>[k,Buffer.from(v)]));
  const expectedSHA=Object.fromEntries(Object.entries(liveOwnerBytes).map(([k,v])=>[k,require('node:crypto').createHash('sha256').update(v).digest('hex')]));
  assert.throws(()=>p.verify({liveOwnerBytes,expectedSHA}),/live_sha_invalid_base/);
});
test('no filesystem, execution, network, approval or install capabilities',()=>{
  assert.deepEqual(Object.keys(p).sort(),[
    'ACTION','OPERATION','registryRange','patchBase','patchExec','patchMcp','patchPolicy','patchAll','verify'
  ].sort());
  const src=fs.readFileSync(require.resolve('./honartik-iticket-current-owner-structural-preflight-v2.cjs'),'utf8');
  for(const token of ["require('fs')","require('node:fs')","require('child_process')","require('node:child_process')",
    "process.argv","process.env","systemctl restart","cp.execFileSync(","fs.writeFileSync(","fs.renameSync(","eval("])
    assert.equal(src.includes(token),false,'unexpected privileged capability '+token);
});
