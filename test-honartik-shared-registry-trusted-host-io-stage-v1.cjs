'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const stage=require('./manifests/honartik-shared-registry-trusted-host-io-stage-v1.json');
const base=require('./manifests/honartik-shared-registry-bootstrap-source-closure-v1.json');
const IO='17d707e971a19bdac33e6293ccf97194059c1374';
const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/';
function git(args){
 const p=cp.spawnSync('git',args,{cwd:__dirname,timeout:15000,maxBuffer:4000000});
 assert.equal(p.status,0,'git_read_failed:'+args.join(' '));
 return p.stdout;
}
function blob(bytes){
 return crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0'))
  .update(bytes).digest('hex');
}
test('trusted host IO stage is a third fixed, non-authorizing Git layer',()=>{
 assert.equal(stage.schema,'prhm.shared-registry.trusted-host-io-stage.v1');
 assert.equal(stage.host_io_source_commit,IO);
 assert.equal(stage.existing_release_source_commit,base.source_commit);
 assert.equal(stage.existing_release_manifest_commit,base.release_manifest_commit);
 assert.notEqual(IO,base.source_commit);
 assert.equal(stage.mode,'reviewed_stage_only');
 assert.equal(stage.status,'NOT_STAGED');
 assert.equal(stage.runner_entrypoint_status,'NOT_IMPLEMENTED');
 assert.equal(stage.trusted_approval_route_status,'NOT_INSTALLED');
 assert.equal(stage.requires_fresh_l4,true);
 assert.equal(stage.production_modified,false);
});
test('all six fixed stage destinations have exact immutable Git blob identities',()=>{
 assert.equal(stage.assets.length,6);
 const destinations=new Set();
 for(const asset of stage.assets){
  assert.equal(Object.keys(asset).sort().join('|'),'destination|git_blob_sha1|source_path');
  assert.ok(asset.destination.startsWith(ROOT)||asset.destination.startsWith(
    '/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1/'));
  assert.equal(asset.destination.includes('..'),false);
  assert.equal(destinations.has(asset.destination),false);
  destinations.add(asset.destination);
  const b=git(['show',IO+':'+asset.source_path]);
  assert.equal(blob(b),asset.git_blob_sha1,asset.source_path);
  assert.ok(b.length>100);
 }
});
test('new runtime modules and all local imports have a staged same-directory target',()=>{
 const baseInstalled=new Set(base.assets.map(x=>x.destination));
 const additional=new Set(stage.assets.map(x=>x.destination));
 for(const item of stage.assets.filter(x=>x.source_path.endsWith('.cjs'))){
  const bytes=git(['show',IO+':'+item.source_path]);
  for(const [,rel] of bytes.toString().matchAll(/\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)){
   const dest=path.posix.normalize(path.posix.join(path.posix.dirname(item.destination),rel));
   assert.ok(baseInstalled.has(dest)||additional.has(dest),
    'staging_missing_relative_dependency:'+item.source_path+':'+rel);
  }
 }
});
test('source dependencies never include unreviewed package import, download or env endpoint',()=>{
 const modules=stage.assets.filter(a=>a.source_path.endsWith('.cjs'));
 for(const m of modules){
  const src=git(['show',IO+':'+m.source_path]).toString();
  assert.equal(/\brequire\s*\(\s*['"](?:http|https|ssh|net|vm|child_process)['"]\s*\)/.test(src),false);
  assert.equal(src.includes('eval('),false);
 }
});
