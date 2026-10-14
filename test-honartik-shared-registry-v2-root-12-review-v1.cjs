'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const path=require('node:path');
const m=require('./manifests/honartik-shared-registry-v2-root-12-review-v1.json');
const sha=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
test('all five additional 12-function root sources have authentic immutable Git SHA1',()=>{
 assert.equal(m.schema,'prhm.registry-v2.honartik-root-12-review.v1');
 assert.equal(m.runtime_files.length,5);
 assert.equal(m.source_functions,12);
 assert.equal(m.installed_functions,0);
 for(const f of m.runtime_files){
  assert.match(f.source_commit,/^[a-f0-9]{40}$/);
  assert.match(f.git_blob_sha1,/^[a-f0-9]{40}$/);
  const p=cp.spawnSync('git',['show',f.source_commit+':'+f.path],
   {cwd:__dirname,maxBuffer:1500000,timeout:15000});
  assert.equal(p.status,0,'unavailable reviewed object '+f.path);
  assert.equal(sha(p.stdout),f.git_blob_sha1);
 }
});
test('12-function source cannot grant production capabilities or claim a real host check',()=>{
 for(const k of ['approval_consumed','host_root_attested',
  'root_credential_provisioned','authenticated_dual_worker_probe_verified',
  'cold_recovery_drill_verified','production_authorized','production_mutation',
  'standalone_enabled'])assert.equal(m[k],false,k);
 assert.equal(m.status,'REVIEWED_SOURCE_ONLY_NOT_STAGED');
 assert.equal(m.old_runtime_files_pinned,20);
 assert.equal(m.old_root_files_pinned,7);
});
