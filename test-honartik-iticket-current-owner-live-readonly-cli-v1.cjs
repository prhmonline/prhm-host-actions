'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const p=require('./honartik-iticket-current-owner-live-readonly-cli-v1.cjs');
const original=()=>({
  base:`'use strict';
const HOST_ACTION_V2_SPECS = Object.freeze({
  control_plane_current_owner_binding_refresh_v1:{operation:'host_action.control_plane_current_owner_binding_refresh_v1',rollback:'exact-preimage'},
  agent_zero_downtime_bootstrap_v1:{operation:'host_action.agent_zero_downtime_bootstrap_v1',rollback:'backup-restore'},
  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',rollback:'four-file-restore'},
  imotion_marketing_target_register_v1:{operation:'host_action.imotion_marketing_target_register_v1',rollback:'source-bound'}
});
const HOST_ACTION_V2_LEVEL3 = new Set(['host_action_v2_installer_v1']);
function hostActionV2ApprovalMeta(action) { return {level:HOST_ACTION_V2_LEVEL3.has(action)?3:4,spec:HOST_ACTION_V2_SPECS[action]}; }
`,
  exec:`'use strict';
const HOST_ACTION_V2_SPECS=Object.freeze({
  control_plane_current_owner_binding_refresh_v1:{operation:'host_action.control_plane_current_owner_binding_refresh_v1',kind:'control_plane_current_owner_binding_refresh_v1'},
  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},
  imotion_marketing_target_register_v1:{operation:'host_action.imotion_marketing_target_register_v1',kind:'imotion_marketing_target_register_v1'}
});
let applyHostActionV2=async function(){return {ok:false};};
const applyHostActionV2Original=applyHostActionV2;
async function applyControlPlaneCurrentOwnerBindingRefreshV1(){return {ok:true};}
applyHostActionV2=async function(action){if(action==='control_plane_current_owner_binding_refresh_v1')return applyControlPlaneCurrentOwnerBindingRefreshV1();return applyHostActionV2Original(action);};
`,
  mcp:`const z={enum:x=>x};
const HostActionV2=z.enum(['agent_api_process_sandbox_v1','host_action_v2_installer_v1','selfmaint_exec_route_refresh_v1']);
`,
  policy:JSON.stringify({operations:{'host_action.host_action_v2_installer_v1':{level:3}},
    typed_scopes:[{action:'host_action_v2_installer_v1',risk:'high'}]},null,2)+'\n'
});
test('complete pure patch creates four different valid postimages without side effects',()=>{
  const i=original(),o=p.transforms(i),r=p.analyze(i);
  for(const key of Object.keys(i))assert.notEqual(o[key],i[key]);
  new vm.Script(o.base);new vm.Script(o.exec);new vm.Script(o.mcp);
  assert.equal(r.new_dispatch_is_inert,true);
  assert.equal(r.production_mutation,false);
  assert.equal(r.mcp_esm_syntax,'NOT_TESTED');
  for(const key of Object.keys(i))assert.match(r.proposed_post_sha256[key],/^[a-f0-9]{64}$/);
});
test('level 3 original and level 4 new operation in synthetically patched Base',()=>{
  const sandbox=vm.createContext({});
  const pBase=p.transforms(original()).base;
  vm.runInContext(pBase,sandbox);
  const result=vm.runInContext(
    "[hostActionV2ApprovalMeta('host_action_v2_installer_v1').level,"+
    "hostActionV2ApprovalMeta('honartik_git_worktree_fixed_v1').level]",sandbox);
  assert.deepEqual(Array.from(result),[3,4]);
});
test('existing executor route survives; new one is blocked as inert',async()=>{
  const sandbox=vm.createContext({});
  vm.runInContext(p.transforms(original()).exec,sandbox);
  assert.equal((await vm.runInContext("applyHostActionV2('control_plane_current_owner_binding_refresh_v1')",sandbox)).ok,true);
  await assert.rejects(vm.runInContext("applyHostActionV2('honartik_git_worktree_fixed_v1')",sandbox),
    /requires_separate_signed_helper_activation/);
});
for (const [name,key,needle] of [
  ['Base declaration missing','base','HOST_ACTION_V2_SPECS'],
  ['Executor spec declaration missing','exec','HOST_ACTION_V2_SPECS'],
  ['MCP declaration missing','mcp','HostActionV2'],
  ['Executor dispatcher missing','exec','applyHostActionV2=async function(action){'],
  ['Existing installed action missing','base','host_action_v2_installer_v1:']
]){
  test('failure closed: '+name,()=>{
    const i=original();i[key]=i[key].replace(needle,'_REMOVED_');
    assert.throws(()=>p.transforms(i),/READONLY_BLOCKED_/);
  });
}
test('policy duplicate action fails closed',()=>{
  const i=original(),policy=JSON.parse(i.policy);
  policy.operations['host_action.honartik_git_worktree_fixed_v1']={level:4};
  i.policy=JSON.stringify(policy);
  assert.throws(()=>p.transforms(i),/POLICY_UNEXPECTED_SHAPE_OR_DUPLICATE/);
});
test('exact intended owner SHA256 are immutable in read-only inspector',()=>{
  assert.deepEqual(p.EXPECTED,{
    base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
    exec:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
    policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
    mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
  });
});
test('no file writes, process execution, remote access, or mutation paths',()=>{
  const src=fs.readFileSync(require.resolve('./honartik-iticket-current-owner-live-readonly-cli-v1.cjs'),'utf8');
  for(const needle of ['writeFileSync(','renameSync(','spawnSync(','execFileSync(','systemctl','https.request(',
    'fs.rmSync(','unlinkSync(','chmodSync(','chownSync(','eval('])
    assert.equal(src.includes(needle),false,'forbidden operation '+needle);
});
