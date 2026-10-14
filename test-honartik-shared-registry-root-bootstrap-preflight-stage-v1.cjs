'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const manifest=require('./manifests/honartik-shared-registry-root-bootstrap-preflight-stage-v1.json');
const sandbox=require('./manifests/honartik-shared-registry-trusted-host-io-stage-v1.json');
const closure=require('./manifests/honartik-shared-registry-bootstrap-source-closure-v1.json');
test('reviewed provisioning preflight has a fixed Git blob and cannot stage or approve',()=>{
 assert.equal(manifest.schema,'prhm.shared-registry.root-bootstrap-preflight-stage.v1');
 assert.equal(manifest.repo,'prhmonline/prhm-host-actions');
 assert.equal(manifest.source_commit,'4b9f8a861e521ee945987a91a24a4ab2577c72af');
 const cmd=cp.spawnSync('git',['show',manifest.source_commit+':'+manifest.preflight_source_path],{
  cwd:__dirname,timeout:15000,maxBuffer:1000000});
 assert.equal(cmd.status,0);
 const sha=crypto.createHash('sha1').update(Buffer.from('blob '+cmd.stdout.length+'\0'))
  .update(cmd.stdout).digest('hex');
 assert.equal(sha,manifest.preflight_git_blob_sha1);
 assert.equal(manifest.destination,
  '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/'+manifest.preflight_source_path);
 assert.equal(manifest.stage_status,'NOT_STAGED');
 assert.equal(manifest.root_directory_provisioned,false);
 assert.equal(manifest.production_mutation,false);
 assert.equal(manifest.readonly_preflight,true);
 assert.equal(manifest.require_fresh_level4,true);
 assert.equal(manifest.signed_five_field_route_installed,false);
});
test('nine narrow RW paths, eight precisely identified missing roots, no broad staging parent',()=>{
 assert.equal(manifest.fixed_required_dir_count,8);
 assert.equal(manifest.live_missing_directories,8);
 assert.equal(manifest.exact_transient_writepath_count,9);
 assert.equal(manifest.staging_parent_write_scope,'PARENT_READ_ONLY_CHILD_RW_ONLY');
 const runnerAsset=sandbox.assets.find(x=>x.source_path==='prhm-action-registry-independent-runner-contract-v1.cjs');
 assert.ok(runnerAsset&&/^[a-f0-9]{40}$/.test(sandbox.host_io_source_commit));
 const out=cp.spawnSync('git',['show',sandbox.host_io_source_commit+':'+runnerAsset.source_path],
  {cwd:__dirname,timeout:15000,maxBuffer:1000000});
 assert.equal(out.status,0);
 const blob=crypto.createHash('sha1').update(Buffer.from('blob '+out.stdout.length+'\0'))
  .update(out.stdout).digest('hex');
 assert.equal(blob,runnerAsset.git_blob_sha1);
 assert.equal(closure.status,'NOT_STAGED');
});
