'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const M=require('./manifests/honartik-shared-registry-v2-root-bootstrap-layout-stage-v1.json');
const L=require('./prhm-action-registry-v2-root-bootstrap-layout-v1.cjs');
function git(args){
 const r=cp.spawnSync('git',args,{cwd:__dirname,timeout:15000,maxBuffer:2000000});
 assert.equal(r.status,0,'immutable git object missing: '+args.join(' '));
 return r.stdout;
}
function blob(b){return crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex')}
test('V2 root layout source and regression test are pinned Git blobs, not mutable HEAD',()=>{
 assert.equal(M.schema,'prhm.shared-registry.v2.root-bootstrap-layout-stage.v1');
 assert.equal(M.repo,'prhmonline/prhm-host-actions');
 assert.equal(M.stage_status,'NOT_STAGED');
 for(const x of [
  [M.source_commit,M.source_path,M.source_git_blob_sha1],
  [M.test_commit,M.test_path,M.test_git_blob_sha1]
 ]){
  const [commit,path,expected]=x;
  assert.match(commit,/^[a-f0-9]{40}$/);
  assert.match(expected,/^[a-f0-9]{40}$/);
  assert.equal(blob(git(['show',commit+':'+path])),expected);
  assert.match(git(['ls-tree',commit,'--',path]).toString(),/^100644 blob [a-f0-9]{40}\t/);
 }
 assert.equal(M.destination,
  '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2/'+M.source_path);
});
test('stage refuses to represent directory checks as installed or approved',()=>{
 const p=L.immutablePlan();
 assert.equal(p.required_dirs.length,M.expected_fixed_root_dirs);
 assert.equal(p.runner_writepath_count,M.expected_runner_writepaths);
 assert.equal(M.approval_vault_parent,p.required_dirs.find(x=>x.key==='approval_vault').path);
 assert.equal(M.approval_socket_parent,p.required_dirs.find(x=>x.key==='approval_socket').path);
 for(const field of [
   'production_modified','root_directories_provisioned','level4_requested',
   'level4_consumed','signed_five_field_route_installed','root_stager_installed',
   'root_stager_code_written'
 ])assert.equal(M[field],false,field);
 assert.equal(M.status,'READONLY_SOURCE_AND_SYNTHETIC_TESTS_ONLY');
 assert.equal(M.rollback_rule,p.rollback_rule);
 assert.equal(p.installs,false);
});
