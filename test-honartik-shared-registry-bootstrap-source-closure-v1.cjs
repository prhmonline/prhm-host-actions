'use strict';
/**
 * Source-only immutable runtime closure audit.
 * Test exact fixed Git source blobs and relative module import closure.
 * NOT a file copy, bootstrap, approval request, service mutation or install.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const closure=require('./manifests/honartik-shared-registry-bootstrap-source-closure-v1.json');
const release=require('./manifests/honartik-config-center-registry-release-v1.json');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const SOURCE='868ec0251688e30f30691c91390589e80d4f34f9';
const RELEASE='e269cb8ee6f6dc1010620134a8a3ffe57d248535';
const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1';
function git(args,input){
 const out=cp.spawnSync('git',args,{cwd:__dirname,input,encoding:null,timeout:15000,maxBuffer:4000000});
 assert.equal(out.status,0,'Git object inaccessible: '+args.join(' '));
 return out.stdout;
}
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const blobSha=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
test('all runtime files are pinned to immutable, independent source and release Git commits',()=>{
 assert.equal(closure.schema,'prhm.shared-registry.bootstrap-source-closure.v1');
 assert.equal(closure.repo,'prhmonline/prhm-host-actions');
 assert.equal(closure.source_commit,SOURCE);
 assert.equal(closure.release_manifest_commit,RELEASE);
 assert.notEqual(SOURCE,RELEASE);
 assert.equal(closure.destination_root,ROOT);
 assert.equal(git(['merge-base','--is-ancestor',SOURCE,RELEASE]).length,0);
 assert.equal(closure.status,'NOT_STAGED');
 assert.equal(closure.approval_level,4);
 assert.equal(closure.installation_authorized,false);
 assert.equal(closure.production_mutation,false);
 assert.equal(closure.execution_available,false);
});
test('all 11 files are real pinned Git objects; paths are fixed and nonwritable by this code',()=>{
 const known=new Set();
 assert.equal(closure.assets.length,11);
 for(const item of closure.assets){
   assert.deepEqual(Object.keys(item).sort(),['destination','git_blob_sha1','git_path']);
   assert.match(item.git_path,/^[a-z][a-z0-9_.-]+$/);
   assert.ok(item.git_path.endsWith('.cjs')||item.git_path.endsWith('.json'));
   assert.equal(item.destination,ROOT+'/'+item.git_path);
   assert.ok(!known.has(item.git_path));known.add(item.git_path);
   const bytes=git(['show',SOURCE+':'+item.git_path]);
   assert.ok(bytes.length>100);
   assert.equal(blobSha(bytes),item.git_blob_sha1,item.git_path);
   const entry=git(['ls-tree',SOURCE,'--',item.git_path]).toString('utf8');
   assert.match(entry,/^100644 blob [a-f0-9]{40}\t/);
   assert.ok(entry.endsWith('\t'+item.git_path+'\n'));
 }
});
test('all relative CommonJS dependencies have a pinned immutable blob in the same directory',()=>{
 const known=new Set(closure.assets.map(a=>a.git_path));
 for(const item of closure.assets.filter(a=>a.git_path.endsWith('.cjs'))){
   const src=git(['show',SOURCE+':'+item.git_path]).toString('utf8');
   for(const [,name] of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)){
     if(name.startsWith('node:'))continue;
     assert.ok(name.startsWith('./'),'not a pinned local module: '+name);
     const relative=path.posix.normalize(name.slice(2));
     assert.ok(!relative.includes('/')&&!relative.includes('..'),'unsafe module path');
     assert.ok(known.has(relative),'missing runtime dependency: '+item.git_path+' => '+name);
   }
 }
});
test('generic target manifest and five-field approval digest match independently pinned reviewed release',()=>{
 const raw=git(['show',RELEASE+':'+closure.release_manifest_path]);
 assert.deepEqual(JSON.parse(raw.toString()),release);
 assert.equal(release.source_commit,SOURCE);
 assert.equal(sha256(raw),closure.release_manifest_sha256);
 assert.equal(gateway.assertManifest(release).project,'honartik');
 const binding={
   action:gateway.ACTION,project:release.project,
   source_commit:SOURCE,manifest_commit:RELEASE,
   manifest_sha256:closure.release_manifest_sha256
 };
 assert.equal(gateway.approvalBindingSha(binding),closure.expected_approval_arguments_sha256);
 assert.match(closure.expected_approval_arguments_sha256,/^[0-9a-f]{64}$/);
});
test('the source-only manifest never authorizes a root runner or grants mutable paths',()=>{
 assert.equal(Object.hasOwn(closure,'approvalToken'),false);
 assert.equal(Object.hasOwn(closure,'run'),false);
 assert.equal(Object.hasOwn(closure,'write'),false);
 assert.equal(closure.assets.some(x=>x.destination.includes('..')),false);
 assert.equal(closure.assets.some(x=>x.destination.startsWith('/home/')),false);
});
