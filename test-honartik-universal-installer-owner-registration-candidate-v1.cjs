'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const P=require('./honartik-universal-installer-owner-registration-candidate-v1.cjs');
const REG=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const H='// PRHM217 SYNTHETIC TEST ONLY\n';
const base=H+
 "const HOST_ACTION_V2_SPECS={\n"+
 "  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },\n"+
 "};\nconst HOST_ACTION_V2_LEVEL3 = new Set(['leadops_language_gate_v1','host_action_v2_installer_v1']);\n"+
 "function hostActionV2ApprovalMeta(action){return null;}\n";
const executor=H+
 "const HOST_ACTION_V2_SPECS={\n"+
 "  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},\n"+
 "};\napplyHostActionV2=async function(action){return applyHostActionV2Original(action);};\n"+
 "const health={host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS)};\n";
const mcp=H+"const HostActionV2=z.enum(['leadops_language_gate_v1','host_action_v2_installer_v1']);\n";
const sample=()=>({base,executor,mcp});
const action='honartik_universal_installer_upgrade_v1';
test('operator-proven owner SHA preimages match 3-layer binding',()=>{
 assert.equal(REG.TARGETS.base.sha256,
 '4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406');
 assert.equal(REG.TARGETS.executor.sha256,
 '410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0');
 assert.equal(REG.TARGETS.mcp.sha256,
 'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166');
 assert.equal(P.ACTION,action);
 assert.equal(P.OP,'host_action.'+action);
});
test('no unreviewed/root/unverified owner content can produce a production patch',()=>{
 assert.throws(()=>P.previewOwnerPatch(()=>Buffer.from('tampered')),
  /owner_sha_drift_base/);
 assert.throws(()=>P.previewOwnerPatch(()=>null),
  /owner_bytes_unavailable_base/);
 assert.equal(P.PRODUCTION_INSTALL_AUTHORIZED,false);
 assert.equal(P.SOURCE_ONLY,true);
});
test('synthetic preview pins three owner edits, never promotes L4 to L3',
 {skip:process.getuid?.()===0},()=>{
 const p=P.previewIsolatedSyntheticFixture(sample());
 const updated=p.proposed_owner_text;
 assert.match(updated.base,/honartik_universal_installer_upgrade_v1: \{ operation: 'host_action\.honartik_universal_installer_upgrade_v1'/);
 assert.match(updated.executor,/honartik_universal_installer_upgrade_v1:\{operation:'host_action\.honartik_universal_installer_upgrade_v1'/);
 assert.match(updated.mcp,/'honartik_universal_installer_upgrade_v1'/);
 const level3=updated.base.split('const HOST_ACTION_V2_LEVEL3 = new Set(')[1].split('function hostActionV2ApprovalMeta')[0];
 assert.equal(level3.includes(action),false);
 assert.match(updated.executor,/throw new Error\('honartik_universal_installer_upgrade_v1_native_root_dispatch_not_reviewed'\)/);
 assert.equal(p.security_boundary.root_dispatch_explicitly_denied,true);
 assert.equal(p.security_boundary.install_authorized,false);
 assert.equal(p.security_boundary.live_policy_activated,false);
 assert.equal(p.security_boundary.signed_level4_available,false);
 for(const [key,value] of Object.entries(updated)){
  assert.equal(p.proposed_sha256[key],crypto.createHash('sha256').update(value).digest('hex'));
 }
});
test('missing fixed preimages and changed dispatcher are rejected',
 {skip:process.getuid?.()===0},()=>{
 const a=sample();a.base=a.base.replace('host_action_v2_installer_v1:','old_installer:');
 assert.throws(()=>P.previewIsolatedSyntheticFixture(a),/ambiguous_api_fixed_spec/);
 const b=sample();b.executor=b.executor.replace('applyHostActionV2=async function(action){','renamedDispatcher(action){');
 assert.throws(()=>P.previewIsolatedSyntheticFixture(b),/ambiguous_executor_dispatch/);
 const c=sample();c.mcp=c.mcp.replace('const HostActionV2=z.enum([','const Other=z.enum([');
 assert.throws(()=>P.previewIsolatedSyntheticFixture(c),/ambiguous_mcp_enum/);
});
test('duplicate anchored registry and already patched state are refused',
 {skip:process.getuid?.()===0},()=>{
 const a=sample();
 const anchor="  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },";
 a.base=a.base.replace(anchor,anchor+'\n'+anchor);
 assert.throws(()=>P.previewIsolatedSyntheticFixture(a),/ambiguous_api_fixed_spec/);
 const b=sample();b.mcp=b.mcp.replace("'host_action_v2_installer_v1'","'host_action_v2_installer_v1','"+action+"'");
 assert.throws(()=>P.previewIsolatedSyntheticFixture(b),/already_patched/);
});
test('accidental Level 3 whitelisting is rejected',
 {skip:process.getuid?.()===0},()=>{
 const b=sample();b.base=b.base.replace(
 "new Set(['leadops_language_gate_v1'","new Set(['"+action+"','leadops_language_gate_v1'");
 assert.throws(()=>P.previewIsolatedSyntheticFixture(b),/operation_misclassified_as_level3/);
});
test('isolated fixture must be explicitly marked, never guessed from Production',
 {skip:process.getuid?.()===0},()=>{
 assert.throws(()=>P.previewIsolatedSyntheticFixture({base:'production text',executor,mcp}),
 /fixture_not_synthetic/);
});
