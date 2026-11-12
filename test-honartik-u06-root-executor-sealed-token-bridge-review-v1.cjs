'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const R=require('./honartik-u06-owner-root-routing-preview-v1.cjs');
const B=require('./honartik-u06-root-executor-sealed-token-bridge-review-v1.cjs');
const SHA=x=>crypto.createHash('sha256').update(x).digest('hex');
const H='// U06 SYNTHETIC FIXTURE ONLY\n';
function source(){
 return {
  agent_api:H+"const HOST_ACTION_V2_SPECS=Object.freeze({\n"+R.A.api+
   "\n});\nconst HOST_ACTION_V2_LEVEL3 = new Set(['host_action_v2_installer_v1']);\n"+
   "function hostActionV2ApprovalMeta(action){return 4}\n",
  root_executor:H+"const HOST_ACTION_V2_SPECS=Object.freeze({\n"+R.A.executor+
   "\n});\n"+R.A.consumed+"\n"+R.A.apply+"\n"+
   "const test={host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS)};\n"+
   R.A.dispatch+"return applyHostActionV2Original(action);};\n",
  agent3_mcp:H+R.A.enum+"'host_action_v2_installer_v1']);\n",
  approval_policy:H+'{"unchanged":true}\n'
 };
}
test('one-use sealed request/JWS only forwarded after exact original authorize-consume',()=>{
 const p=B.previewSynthetic(source());
 const r=p.root_executor_candidate;
 assert.ok(r.includes(B.MARK));
 assert.equal(r.split(B.CALL).length,2);
 assert.ok(r.indexOf(R.A.consumed)<r.indexOf(B.CALL));
 assert.ok(r.includes("consumedReceipt.valid!==true||consumedReceipt.consumed!==true"));
 assert.ok(r.includes("runDedicatedU06RootBridge(requestId,token,authz)"));
 assert.ok(r.includes("u06_full_native_root_handler_not_installed"));
 assert.ok(r.includes(R.NEW.dispatch),'original direct dispatch must stay DENY');
 assert.equal(p.existing_approval_center_consume_order_preserved,true);
 assert.equal(p.u06_sealed_token_only_forwarded_after_consume,true);
 assert.equal(p.direct_apply_without_trusted_context_denied,true);
 assert.equal(p.full_native_handler_available,false);
 assert.equal(p.installation_authorized,false);
 assert.equal(p.production_mutated,false);
});
test('exact four-source registration assets remain SHA-computed, policy stays original',()=>{
 const orig=source(),o=B.previewSynthetic(orig);
 assert.ok(o.agent_api_candidate.includes('honartik_u06_native_backup_register_v1'));
 assert.ok(o.agent3_mcp_candidate.includes("'honartik_u06_native_backup_register_v1'"));
 assert.equal(o.candidate_sha256.root_executor,SHA(Buffer.from(o.root_executor_candidate)));
 assert.equal(o.candidate_sha256.agent_api,SHA(Buffer.from(o.agent_api_candidate)));
 assert.equal(o.candidate_sha256.agent3_mcp,SHA(Buffer.from(o.agent3_mcp_candidate)));
 assert.equal(o.candidate_sha256.approval_policy_unchanged,SHA(Buffer.from(orig.approval_policy)));
 assert.equal(B.ROOT_INSTALL_ALLOWED,false);
 assert.equal(B.SOURCE_ONLY,true);
 assert.equal(B.install,undefined);
});
test('synthetic missing authorize-consume or execution anchor is rejected',()=>{
 const base=source();
 let t={...base,root_executor:base.root_executor.replace(R.A.consumed,'//bad')};
 assert.throws(()=>B.previewSynthetic(t),/synthetic_control_shape|anchor_missing/);
 t={...base,root_executor:base.root_executor.replace(R.A.apply,'//no apply')};
 assert.throws(()=>B.previewSynthetic(t),/anchor_missing_or_duplicated|anchor_drift/);
 t={...base,root_executor:base.root_executor.replace(R.A.apply,
  R.A.apply+R.A.apply)};
 assert.throws(()=>B.previewSynthetic(t),/anchor_missing_or_duplicated|anchor_drift/);
});
test('never allows fixture tag to spoof real SHA-pinned owner source',()=>{
 const x=source();
 assert.throws(()=>B.preview(Object.fromEntries(
  Object.entries(x).map(([k,v])=>[k,Buffer.from(v)]))),/owner_source_drift/);
 assert.equal(B.ROOT_INSTALL_ALLOWED,false);
});
test('runtime bridge never writes approval token or authorizes shell or DB',()=>{
 const b=B.BRIDGE;
 for(const bad of ['console.log','fs.write','spawn','execFile','execSync',
  'mysql','mariadb','callBase','issueApproval','sign','return true']){
   assert.ok(!b.includes(bad),bad);
 }
 assert.ok(b.includes("throw new Error('u06_full_native_root_handler_not_installed')"));
});
