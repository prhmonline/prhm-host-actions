'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {BASELINE,reviewMetadata,ROOT_REGISTRATION_ALLOWED,APPLICATION_DEPLOY_ALLOWED}=
 require('./honartik-u06-owner-root-preimages-v1.cjs');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifests/honartik-u06-owner-root-preimages-20261111.json')));
function example(){
 return {
  host:BASELINE.host,profile_sha256:BASELINE.profile_sha256,adapter_sha256:BASELINE.adapter_sha256,
  files:Object.fromEntries(Object.entries(BASELINE.owners).map(([k,v])=>
   [k,{path:v.path,sha256:v.sha256,uid:v.uid,gid:v.gid,mode:v.mode,size:v.size,regular_file:true,symlink:false}]))
 };
}
test('exact four owner root SHA/modes match provided console evidence',()=>{
 assert.equal(Object.keys(BASELINE.owners).length,4);
 for(const entry of manifest.owner_files){
  const p=BASELINE.owners[entry.key];
  assert.equal(p.path,entry.path);
  assert.equal(p.sha256,entry.sha256);
  assert.equal(p.mode,entry.mode);
  assert.equal(p.size,entry.bytes);
  assert.equal(p.uid,0);
  assert.equal(p.gid,0);
 }
 assert.equal(BASELINE.host,manifest.host);
 assert.equal(BASELINE.action,manifest.operation);
 assert.equal(BASELINE.profile_sha256,manifest.expected_policy_sha);
 assert.equal(BASELINE.adapter_sha256,manifest.expected_adapter_sha);
});
test('matching metadata cannot authorize privilege or deployment',()=>{
 const r=reviewMetadata(example());
 assert.equal(r.source_claims_match,true);
 assert.equal(r.authorized_root_registry_installer,false);
 assert.equal(r.native_root_action_installed,false);
 assert.equal(r.production_writes_allowed,false);
 assert.equal(ROOT_REGISTRATION_ALLOWED,false);
 assert.equal(APPLICATION_DEPLOY_ALLOWED,false);
});
test('changed SHA, owner uid, mode, size or path fails closed',()=>{
 for(const [key,val] of [['sha256','a'.repeat(64)],['uid',99],['mode','0777'],['size',0],['path','/etc/passwd'],['regular_file',false],['symlink',true]]){
  const v=example(); v.files.agent_api[key]=val;
  assert.throws(()=>reviewMetadata(v),/owner_preimage_drift_agent_api/);
 }
});
test('missing owner or extra unexpected keys fail',()=>{
 const v=example();delete v.files.agent3_mcp;
 assert.throws(()=>reviewMetadata(v),/owner_count_or_shape/);
 const x=example();x.extra=true;
 assert.throws(()=>reviewMetadata(x),/shape/);
});
test('changed profile/adapter SHA or host rejected',()=>{
 for(const key of ['host','profile_sha256','adapter_sha256']){
  const e=example();e[key]='bad';
  assert.throws(()=>reviewMetadata(e),/host_or_universal_sha_drift/);
 }
});
test('metadata supplied by caller is never a signed proof',()=>{
 const e=example();e.files.root_executor.authenticated=true;
 assert.throws(()=>reviewMetadata(e),/file_shape_root_executor/);
 assert.equal(manifest.native_action_installed,false);
 assert.equal(manifest.root_operation_authorized,false);
 assert.equal(manifest.application_deployment_allowed,false);
});
