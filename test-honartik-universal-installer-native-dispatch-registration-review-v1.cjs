'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const R=require('./honartik-universal-installer-native-dispatch-registration-review-v1.cjs');
const P=require('./honartik-universal-installer-owner-registration-candidate-v1.cjs');
const H='// PRHM217 SYNTHETIC TEST ONLY\n';
const base=H+"const HOST_ACTION_V2_SPECS={\n"+
 "  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },\n"+
 "};\nconst HOST_ACTION_V2_LEVEL3 = new Set(['leadops_language_gate_v1']);\n"+
 "function hostActionV2ApprovalMeta(action){return null;}\n";
const executor=H+"const HOST_ACTION_V2_SPECS={\n"+
 "  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},\n"+
 "};\napplyHostActionV2=async function(action){return applyHostActionV2Original(action);};\n"+
 "const health={host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS)};\n"+
 "const authz=await callBase('/v2/host-actions/authorize-consume','POST',{action,approval_token:token});\n"+
 "const result=await applyHostActionV2(action);\n";
const mcp=H+"const HostActionV2=z.enum(['leadops_language_gate_v1','host_action_v2_installer_v1']);\n";
const fixture=()=>({base,executor,mcp});
const shim=()=>fs.readFileSync(require('node:path').join(__dirname,R.SHIM));
test('review can use exactly one fixed reviewed native root shim',()=>{
 assert.equal(R.REVIEW_ONLY,true);
 assert.equal(R.PRODUCTION_INSTALL_AUTHORIZED,false);
 assert.equal(R.SHIM_ROOT,
 '/opt/prhm-agent-selfmaint-exec/actions/honartik-universal-installer-native-dispatch-trust-v1.cjs');
});
test('synthetic 3-owner plan forwards only Level4 exact action, no live writes',
 {skip:process.getuid?.()===0},()=>{
 const out=R.previewIsolatedSynthetic(fixture(),shim());
 assert.equal(out.security_boundary.level4_only,true);
 assert.equal(out.security_boundary.production_mutation,false);
 assert.equal(out.security_boundary.trusted_root_registration_complete,false);
 const src=out.proposed_owner_text.executor;
 assert.equal(src.includes('native_root_dispatch_not_reviewed'),false);
 assert.match(src,/runFixedRegisteredAction\(l4Binding\)/);
 assert.match(src,/confirmation!=='CONFIRM_LEVEL_4_CRITICAL'/);
 assert.match(src,/authorization_consumed:authz.valid===true&&authz.consumed===true/);
 assert.match(src,/expectedId!==requestId/);
 const original=P.previewIsolatedSyntheticFixture(fixture());
 assert.equal(out.proposed_owner_text.base,original.proposed_owner_text.base);
 assert.equal(out.proposed_owner_text.mcp,original.proposed_owner_text.mcp);
 assert.equal(src.split('runFixedRegisteredAction').length,2);
});
test('tampered native shim is always rejected',
 {skip:process.getuid?.()===0},()=>{
 assert.throws(()=>R.previewIsolatedSynthetic(fixture(),Buffer.concat([shim(),Buffer.from('X')])),
 /shim_git_blob_drift/);
 assert.throws(()=>R.previewIsolatedSynthetic(fixture(),null),/shim_git_blob_drift/);
});
test('candidate cannot be produced from unpinned or ambiguous installed owner bytes',()=>{
 assert.throws(()=>R.previewPinnedProduction(()=>Buffer.from('tampered'),()=>shim()),
 /owner_sha_drift_base/);
 assert.throws(()=>R.previewPinnedProduction(()=>Buffer.alloc(0),()=>shim()),
 /owner_bytes_unavailable_base/);
 assert.throws(()=>R.previewPinnedProduction(()=>Buffer.from('x'),null),
 /shim_reader_required/);
});
test('duplicate original root dispatch is rejected by exact original anchor',
 {skip:process.getuid?.()===0},()=>{
 const f=fixture();f.executor=f.executor.replace(
 "const result=await applyHostActionV2(action);",
 "const result=await applyHostActionV2(action);\nconst result=await applyHostActionV2(action);");
 assert.throws(()=>R.previewIsolatedSynthetic(f,shim()),
 /ambiguous_executor_v2_apply_call/);
});
test('other caller actions can never turn into Level3 or register Production',
 {skip:process.getuid?.()===0},()=>{
 const f=fixture();f.base=f.base.replace(
 "new Set(['leadops_language_gate_v1']",
 "new Set(['honartik_universal_installer_upgrade_v1','leadops_language_gate_v1']");
 assert.throws(()=>R.previewIsolatedSynthetic(f,shim()),
 /operation_misclassified_as_level3/);
 for(const method of ['install','execute','issueL4','consumeL4','writeOwner','runCommand'])
  assert.equal(R[method],undefined);
});
