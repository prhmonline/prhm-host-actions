'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BOOT=path.join(__dirname,'bootstrap-host-actions-selfmaint-exec-route-refresh-v1.js');

test('registers selfmaint_exec_route_refresh_v1 as Level-4 fixed action only',()=>{
  assert.equal(fs.existsSync(BOOT),true,'bootstrap implementation missing');
  const b=require(BOOT);
  const base="  control_plane_typed_bootstrap_transport_v1: { operation: 'host_action.control_plane_typed_bootstrap_transport_v1', rollback: 'host-action-v2:control-plane-typed-bootstrap-transport-v1:journal-restore' },";
  const ex="  control_plane_typed_bootstrap_transport_v1:{operation:'host_action.control_plane_typed_bootstrap_transport_v1',kind:'control_plane_typed_bootstrap_transport_v1'},\nconst applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){return applyHostActionV2Original(action);};";
  const mcp="const HostActionV2=z.enum(['control_plane_typed_bootstrap_transport_v1']);";
  const policy=JSON.stringify({operations:{'host_action.control_plane_typed_bootstrap_transport_v1':{level:4}},typed_scopes:[]});
  const out=b.buildPatchedFrom({base,executor:ex,mcp,policy});
  assert.match(out.base,/selfmaint_exec_route_refresh_v1/);
  assert.match(out.executor,/selfmaint_exec_route_refresh_v1/);
  assert.match(out.mcp,/selfmaint_exec_route_refresh_v1/);
  const p=JSON.parse(out.policy);
  assert.equal(p.operations['host_action.selfmaint_exec_route_refresh_v1'].level,4);
  assert.equal(p.operations['host_action.selfmaint_exec_route_refresh_v1'].requires_second_confirmation,true);
  assert.equal(p.operations['host_action.selfmaint_exec_route_refresh_v1'].one_time_use,true);
});

test('executor action has no arbitrary input and schedules only prhm-agent-selfmaint-exec.service',()=>{
  const b=require(BOOT);
  const block=b.executorBlock();
  assert.match(block,/prhm-agent-selfmaint-exec\.service/);
  assert.match(block,/--on-active=2s/);
  assert.match(block,/systemd-run/);
  assert.doesNotMatch(block,/req\.body|input\.service|body\.service|spawn\([^)]*shell|execSync/);
  assert.doesNotMatch(block,/prhm-agent-api\.service|prhm-agent-mcp\.service|prhm-agent-selfmaint\.service/);
});

test('registration patch is fail-closed on missing structural anchors',()=>{
  const b=require(BOOT);
  assert.throws(()=>b.patchBase('no anchor'),/base_anchor_invalid/);
  assert.throws(()=>b.patchExecutor('no anchor'),/executor_spec_anchor_invalid/);
  assert.throws(()=>b.patchMcp('const HostActionV2=z.enum([]);'),/mcp_anchor_invalid/);
});

test('approval policy remains world-readable for DynamicUser approval service',()=>{
  const src=fs.readFileSync(require.resolve('./bootstrap-host-actions-selfmaint-exec-route-refresh-v1.js'),'utf8');
  assert.match(src,/atomic\(PATHS\.policy,Buffer\.from\(patched\.policy\),0o644\)/);
});
