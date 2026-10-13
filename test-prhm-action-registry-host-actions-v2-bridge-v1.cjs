'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const g=require('./prhm-action-registry-gateway-v1.cjs');
const PRE=Object.freeze({
 base:Buffer.from('base-owners-v1'),executor:Buffer.from('executor-owners-v1'),
 policy:Buffer.from('approval-policy-v1'),mcp:Buffer.from('mcp-runtime-v1')
});
const POST=Object.freeze({
 base:Buffer.from('base-owners-v2'),executor:Buffer.from('executor-owners-v2'),
 policy:Buffer.from('approval-policy-v2'),mcp:Buffer.from('mcp-runtime-v2')
});
const ASSET='/opt/prhm-agent-selfmaint-exec/actions/sample-action-v1.cjs';
const ASSET_BYTES=Buffer.from('sample fixture reviewed source only');
function fixture(project='honartik'){
 const action=project+'_config_center_readonly_enroll_v1';
 const source='a'.repeat(40);
 const manifest={
  schema_version:'prhm.action-registry.release.v1',git_path:'manifests/'+project+'-registration.json',
  project,action,source_commit:source,risk:'critical',approval_level:4,
  rollback_required:true,
  registry_owners:Object.fromEntries(Object.keys(g.OWNER_PATHS).map(x=>
   [x,{path:g.OWNER_PATHS[x],before_sha256:g.sha(PRE[x]),after_sha256:g.sha(POST[x])}])),
  assets:[{path:ASSET,sha256:g.sha(ASSET_BYTES)}],
  health:{services:['prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
   'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'],tool:action}
 };
 const bytes=Buffer.from(JSON.stringify(manifest));
 const input={action:g.ACTION,project,source_commit:source,manifest_sha256:g.sha(bytes)};
 let calls={installer:0,audit:0};
 const trusted={
  readPinnedGitManifest:()=>({path:manifest.git_path,bytes}),
  readLiveOwner:p=>PRE[Object.keys(g.OWNER_PATHS).find(x=>g.OWNER_PATHS[x]===p)],
  readStagedAsset:p=>p===ASSET?ASSET_BYTES:null,
  getInstaller:()=>async()=>{calls.installer++;return{ok:true,rollback:'not_needed',installedAssets:1,updatedOwners:4}},
  getToolDiscovery:async()=>true,
  writeMetadataAudit:async()=>{calls.audit++}
 };
 return {input,manifest,trusted,calls};
}
test('typed registration requires exactly four immutable fields',()=>{
 let {input}=fixture();
 const out=bridge.strictRequest(input);
 assert.equal(out.arguments_sha256,g.approvalBindingSha(input));
 for(const b of [{...input,command:'id'},{...input,project:'../../root'},
   {...input,source_commit:'latest'},{...input,manifest_sha256:'0'}]){
  assert.throws(()=>bridge.strictRequest(b),/typed_registry_|registry_gateway_/);
 }
});
test('Approval Center typed request contains entire project+Git+manifest binding',()=>{
 const {input}=fixture(),p=bridge.typedApprovalRequest(input);
 assert.equal(p.arguments_sha256,g.approvalBindingSha(input));
 assert.deepEqual(p.arguments,input);
 assert.equal(p.ttl_seconds,180);
 assert.equal(p.operation,g.OPERATION);
 assert.equal(p.risk,'critical');
 assert.equal(p.rollback_reference.includes('verified-four-owner-restore'),true);
});
test('one project approval hash cannot be used for another',()=>{
 const a=bridge.typedApprovalRequest(fixture('honartik').input);
 const b=bridge.typedApprovalRequest(fixture('moeinshow').input);
 assert.notEqual(a.arguments_sha256,b.arguments_sha256);
});
test('signed confirmation must stay level 4 and SHA bound',()=>{
 const f=fixture(),issued={
   action:g.ACTION,level:4,risk:'critical',execution_authorized:true,
   one_time_use:true,request_id:'00000000-0000-4000-8000-000000000001',
   arguments_sha256:g.approvalBindingSha(f.input)
 };
 assert.equal(bridge.validateReceipt(f.input,'CONFIRM_LEVEL_4_CRITICAL',issued).request_id,
   issued.request_id);
 assert.throws(()=>bridge.validateReceipt(f.input,'CONFIRM_LEVEL_3_PRODUCTION',issued),
   /critical_confirmation_required/);
 assert.throws(()=>bridge.validateReceipt(f.input,'CONFIRM_LEVEL_4_CRITICAL',
   {...issued,arguments_sha256:'0'.repeat(64)}),/receipt_binding_invalid/);
 assert.throws(()=>bridge.validateReceipt(f.input,'CONFIRM_LEVEL_4_CRITICAL',
   {...issued,one_time_use:false}),/receipt_binding_invalid/);
});
test('immutable release verifies real fixed manifest bytes and all owner and asset SHAs',()=>{
 const f=fixture();
 const release=bridge.immutableManifest(f.input,f.trusted);
 assert.equal(release.normalized.project,'honartik');
 assert.equal(release.normalized.action,'honartik_config_center_readonly_enroll_v1');
 assert.equal(release.manifest_sha256,f.input.manifest_sha256);
});
test('preflight rejects source path drift, modified or missing asset',()=>{
 const a=fixture();
 assert.throws(()=>bridge.immutableManifest(a.input,{
  ...a.trusted,readPinnedGitManifest:()=>({path:'manifests/foreign-registration.json',
  bytes:Buffer.from(JSON.stringify(a.manifest))})}),/manifest_project_or_path_mismatch/);
 assert.throws(()=>bridge.immutableManifest(a.input,{
  ...a.trusted,readStagedAsset:()=>Buffer.from('unexpected')}),/asset_sha_drift/);
});
test('client cannot supply arbitrary installer path or executable capability',()=>{
 const f=fixture();
 assert.throws(()=>bridge.immutableManifest(f.input,{
  readPinnedGitManifest:()=>({path:f.manifest.git_path,bytes:Buffer.from(JSON.stringify(f.manifest))})}),
  /trusted_capability_missing/);
 assert.equal(Object.hasOwn(bridge,'executeShell'),false);
});
test('missing or fabricated signed token never invokes installer',async()=>{
 const f=fixture();
 await assert.rejects(bridge.applyAfterConsumption({
  input:f.input,approvalToken:'approved',capabilities:f.trusted
 }),/signed_l4_token_missing/);
 assert.equal(f.calls.installer,0);
});
