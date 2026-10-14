'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const M=require('./manifests/honartik-shared-registry-v2-bootstrap-exclusive-lock-stage-v1.json');
const L=require('./prhm-action-registry-v2-bootstrap-exclusive-lock-v1.cjs');
const git=args=>{
 const p=cp.spawnSync('git',args,{cwd:__dirname,timeout:15000,maxBuffer:3000000});
 assert.equal(p.status,0,'missing immutable git object: '+args.join(' '));
 return p.stdout;
};
const blob=b=>crypto.createHash('sha1')
  .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
test('source and lock tests are pinned to immutable Git objects',()=>{
 assert.equal(M.schema,'prhm.registry-v2.bootstrap-exclusive-lock-stage.v1');
 assert.equal(M.repo,'prhmonline/prhm-host-actions');
 for(const f of [M.source,M.test]){
  assert.match(f.commit,/^[a-f0-9]{40}$/);
  assert.match(f.git_blob_sha1,/^[a-f0-9]{40}$/);
  assert.equal(blob(git(['show',f.commit+':'+f.path])),f.git_blob_sha1);
  assert.match(git(['ls-tree',f.commit,'--',f.path]).toString(),
   /^100644 blob [a-f0-9]{40}\t/);
 }
});
test('successful lock simulation is not real installed root launcher',()=>{
 assert.equal(M.project,'honartik');
 assert.equal(M.status,'NOT_STAGED');
 assert.equal(M.source_only,true);
 assert.equal(M.lock_path,L.LOCK);
 assert.equal(M.journal_path,
  '/var/lib/prhm-agent-selfmaint-exec/registry-bootstrap-v2-journal.json');
 assert.equal(M.actual_root_io_launcher_installed,false);
 assert.equal(M.signed_approval_transport_installed,false);
 assert.equal(M.operator_recovery_required_on_stale_lock,true);
 assert.equal(M.production_mutation,false);
 assert.equal(M.approval_consumed,false);
});
