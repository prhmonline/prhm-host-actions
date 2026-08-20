const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mod=require('./bootstrap-host-actions-v16-honartik-iticket-batch2-result-bridge-helper-refresh-registration-v1.js');

test('V16 registers only the fixed Batch2 result-bridge helper refresh action',()=>{
  assert.equal(mod.ACTION,'honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1');
  assert.equal(mod.OLD_HELPER_SHA,'439f5589a33d8ac89760af63b4722fc081684e26ac720d8e31a8d2ba0a870a8a');
  assert.equal(mod.NEW_HELPER_SHA,'96674bf9737395a4f180c0cba995b77e4aa9f229d36563f61ac376f624478e0e');
  assert.equal(mod.verifyEmbeddedRefreshHelper(),true);
});

test('refresh helper is SHA-bound, rollback-safe and cannot touch Honartik worktree, DB, token, deploy or network',()=>{
  const src=mod.refreshHelperSource();
  for(const needle of [mod.OLD_HELPER_SHA,mod.NEW_HELPER_SHA,'rollback','backup','latest.json']) assert.match(src,new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const forbidden of ['/home/honartik/worktrees','ITICKET_API_ACCESS_TOKEN','curl ','wget ']) assert.equal(src.includes(forbidden),false,forbidden);
  for(const needle of ['database_mutation:false','deploy:false','external_network:false','token_read:false']) assert.match(src,new RegExp(needle));
});

test('registration patch is structural and preserves existing Batch2 action while exposing V16 in all four surfaces',()=>{
  const sample={
    base:`  honartik_iticket_dark_backend_batch2_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch2_v1', rollback: 'host-action-v2:honartik-iticket-dark-backend-batch2-v1:worktree-file-rollback' },
`,
    executor:`const HOST_ACTION_V2_SPECS={
  honartik_iticket_dark_backend_batch2_v1:{operation:'host_action.honartik_iticket_dark_backend_batch2_v1',kind:'honartik_iticket_dark_backend_batch2_v1'},
};
const applyHostActionV2Original=applyHostActionV2;
applyHostActionV2=async function(action){if(action==='honartik_iticket_dark_backend_batch2_v1')return applyHonartikIticketDarkBackendBatch2V1();return applyHostActionV2Original(action);};
`,
    mcp:`const HostActionV2=z.enum(['honartik_iticket_dark_backend_batch2_v1','host_action_v2_installer_v1']);
`,
    policy:JSON.stringify({version:'x',operations:{'host_action.honartik_iticket_dark_backend_batch2_v1':{level:4,risk:'critical'}},typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'honartik_iticket_dark_backend_batch2_v1',risk:'critical',operation:'host_action.honartik_iticket_dark_backend_batch2_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]},null,2)
  };
  const out=mod.buildPatchedFrom(sample);
  for(const k of ['base','executor','mcp','policy']) assert.match(out[k],new RegExp(mod.ACTION));
  assert.match(out.executor,/honartik_iticket_dark_backend_batch2_v1/);
});
