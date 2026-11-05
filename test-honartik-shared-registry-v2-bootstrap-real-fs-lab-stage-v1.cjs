'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const m=require('./manifests/honartik-shared-registry-v2-bootstrap-real-fs-lab-stage-v1.json');
const blob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
test('real disk lab and SIGKILL regression source are separately committed and Git pinned',()=>{
 assert.equal(m.schema,'prhm.registry-v2.bootstrap-real-fs-lab-stage.v1');
 for(const x of [m.source,m.test]){
  assert.match(x.source_commit,/^[0-9a-f]{40}$/);
  assert.match(x.git_blob_sha1,/^[0-9a-f]{40}$/);
  const r=cp.spawnSync('git',['show',x.source_commit+':'+x.path],
   {cwd:__dirname,timeout:15000,maxBuffer:5000000});
  assert.equal(r.status,0);
  assert.equal(blob(r.stdout),x.git_blob_sha1);
 }
});
test('real kernel writes are isolated from Production, never silently promoted',()=>{
 assert.equal(m.status,'LAB_ONLY_NOT_STAGED');
 assert.equal(m.scope,'PRIVATE_OS_TMPDIR_ONLY');
 assert.equal(m.files_in_production_closure,0);
 assert.equal(m.root_launcher_installed,false);
 assert.equal(m.production_mutated,false);
 assert.equal(m.l4_consumed,false);
 assert.equal(m.intent_crash_policy,'NO_REPLAY_MANUAL_REVIEW');
});
