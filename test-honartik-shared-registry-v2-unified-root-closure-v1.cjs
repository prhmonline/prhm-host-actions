'use strict';
/**
 * Git-only preflight for the V2 root runner source closure.
 * No network access, approval, root privileges, service control or host
 * changes. Verifies 20 previously pinned objects + six later dependencies.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const stage=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const extra=require('./manifests/honartik-shared-registry-v2-root-12-review-v1.json');
const root=require('./manifests/honartik-shared-registry-v2-unified-root-closure-v1.json');
const blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const HEX=/^[a-f0-9]{40}$/;
const canon=p=>p===path.posix.normalize(p)&&!p.split('/').includes('..');
const expected=[
 ...stage.files.map(x=>({
  source_path:x.source_path,
  source_commit:x.source_commit,
  git_blob_sha1:x.git_blob_sha1,
  destination:x.destination
 })),
 ...extra.runtime_files.map(x=>({
  source_path:x.path,
  source_commit:x.source_commit,
  git_blob_sha1:x.git_blob_sha1,
  destination:stage.destination_root+'/'+x.path
 }))
];
test('unified closure has exact 20+6 SHA-pinned files, no duplicates and NO-GO status',()=>{
 assert.equal(root.schema,'prhm.honartik.shared-registry-v2.unified-root-closure.v1');
 assert.equal(root.repository,'prhmonline/prhm-host-actions');
 assert.equal(root.project,'honartik');
 assert.equal(root.runtime_root,stage.destination_root);
 assert.equal(root.status,'SOURCE_ONLY_NOT_STAGED');
 assert.equal(root.legacy_runtime_count,20);
 assert.equal(root.new_root_runtime_count,6);
 assert.equal(root.total_runtime_count,26);
 assert.equal(root.files.length,26);
 assert.deepEqual(root.files,expected);
 assert.equal(new Set(root.files.map(x=>x.source_path)).size,26);
 assert.equal(new Set(root.files.map(x=>x.destination)).size,26);
 assert.equal(root.required_root_capability_count,12);
 assert.equal(root.minimum_signed_approval_level,4);
 for(const field of ['root_installed','independent_launcher_enabled',
  'authenticated_discovery_verified','approved_for_production',
  'approval_issued','approval_consumed','production_mutated']){
  assert.equal(root[field],false,field);
 }
});
test('all 26 source bytes match immutable Git blobs, and checked-out code matches pins',()=>{
 for(const f of root.files){
  assert.ok(canon(f.source_path),'noncanonical '+f.source_path);
  assert.ok(canon(f.destination),'unsafe destination '+f.destination);
  assert.equal(f.destination,root.runtime_root+'/'+f.source_path);
  assert.match(f.source_commit,HEX);
  assert.match(f.git_blob_sha1,HEX);
  const proc=cp.spawnSync('git',['show',f.source_commit+':'+f.source_path],{
   cwd:__dirname,timeout:12000,maxBuffer:4200000
  });
  assert.equal(proc.status,0,'unavailable reviewed object '+f.source_path);
  assert.equal(blob(proc.stdout),f.git_blob_sha1,'unpinned git bytes '+f.source_path);
  const checkedOut=fs.readFileSync(path.join(__dirname,f.source_path));
  assert.equal(blob(checkedOut),f.git_blob_sha1,
   'checked-out runtime drift '+f.source_path);
 }
});
test('all literal relative CommonJS runtime imports resolve inside the pinned closure',()=>{
 const pinned=new Set(root.files.map(x=>x.source_path));
 const dependencies=[];
 for(const f of root.files){
  if(!f.source_path.endsWith('.cjs'))continue;
  const src=fs.readFileSync(path.join(__dirname,f.source_path),'utf8');
  for(const m of src.matchAll(/\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)){
   let dependency=path.posix.normalize(path.posix.join(
    path.posix.dirname(f.source_path),m[1]));
   if(!path.posix.extname(dependency))dependency+='.cjs';
   dependencies.push([f.source_path,dependency]);
   assert.ok(pinned.has(dependency),
    'unreviewed dependency '+f.source_path+' -> '+dependency);
  }
 }
 assert.ok(dependencies.length>=30,'suspiciously empty require graph');
 for(const required of [
  'prhm-action-registry-v2-root-complete-capabilities-v1.cjs',
  'prhm-action-registry-v2-durable-recovery-locksafe-v1.cjs',
  'prhm-action-registry-v2-root-recovery-io-v1.cjs',
  'prhm-action-registry-v2-root-live-mcp-v1.cjs',
  'prhm-action-registry-v2-root-runner-bindings-v1.cjs',
  'prhm-action-registry-v2-root-accountability-v1.cjs'
 ])assert.ok(pinned.has(required),'missing root capability '+required);
});
