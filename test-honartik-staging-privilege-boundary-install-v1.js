'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const boundary=require('./honartik-staging-privilege-boundary-install-v1.js');
function fixture(){
 const manifestBytes=Object.fromEntries(Object.entries(boundary.PINS).map(
  ([k,x])=>[k,fs.readFileSync(path.join(__dirname,x.path))]));
 return {manifestBytes,observedOwnerSha256:{...boundary.OWNERS}};
}
test('standalone Honartik development boundary reviews 35 pinned root files and unit, never approves an install',()=>{
 const r=boundary.inspectReview(fixture());
 assert.equal(r.stage_source_count,35);
 assert.equal(r.stage_sources.length,35);
 assert.equal(r.source_repo,'prhmonline/prhm-host-actions');
 assert.equal(r.signed_unit.destination,boundary.UNIT);
 assert.equal(r.signed_unit.git_blob_sha1,
  'dc87ad2937b63ab965944cef081f55a6a0984cdd');
 assert.equal(r.required_action,'prhm_action_registry_install_v1');
 for(const field of ['trusted_host_attested','root_staged',
  'signed_l4_approved','installation_authorized','action_registered',
  'production_mutated','can_request_l4','can_execute']){
  assert.equal(r[field],false,field);
 }
 assert.equal(new Set(r.stage_sources.map(f=>f.destination)).size,35);
 assert.ok(r.stage_sources.every(f=>/^[a-f0-9]{40}$/.test(f.git_blob_sha1)));
});
test('every supplied manifest is independently immutable Git-blob pinned',()=>{
 for(const key of Object.keys(boundary.PINS)){
  const f=fixture();
  const x=f.manifestBytes[key];const corrupted=Buffer.from(x);
  corrupted[Math.floor(corrupted.length/2)]^=1;
  f.manifestBytes[key]=corrupted;
  assert.throws(()=>boundary.inspectReview(f),
   new RegExp('manifest_sha_drift_'+key),key);
 }
});
test('forbid an added fourth manifest or an omitted reviewed manifest',()=>{
 const f=fixture();
 f.manifestBytes.rogue=Buffer.from('x');
 assert.throws(()=>boundary.inspectReview(f),/manifest_set/);
 const g=fixture();delete g.manifestBytes.unit;
 assert.throws(()=>boundary.inspectReview(g),/manifest_set/);
});
test('protected owner SHA mismatch blocks review before signed bootstrap',()=>{
 for(const kind of Object.keys(boundary.OWNERS)){
  const f=fixture();
  f.observedOwnerSha256[kind]='0'.repeat(64);
  assert.throws(()=>boundary.inspectReview(f),
   new RegExp('owner_sha_drift_'+kind),kind);
 }
});
test('owner set cannot be expanded to an arbitrary destination',()=>{
 const f=fixture();
 f.observedOwnerSha256['root_extra']='0'.repeat(64);
 assert.throws(()=>boundary.inspectReview(f),/owner_set/);
});
test('only bytes of the actual reviewed three manifest blobs are accepted',()=>{
 for(const key of Object.keys(boundary.PINS)){
  const f=fixture();f.manifestBytes[key]=Buffer.from('not-json');
  assert.throws(()=>boundary.inspectReview(f),/manifest_bytes_missing/);
 }
});
test('no executable or signed stage capability exposed from development source',()=>{
 assert.deepEqual(Object.keys(boundary).sort(),
  ['PINS','OWNERS','ROOT','UNIT','blob','inspectReview','install'].sort());
 assert.throws(()=>boundary.install(),/trusted_signed_root_bootstrap_required/);
 assert.equal(typeof boundary.execute,'undefined');
 assert.equal(typeof boundary.requestApproval,'undefined');
});
