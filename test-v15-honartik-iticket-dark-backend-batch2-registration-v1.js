const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const mod=require('./bootstrap-host-actions-v15-honartik-iticket-dark-backend-batch2-registration-v1.js');
const ACTION='honartik_iticket_dark_backend_batch2_v1';

test('registration patches the four control-plane surfaces without disturbing Batch1',()=>{
  const base="const HOST_ACTION_V2={\n  honartik_iticket_dark_backend_batch1_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch1_v1', rollback: 'host-action-v2:honartik-iticket-dark-backend-batch1-v1:worktree-file-rollback' },\n};\n";
  const executor="const HOST_ACTION_V2_SPECS={\n  honartik_iticket_dark_backend_batch1_v1:{operation:'host_action.honartik_iticket_dark_backend_batch1_v1',kind:'honartik_iticket_dark_backend_batch1_v1'},\n};\n"+
  "const HONARTIK_ITICKET_BATCH1_HELPER='/opt/prhm-agent-selfmaint-exec/actions/honartik-iticket-dark-backend-batch1-v1.js';\n"+
  "function verifyProcessSandboxV2(){}\n"+
  "const applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){if(action==='honartik_iticket_dark_backend_batch1_v1')return applyHonartikIticketDarkBackendBatch1V1();return applyHostActionV2Original(action);};\n";
  const mcp="const HostActionV2=z.enum(['agent_zero_downtime_bootstrap_v1','honartik_iticket_dark_backend_batch1_v1','host_action_v2_installer_v1']);\n";
  const policy=JSON.stringify({version:'old',operations:{'host_action.honartik_iticket_dark_backend_batch1_v1':{level:4}},typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'honartik_iticket_dark_backend_batch1_v1',risk:'critical',operation:'host_action.honartik_iticket_dark_backend_batch1_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]},null,2)+'\n';
  const out=mod.buildPatchedFrom({base,executor,mcp,policy});
  for(const key of ['base','executor','mcp','policy']) assert.match(out[key],new RegExp(ACTION));
  assert.match(out.executor,/applyHonartikIticketDarkBackendBatch2V1/);
  assert.match(out.executor,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(out.executor,/RestrictNamespaces=true/);
  assert.doesNotMatch(out.executor,/RestrictSUIDSGID=true/);
  assert.doesNotMatch(out.executor,/LockPersonality=true/);
  assert.match(out.executor,/ITICKET_BATCH2_DARK_NETWORK_TEST=PASS/);
  assert.match(out.executor,/ITICKET_RESELLER_ORDER_ADAPTER_TEST=PASS/);
  const p=JSON.parse(out.policy);
  assert.equal(p.operations['host_action.'+ACTION].level,4);
  assert.equal(p.typed_scopes.filter(x=>x.action===ACTION).length,1);
});

test('registration fails closed on missing or duplicate structural anchors',()=>{
  assert.throws(()=>mod.patchMcp("const HostActionV2=z.enum(['x']);\n"),/mcp_batch1_anchor/);
  const dup="const HostActionV2=z.enum(['honartik_iticket_dark_backend_batch1_v1']);\nconst HostActionV2=z.enum(['honartik_iticket_dark_backend_batch1_v1']);\n";
  assert.throws(()=>mod.patchMcp(dup),/mcp_enum_anchor_invalid/);
});

test('embedded Batch2 helper is exact SHA-bound and registration scope excludes Honartik production app mutation',()=>{
  assert.equal(mod.HELPER_SHA,'439f5589a33d8ac89760af63b4722fc081684e26ac720d8e31a8d2ba0a870a8a');
  assert.equal(mod.verifyEmbeddedHelper(),true);
  const src=require('node:fs').readFileSync(require.resolve('./bootstrap-host-actions-v15-honartik-iticket-dark-backend-batch2-registration-v1.js'),'utf8');
  for(const forbidden of ['domains/honartik.ir/public_html','domains/dashboard.honartik.ir/public_html','curl ','wget ','ITICKET_API_ACCESS_TOKEN']) assert.equal(src.includes(forbidden),false,forbidden);
  assert.match(src,/production_application_tree_mutation:false/);
  assert.match(src,/database_mutation:false/);
  assert.match(src,/external_network:false/);
  assert.match(src,/token_read:false/);
});
