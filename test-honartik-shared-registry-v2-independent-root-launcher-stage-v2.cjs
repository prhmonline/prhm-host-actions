'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const stage=require('./manifests/honartik-shared-registry-v2-independent-root-launcher-stage-v2.json');
const old=require('./manifests/honartik-shared-registry-v2-independent-root-launcher-stage-v1.json');
const manifest=require('./manifests/honartik-shared-registry-v2-unified-root-closure-v1.json');
const launcher=require('./prhm-action-registry-v2-independent-root-launcher-v1.cjs');
const expectedManifest='manifests/honartik-shared-registry-v2-unified-root-closure-v1.json';
const blob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
test('independent root stage explicitly carries the 28th bootstrap manifest file',()=>{
 assert.equal(stage.schema,'prhm.honartik.registry-v2.independent-root-launcher-stage.v2');
 assert.equal(stage.status,'REVIEWED_SOURCE_ONLY_NOT_STAGED');
 assert.equal(old.declared_runtime_source_count,27);
 assert.equal(stage.declared_runtime_source_count,28);
 assert.equal(stage.reviewed_code.length,28);
 assert.deepEqual(stage.reviewed_code.slice(0,27),old.reviewed_code);
 const extra=stage.reviewed_code[27];
 assert.equal(extra.source_path,expectedManifest);
 assert.equal(extra.destination,stage.root+'/'+expectedManifest);
 assert.equal(extra.git_blob_sha1,launcher.MANIFEST_BLOB);
 assert.equal(stage.manifest_blob_sha1,extra.git_blob_sha1);
 assert.equal(stage.explicit_trust_boundary.runtime_sources,26);
 assert.equal(stage.explicit_trust_boundary.launcher_sources,1);
 assert.equal(stage.explicit_trust_boundary.root_manifest_sources,1);
 assert.equal(stage.explicit_trust_boundary.launcher_blob_expected,
  old.reviewed_code[26].git_blob_sha1);
 assert.equal(new Set(stage.reviewed_code.map(x=>x.destination)).size,28);
});
test('all 28 explicitly staged assets exist in historical Git and match checkout SHA',()=>{
 for(const entry of stage.reviewed_code){
  assert.match(entry.source_commit,/^[a-f0-9]{40}$/);
  assert.match(entry.git_blob_sha1,/^[a-f0-9]{40}$/);
  assert.equal(entry.destination,stage.root+'/'+entry.source_path);
  const p=cp.spawnSync('git',['show',entry.source_commit+':'+entry.source_path],{
   cwd:__dirname,maxBuffer:4500000,timeout:15000
  });
  assert.equal(p.status,0,'missing immutable Git source '+entry.source_path);
  assert.equal(blob(p.stdout),entry.git_blob_sha1);
  assert.equal(blob(fs.readFileSync(path.join(__dirname,entry.source_path))),
   entry.git_blob_sha1,'checkout drift '+entry.source_path);
 }
});
test('launcher absolute manifest dependency can never be omitted from stage closure',()=>{
 const required=new Set([
  stage.root+'/'+launcher.MANIFEST,
  stage.root+'/prhm-action-registry-v2-independent-root-launcher-v1.cjs',
  stage.root+'/prhm-action-registry-v2-root-complete-capabilities-v1.cjs'
 ]);
 const actual=new Set(stage.reviewed_code.map(x=>x.destination));
 for(const file of required)assert.ok(actual.has(file),'unstaged critical file '+file);
 assert.equal(blob(fs.readFileSync(path.join(__dirname,launcher.MANIFEST))),
  launcher.MANIFEST_BLOB);
 assert.equal(manifest.files.length,26);
});
test('additional stage never implies a signed L4 authorization or deployment',()=>{
 assert.equal(stage.requires_external_signed_root_stage,true);
 for(const k of ['standalone_execution_authorized','root_staged',
  'host_preflight_verified','approval_center_ledger_verified',
  'sealed_mcp_bearer_verified','signed_l4_issued','signed_l4_consumed',
  'production_modified'])assert.equal(stage[k],false,k);
});
