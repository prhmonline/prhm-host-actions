const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const installer=require('./bootstrap-host-actions-v17-honartik-iticket-pretoken-prepare-v1.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('installer is SHA-bound to current live control-plane and exact helper',()=>{
  assert.equal(installer.ACTION,'honartik_iticket_pretoken_prepare_v1');
  assert.equal(installer.OPERATION,'host_action.honartik_iticket_pretoken_prepare_v1');
  assert.deepEqual(installer.BASELINE,{
    base:'a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315',
    executor:'1faccf7f9616cab326000f05845e7d09ccc0c81228c1175a39dcbdea87186be2',
    mcp:'ecc6e5527f574b98a023b4103e93d7caa2f80671fa273ea039fb921151f4100a',
    policy:'494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70'
  });
  const helper=fs.readFileSync(__dirname+'/honartik-iticket-pretoken-prepare-v1.js');
  assert.equal(installer.HELPER_SHA,sha(helper));
});

test('base patch registers action and classifies it Level-3 only',()=>{
  const src=`const HOST_ACTION_V2_SPECS = Object.freeze({\n  honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1', rollback: 'host-action-v2:honartik-iticket-batch2-result-bridge-helper-refresh-v1:helper-file-rollback' },\n  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'x' }\n});\nconst HOST_ACTION_V2_LEVEL3 = new Set(["honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1","imotion_marketing_target_register_v1"]);`;
  const out=installer.patchBase(src);
  assert.match(out,/honartik_iticket_pretoken_prepare_v1: \{ operation: 'host_action\.honartik_iticket_pretoken_prepare_v1'/);
  assert.match(out,/"honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1","honartik_iticket_pretoken_prepare_v1","imotion_marketing_target_register_v1"/);
});

test('executor patch runs helper in an AF_UNIX sandbox and validates pre-token result',()=>{
  const src=`const HOST_ACTION_V2_SPECS=Object.freeze({\n  honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1:{operation:'host_action.honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1',kind:'honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1'},\n  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'}\n});\nconst IMOTION_CREDENTIAL_BIND_HELPER='/x';\napplyHostActionV2=async function(action){if(action==='honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1')return applyHonartikIticketBatch2ResultBridgeHelperRefreshV1();if(action==='selfmaint_exec_route_refresh_v1')return applySelfmaintExecRouteRefreshV1();return applyHostActionV2Original(action);};`;
  const out=installer.patchExecutor(src);
  assert.match(out,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(out,/ReadWritePaths=\/home\/honartik\/worktrees/);
  assert.match(out,/production_application_tree_mutation!==false/);
  assert.match(out,/external_network!==false/);
  assert.match(out,/token_read!==false/);
  assert.match(out,/origin_branch_verified!==true/);
  assert.match(out,/if\(action==='honartik_iticket_pretoken_prepare_v1'\)return applyHonartikIticketPretokenPrepareV1\(\)/);
});

test('MCP and policy patches expose only fixed Level-3/high action',()=>{
  const mcp="const HostActionV2=z.enum(['honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1','host_action_v2_installer_v1']);";
  const mout=installer.patchMcp(mcp);
  assert.match(mout,/'honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1','honartik_iticket_pretoken_prepare_v1','host_action_v2_installer_v1'/);
  const policy=JSON.stringify({operations:{'host_action.honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1':{level:3,risk:'high'}},typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1',risk:'high',operation:'host_action.honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]});
  const p=JSON.parse(installer.patchPolicy(policy));
  assert.equal(p.operations['host_action.honartik_iticket_pretoken_prepare_v1'].level,3);
  assert.equal(p.operations['host_action.honartik_iticket_pretoken_prepare_v1'].risk,'high');
  const scope=p.typed_scopes.find(x=>x.action==='honartik_iticket_pretoken_prepare_v1');
  assert.deepEqual(scope,{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'honartik_iticket_pretoken_prepare_v1',risk:'high',operation:'host_action.honartik_iticket_pretoken_prepare_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
});
