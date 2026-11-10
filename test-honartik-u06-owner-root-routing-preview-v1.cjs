'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const R=require('./honartik-u06-owner-root-routing-preview-v1.cjs');
const H='// U06 SYNTHETIC FIXTURE ONLY\n';
const src=()=>({
 agent_api:H+"const HOST_ACTION_V2_SPECS=Object.freeze({\n"+R.A.api+
 "\n});\nconst HOST_ACTION_V2_LEVEL3 = new Set(['host_action_v2_installer_v1']);\n"+
 "function hostActionV2ApprovalMeta(action){return 4}\n",
 root_executor:H+"const HOST_ACTION_V2_SPECS=Object.freeze({\n"+R.A.executor+
 "\n});\n"+R.A.consumed+"\n"+R.A.apply+"\n"+
 "const test={host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS)};\n"+
 R.A.dispatch+"return applyHostActionV2Original(action);};\n",
 agent3_mcp:H+R.A.enum+"'host_action_v2_installer_v1']);\n",
 approval_policy:H+'{"unchanged":true}\n'
});
test('source is pinned to actual root SHA fingerprints, four owners',()=>{
 assert.equal(R.ACTION,'honartik_u06_native_backup_register_v1');
 assert.equal(Object.keys(R.BASELINE.owners).length,4);
 assert.equal(R.BASELINE.owners.agent_api.sha256,'57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530');
 assert.equal(R.BASELINE.owners.root_executor.sha256,'4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169');
 assert.equal(R.BASELINE.owners.agent3_mcp.sha256,'0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef');
 assert.equal(R.BASELINE.owners.approval_policy.sha256,'26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5');
});
test('read-only synthetic patch keeps all original paths and hard denies U06 execution',()=>{
 const original=src(),r=R.previewSyntheticFixture(original),out=r.source;
 assert.match(out.agent_api,/honartik_u06_native_backup_register_v1: \{ operation:/);
 assert.match(out.root_executor,/honartik_u06_native_backup_register_v1:\{operation:/);
 assert.match(out.agent3_mcp,/'honartik_u06_native_backup_register_v1'/);
 assert.match(out.root_executor,/u06_native_root_dispatch_not_installed/);
 assert.equal(out.approval_policy,original.approval_policy);
 assert.ok(out.root_executor.indexOf(R.A.consumed)<out.root_executor.indexOf(R.A.apply));
 assert.equal(out.agent_api.includes("new Set(['honartik_u06_native_backup_register_v1'"),false);
 assert.equal(r.flags.production_apply,false);
 assert.equal(R.ROOT_INSTALL_ALLOWED,false);
});
test('no trusted Root preimages can be faked with snippets',()=>{
 assert.throws(()=>R.previewExactOwnerSources(Object.fromEntries(
   Object.keys(R.BASELINE.owners).map(k=>[k,Buffer.from('pretend source')]))),/owner_source_drift/);
 assert.throws(()=>R.previewExactOwnerSources({}),/four_owner_shape/);
});
test('reject missing and duplicate anchors',()=>{
 const orig=src();
 for(const k of ['agent_api','root_executor','agent3_mcp']){
  const item={...orig};const anchor=k==='agent_api'?R.A.api:k==='root_executor'?R.A.executor:R.A.enum;
  item[k]=item[k].replace(anchor,'NOT_A_REAL_ANCHOR');
  assert.throws(()=>R.previewSyntheticFixture(item),/anchor_missing_or_duplicated/);
  const dup={...orig};dup[k]+='\n'+anchor;
  assert.throws(()=>R.previewSyntheticFixture(dup),/anchor_missing_or_duplicated/);
 }
});
test('reject L3 downgrade or approve after execution',()=>{
 const data=src();data.agent_api=data.agent_api.replace("new Set(['host_action_v2_installer_v1'])",
 "new Set(['honartik_u06_native_backup_register_v1','host_action_v2_installer_v1'])");
 assert.throws(()=>R.previewSyntheticFixture(data),/u06_promoted_to_level3/);
 const reordered=src();
 reordered.root_executor=reordered.root_executor.replace(
  R.A.consumed+'\n'+R.A.apply,R.A.apply+'\n'+R.A.consumed);
 assert.throws(()=>R.previewSyntheticFixture(reordered),/synthetic_control_shape/);
});
test('source has no shell runner or installed root entrypoint',()=>{
 assert.equal(R.PRODUCTION_APPLY_ALLOWED,false);
 assert.equal(R.SOURCE_ONLY,true);
 assert.equal(R.install,undefined);
 assert.equal(R.execute,undefined);
});
