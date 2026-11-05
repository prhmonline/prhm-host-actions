'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const M=require('./manifests/honartik-shared-registry-v2-bootstrap-wal-stage-v1.json');
const W=require('./prhm-action-registry-v2-bootstrap-wal-v1.cjs');
function git(args){
 const r=cp.spawnSync('git',args,{cwd:__dirname,timeout:15000,maxBuffer:5000000});
 assert.equal(r.status,0,'pinned Git source not accessible: '+args.join(' '));
 return r.stdout;
}
const blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
test('fixed bootstrap journal runtime/test source have immutable exact Git blob pins',()=>{
 assert.equal(M.schema,'prhm.registry-v2.bootstrap-wal-stage.v1');
 assert.equal(M.repo,'prhmonline/prhm-host-actions');
 for(const entry of [M.source,M.test]){
  assert.match(entry.commit,/^[0-9a-f]{40}$/);
  assert.match(entry.git_blob_sha1,/^[0-9a-f]{40}$/);
  assert.equal(blob(git(['show',entry.commit+':'+entry.path])),entry.git_blob_sha1);
  assert.match(git(['ls-tree',entry.commit,'--',entry.path]).toString(),
    /^100644 blob [a-f0-9]{40}\t/);
 }
});
test('synthetic fsync success never grants an L4 or Production bootstrap entrypoint',()=>{
 assert.equal(M.status,'NOT_STAGED');
 assert.equal(M.source_only,true);
 assert.equal(M.project,'honartik');
 assert.equal(M.fixed_journal_path,W.JPATH);
 assert.equal(M.recovery_policy,'INDETERMINATE_ON_UNMATCHED_INTENT_NO_REPLAY');
 assert.equal(M.protected_runtime_file_count,20);
 assert.equal(M.bootstrap_directory_count,10);
 assert.equal(M.requires_independent_root_lock,true);
 assert.equal(M.requires_root_signed_bootstrap,true);
 for(const x of ['root_executor_installed','real_journal_writer_installed',
   'installed_signed_l4_route','production_modified','approval_consumed'])
   assert.equal(M[x],false,x);
});
