'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const M=require('./manifests/honartik-shared-registry-v2-bootstrap-session-guard-stage-v1.json');
const git=x=>{
 const r=cp.spawnSync('git',x,{cwd:__dirname,timeout:15000,maxBuffer:3000000});
 assert.equal(r.status,0);return r.stdout;
};
const blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
test('session source/test Git object pins are stable and exact',()=>{
 assert.equal(M.schema,'prhm.registry-v2.bootstrap-session-guard-stage.v1');
 assert.equal(M.repo,'prhmonline/prhm-host-actions');
 for(const f of [M.source,M.test]){
  assert.match(f.commit,/^[0-9a-f]{40}$/);
  assert.match(f.git_blob_sha1,/^[0-9a-f]{40}$/);
  assert.equal(blob(git(['show',f.commit+':'+f.path])),f.git_blob_sha1);
 }
});
test('simulated lock then WAL never means signed Production installation',()=>{
 assert.equal(M.status,'NOT_STAGED');
 assert.equal(M.source_only,true);
 assert.deepEqual(M.order,['EXCLUSIVE_LOCK_FSYNC','JOURNAL_HEADER_FSYNC']);
 assert.equal(M.operation_execution_installed,false);
 assert.equal(M.signed_root_launcher_installed,false);
 assert.equal(M.production_mutation,false);
 assert.equal(M.approval_consumed,false);
});
