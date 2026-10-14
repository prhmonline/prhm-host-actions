'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const fs=require('node:fs');
const M=require('./manifests/honartik-shared-registry-v2-sidecar-unit-stage-v1.json');
const U=require('./prhm-action-registry-v2-sidecar-unit-review-v1.cjs');
const B=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const sha=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
function original(commit,file){
 const result=cp.spawnSync('git',['show',commit+':'+file],
  {cwd:__dirname,timeout:10000,maxBuffer:500000});
 assert.equal(result.status,0,'immutable Git file missing: '+file);
 return result.stdout;
}
test('sidecar service unit, review function and regression source SHA are immutable Git objects',()=>{
 assert.equal(M.schema,'prhm.honartik.shared-registry-v2.sidecar-unit-stage.v1');
 assert.equal(M.status,'NOT_STAGED');
 assert.equal(M.source_units.length,3);
 assert.equal(M.dedicated_unit,U.DEST.split('/').pop());
 assert.equal(M.destination,U.DEST);
 assert.equal(M.reviewed_runtime_closure_count,27);
 for(const src of M.source_units){
  assert.match(src.source_commit,/^[a-f0-9]{40}$/);
  assert.equal(sha(original(src.source_commit,src.source_path)),
   src.git_blob_sha1);
 }
 assert.equal(M.source_units[0].git_blob_sha1,U.REVIEWED_BLOB);
 const reviewed=U.review(original(M.source_units[0].source_commit,
  M.source_units[0].source_path));
 assert.equal(reviewed.review_passed,true);
 assert.equal(reviewed.installation_authorized,false);
});
test('sidecar cannot accidentally be described as approved or installed',()=>{
 for(const k of ['installed','enabled','service_started',
  'production_mutation','l4_requested','l4_consumed',
  'operational_private_receipt_access_attested',
  'authenticated_blue_green_discovery_attested',
  'independent_runner_12_capability_installed']){
  assert.equal(M[k],false,k);
 }
 assert.equal(M.non_installable_without_signed_five_field_bootstrap,true);
 assert.equal(M.review_status,'GIT_AND_CI_ONLY');
 // The current independent runner is deliberately NOT an executable
 // standalone registrar; it requires the full existing signed 12-function
 // Host Actions bridge before any Owner update, restart or discovery.
 assert.throws(()=>B.attestExistingRoute({}),/trusted_capability_missing_/);
});
