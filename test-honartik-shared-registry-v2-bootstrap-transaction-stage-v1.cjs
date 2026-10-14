'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const M=require('./manifests/honartik-shared-registry-v2-bootstrap-transaction-stage-v1.json');
const P=require('./prhm-action-registry-v2-bootstrap-transaction-plan-v1.cjs');
const blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
function git(args){
 const p=cp.spawnSync('git',args,{cwd:__dirname,timeout:15000,maxBuffer:5000000});
 assert.equal(p.status,0,'pinned Git object absent: '+args.join(' '));
 return p.stdout;
}
test('exact source and regression test Git blobs are pinned by separate immutable commits',()=>{
 assert.equal(M.schema,'prhm.registry-v2.bootstrap-transaction-stage.v1');
 assert.equal(M.repo,'prhmonline/prhm-host-actions');
 for(const x of [M.source,M.test]){
  assert.deepEqual(Object.keys(x).sort(),['commit','git_blob_sha1','path']);
  assert.match(x.commit,/^[a-f0-9]{40}$/);
  assert.match(x.git_blob_sha1,/^[a-f0-9]{40}$/);
  const bytes=git(['show',x.commit+':'+x.path]);
  assert.equal(blob(bytes),x.git_blob_sha1);
  assert.match(git(['ls-tree',x.commit,'--',x.path]).toString('utf8'),
   /^100644 blob [a-f0-9]{40}\t/);
 }
});
test('never misrepresent 10-dir/20-file simulated transaction as live root install',()=>{
 const p=P.immutablePlan();
 assert.equal(p.dirs.length,M.planned_fixed_directory_count);
 assert.equal(p.files.length,M.planned_immutable_git_file_count);
 assert.equal(p.journal_path,M.journal_path);
 assert.equal(M.status,'NOT_STAGED');
 assert.equal(M.source_only,true);
 assert.equal(M.external_signed_root_bootstrap_required,true);
 assert.equal(M.operator_review_required_for_crash_recovery,true);
 for(const key of ['production_modified','root_installer_installed',
  'signed_five_field_route_installed','root_capability_provider_installed',
  'private_socket_and_vault_installed','approval_requested','approval_consumed'])
  assert.equal(M[key],false,key);
 assert.equal(p.safe_to_execute,false);
});
