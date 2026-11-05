'use strict';
// Only exact immutable Honartik V2 Git identity can reach the reviewed bridge.
// This is an offline contract test; does not issue/consume a Level-4 receipt.
const {test}=require('node:test'),assert=require('node:assert/strict');
const g=require('./prhm-action-registry-gateway-v1.cjs');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const release=require('./manifests/honartik-config-center-registry-release-v2.json');
const pin=require('./manifests/honartik-shared-registry-pinned-release-v2.json');
function v2(){
 return {action:g.ACTION,project:'honartik',source_commit:pin.source_commit,
  manifest_commit:pin.manifest_commit,manifest_sha256:pin.release_manifest_sha256};
}
test('fixed Honartik V2 release path and all five exact signed binding fields',()=>{
 const input=v2();
 assert.equal(bridge.assertHonartikReleaseIdentity(input,pin.release_manifest_path),
  'manifests/honartik-config-center-registry-release-v2.json');
 assert.equal(bridge.strictRequest(input).arguments_sha256,
  pin.approval_arguments_sha256);
 assert.equal(g.assertManifest(release).source_commit,pin.source_commit);
});
test('V2 rejects any source, manifest or content SHA substitution',()=>{
 const args=v2();
 for(const key of ['source_commit','manifest_commit','manifest_sha256']){
  const other={...args,[key]:key==='manifest_sha256'?'0'.repeat(64):'f'.repeat(40)};
  assert.throws(
   ()=>bridge.assertHonartikReleaseIdentity(other,pin.release_manifest_path),
   /honartik_release_manifest_path_or_sha_unexpected/);
 }
});
test('V2 refuses any arbitrary release path, including unreviewed V3',()=>{
 const args=v2();
 for(const path of [
  'manifests/honartik-config-center-registry-release-v3.json',
  '../manifests/honartik-config-center-registry-release-v2.json',
  'manifests/fake/honartik-config-center-registry-release-v2.json'
 ])assert.throws(()=>bridge.assertHonartikReleaseIdentity(args,path),
  /honartik_release_manifest_path_or_sha_unexpected/);
});
test('Honartik V1 route retained for legacy fixed readers only',()=>{
 const args={...v2(),source_commit:'a'.repeat(40),
  manifest_commit:'b'.repeat(40),manifest_sha256:'c'.repeat(64)};
 assert.equal(bridge.assertHonartikReleaseIdentity(args,
  'manifests/honartik-config-center-registry-release-v1.json'),
  'manifests/honartik-config-center-registry-release-v1.json');
 assert.throws(()=>bridge.assertHonartikReleaseIdentity(
  {...args,project:'moeinshow'},pin.release_manifest_path),/honartik_project_required/);
});
test('unsigned or unreviewed V2 cannot invoke the installer',async()=>{
 const input=v2();
 await assert.rejects(bridge.applyAfterConsumption({
  input,approvalToken:'approved',capabilities:{} }),/signed_l4_token_missing/);
});
