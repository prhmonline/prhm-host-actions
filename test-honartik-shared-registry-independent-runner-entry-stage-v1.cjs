'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const cp=require('node:child_process'),path=require('node:path');
const crypto=require('node:crypto');
const M=require('./manifests/honartik-shared-registry-independent-runner-entry-stage-v1.json');
const BASE=require('./manifests/honartik-shared-registry-bootstrap-source-closure-v1.json');
const IO=require('./manifests/honartik-shared-registry-trusted-host-io-stage-v1.json');
const DEST='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/';
function git(args){const r=cp.spawnSync('git',args,{cwd:__dirname,timeout:15000,maxBuffer:1000000});
 assert.equal(r.status,0,'immutable git blob unavailable');
 return r.stdout}
test('independent executable is immutable Git source, not a live installed action',()=>{
 assert.equal(M.schema,'prhm.shared-registry.independent-runner-entry-stage.v1');
 assert.match(M.source_commit,/^[a-f0-9]{40}$/);
 assert.equal(M.entrypoint.destination,DEST+'prhm-action-registry-independent-runner-entry-v1.cjs');
 assert.equal(M.entrypoint.source_path,'prhm-action-registry-independent-runner-entry-v1.cjs');
 const bytes=git(['show',M.source_commit+':'+M.entrypoint.source_path]);
 const hash=crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 assert.equal(hash,M.entrypoint.git_blob_sha1);
 assert.equal(M.contract,'systemd_LoadCredential_private_root_only');
 assert.equal(M.contract_status,'SOURCE_ONLY_FAIL_CLOSED');
 assert.equal(M.trusted_approval_five_field_route,'NOT_INSTALLED');
 assert.equal(M.trusted_rollback_and_discovery_binding,'NOT_IMPLEMENTED');
 assert.equal(M.stage_status,'NOT_STAGED');
 assert.equal(M.production_mutation,false);
 assert.equal(M.requires_fresh_l4,true);
});
test('all independent entrypoint local imports are in its immutable staged closure',()=>{
 const bytes=git(['show',M.source_commit+':'+M.entrypoint.source_path]).toString();
 const known=new Set([M.entrypoint.destination,...BASE.assets.map(x=>x.destination),
  ...IO.assets.map(x=>x.destination)]);
 for(const [,target] of bytes.matchAll(/\brequire\(['"](\.[^'"]+)['"]\)/g)){
  const resolved=path.posix.normalize(path.posix.join(DEST,target));
  assert.equal(known.has(resolved),true,'missing stage dependency: '+target);
 }
 assert.deepEqual(M.dependency_manifests,[
  'manifests/honartik-shared-registry-bootstrap-source-closure-v1.json',
  'manifests/honartik-shared-registry-trusted-host-io-stage-v1.json'
 ]);
});
test('closure has no authority, root credentials or arbitrary command path',()=>{
 const a=JSON.stringify(M);
 for(const forbidden of ['approval_token','private_key','/etc/shadow','--apply','systemd-run --'])
  assert.equal(a.includes(forbidden),false);
 assert.equal(Object.hasOwn(M,'operator_approval'),false);
});
