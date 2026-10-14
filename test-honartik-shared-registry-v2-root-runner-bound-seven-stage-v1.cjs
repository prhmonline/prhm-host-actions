'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const M=require('./manifests/honartik-shared-registry-v2-root-runner-bound-seven-stage-v1.json');
const root=require('./prhm-action-registry-v2-root-runner-bindings-v1.cjs');
const sha=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
test('the real seven-capability root binding and its regression source are Git-immutable',()=>{
 assert.equal(M.schema,'prhm.honartik.registry-v2.independent-root-bound-seven-stage.v1');
 assert.equal(M.status,'SOURCE_ONLY_NOT_STAGED');
 assert.equal(M.files.length,2);
 for(const f of M.files){
  assert.match(f.source_commit,/^[a-f0-9]{40}$/);
  assert.match(f.git_blob_sha1,/^[a-f0-9]{40}$/);
  const result=cp.spawnSync('git',['show',f.source_commit+':'+f.path],
   {cwd:__dirname,timeout:12000,maxBuffer:1500000});
  assert.equal(result.status,0,'missing reviewed Git object '+f.path);
  assert.equal(sha(result.stdout),f.git_blob_sha1);
 }
});
test('never publish an incomplete 12-function launcher or claim L4 was consumed',()=>{
 const i=root.inventory();
 assert.deepEqual([...i.missing_capabilities],M.missing_capabilities);
 assert.equal(i.required_capabilities.length,M.required_capability_count);
 assert.equal(i.source_capabilities.length,M.bound_capability_count);
 for(const f of ['runner_executable','production_authorized','production_mutated',
  'l4_requested','l4_consumed','full_root_runner_preflight_passed',
  'auth_discovery_preflight_passed','real_host_root_verified',
  'independent_root_signed_launcher_installed','standalone_execution_allowed'])
  assert.equal(M[f],false,f);
 assert.equal(i.complete,false);
});
