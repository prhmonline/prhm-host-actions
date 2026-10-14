'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const crypto=require('node:crypto');
const manifest=require('./manifests/honartik-shared-registry-v2-independent-root-launcher-stage-v1.json');
const closure=require('./manifests/honartik-shared-registry-v2-unified-root-closure-v1.json');
const blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const entry='prhm-action-registry-v2-independent-root-launcher-v1.cjs';
test('signed root staging candidate separately pins 27 files with no authorization or staged claim',()=>{
 assert.equal(manifest.schema,'prhm.honartik.registry-v2.independent-root-launcher-stage.v1');
 assert.equal(manifest.status,'REVIEWED_SOURCE_ONLY_NOT_STAGED');
 assert.equal(manifest.declared_runtime_source_count,27);
 assert.equal(manifest.locked_root_capability_count,12);
 assert.equal(manifest.root,closure.runtime_root);
 assert.deepEqual(manifest.reviewed_code.slice(0,26),closure.files);
 assert.equal(manifest.reviewed_code[26].source_path,entry);
 assert.equal(manifest.reviewed_code[26].destination,closure.runtime_root+'/'+entry);
 assert.equal(manifest.manifest_blob_sha1,blob(fs.readFileSync(path.join(
  __dirname,'manifests/honartik-shared-registry-v2-unified-root-closure-v1.json'))));
 for(const k of ['standalone_execution_authorized','root_staged',
  'approval_center_ledger_verified','sealed_mcp_bearer_verified',
  'signed_l4_issued','signed_l4_consumed','production_modified'])
  assert.equal(manifest[k],false,k);
 assert.equal(new Set(manifest.reviewed_code.map(f=>f.destination)).size,27);
});
test('launcher Git blob pinned to separate commit and actual checkout; no mutable branch aliases',()=>{
 const e=manifest.reviewed_code[26];
 assert.match(e.source_commit,/^[0-9a-f]{40}$/);
 assert.match(e.git_blob_sha1,/^[0-9a-f]{40}$/);
 const commit=cp.spawnSync('git',['show',e.source_commit+':'+entry],{
  cwd:__dirname,maxBuffer:300000,timeout:10000});
 assert.equal(commit.status,0);
 assert.equal(blob(commit.stdout),e.git_blob_sha1);
 assert.equal(blob(fs.readFileSync(path.join(__dirname,entry))),e.git_blob_sha1);
});
test('standalone root launcher module can be imported without Production effects',()=>{
 const launcher=require('./prhm-action-registry-v2-independent-root-launcher-v1.cjs');
 assert.equal(launcher.ROOT,closure.runtime_root);
 assert.equal(typeof launcher.attestation,'function');
 assert.equal(typeof launcher.execute,'function');
});
