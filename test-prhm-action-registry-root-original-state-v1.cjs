'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const V=require('./prhm-action-registry-root-original-state-v1.cjs');
const manifest=require('./manifests/honartik-config-center-registry-release-v1.json');
const SOURCE='868ec0251688e30f30691c91390589e80d4f34f9';
const MCOMMIT='e269cb8ee6f6dc1010620134a8a3ffe57d248535';
const MSHA='111c2c38b6ad48e69a6f72974855b38d0932790335931fc5b128a3c37c3f5e49';
function release(){return {
 source_commit:SOURCE,manifest_commit:MCOMMIT,manifest_sha256:MSHA,
 normalized:G.assertManifest(manifest)
}}
test('all four live owner paths and five target assets are pinned to fixed source/manifest',()=>{
 const x=V.assertRelease(release());
 assert.equal(Object.keys(x.owners).length,4);
 assert.equal(x.assets.length,5);
 assert.equal(x.action,manifest.action);
});
test('any release commit, manifest SHA or project/action drift fails before probes',()=>{
 for(const v of [
  {source_commit:'f'.repeat(40)},{manifest_commit:'f'.repeat(40)},
  {manifest_sha256:'f'.repeat(64)}
 ])assert.throws(()=>V.assertRelease({...release(),...v}),/unbound_release/);
 const item=release();
 item.normalized={...item.normalized,project:'other'};
 assert.throws(()=>V.assertRelease(item),/unbound_release/);
});
test('fabricating fewer assets or different output SHA cannot pass immutable release check',()=>{
 const one=release();
 one.normalized={...one.normalized,assets:one.normalized.assets.slice(1)};
 assert.throws(()=>V.assertRelease(one),/assets_count/);
 const two=release();
 two.normalized={...two.normalized,owners:{...two.normalized.owners,
  mcp:{...two.normalized.owners.mcp,after_sha256:'f'.repeat(64)}}};
 assert.throws(()=>V.assertRelease(two),/owner_pin_mismatch_mcp/);
});
test('real original owner bytes are mandatory; fabricated SHA claims cannot substitute',()=>{
 const x=release();let ownerReads=0,assetChecks=0;
 assert.throws(()=>V.fromProbes(x,{
  readOwner:()=>{ownerReads++;return Buffer.from('not the real owner bytes')},
  assetAbsent:()=>{assetChecks++;return true}
 }),/original_owner_unverified/);
 assert.equal(ownerReads,1);assert.equal(assetChecks,0);
});
test('unreadable owner, incorrect owner content and missing probes are rejected',()=>{
 for(const value of [null,{},'',Buffer.alloc(0)]){
  assert.throws(()=>V.fromProbes(release(),{
   readOwner:()=>value,assetAbsent:()=>true
  }),/original_owner_unverified/);
 }
 assert.throws(()=>V.fromProbes(release(),{
  readOwner:null,assetAbsent:()=>true
 }),/trusted_read_only_callbacks_missing/);
});
test('source does not expose arbitrary filesystem mutation, execution or approval APIs',()=>{
 const allowed=Object.keys(V).sort();
 assert.deepEqual(allowed,[
  'assertRelease','fromProbes','productionVerifyOriginalState'].sort());
 for(const key of ['install','write','restart','approve','execute','recover','rollback','create']){
  assert.equal(Object.hasOwn(V,key),false);
 }
});
