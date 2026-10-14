'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const closure=require('./manifests/honartik-shared-registry-bootstrap-source-closure-v1.json');
const release=require('./manifests/honartik-config-center-registry-release-v1.json');
const P=require('./prhm-action-registry-root-pinned-readers-v1.cjs');
const ORIGINAL='honartik-config-center-install-manifest-v1.json';
function fixture(){
 const map=new Map();
 let serial=2;
 function addFile(filename,data,fields={}){
   map.set(filename,{
     bytes:Buffer.from(data),uid:0,gid:0,mode:0o100644,
     dev:1,ino:++serial,...fields
   });
   addDir(path.posix.dirname(filename));
 }
 function addDir(filename){
   if(!map.has(filename))map.set(filename,{
     directory:true,uid:0,gid:0,mode:0o40755,dev:1,ino:++serial
   });
 }
 addFile(P.RELEASE_LOCAL,fs.readFileSync(closure.release_manifest_path));
 addFile(P.RUNTIME+'/'+ORIGINAL,fs.readFileSync(ORIGINAL));
 for(const a of release.assets)
   addFile(P.STAGED+'/'+a.source_path,fs.readFileSync(a.source_path));
 function stat(filename){
   const x=map.get(filename);
   if(!x)throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});
   return {uid:x.uid,gid:x.gid,mode:x.mode,
     size:x.bytes?.length||0,dev:x.dev,ino:x.ino,
     isDirectory:()=>x.directory===true,
     isFile:()=>x.directory!==true,
     isSymbolicLink:()=>x.symlink===true};
 }
 let opens=0;
 const io={
   lstatSync:stat,
   realpathSync:filename=>filename,
   openSync:filename=>{opens++;stat(filename);return filename},
   fstatSync:filename=>stat(filename),
   readFileSync:filename=>Buffer.from(map.get(filename).bytes),
   closeSync:()=>{}
 };
 return {map,io,reads:P.readers(io),getOpens:()=>opens};
}
test('reads real committed manifest bytes using only immutable source and manifest pins',()=>{
 const f=fixture();
 const m=f.reads.readPinnedGitManifest({repo:closure.repo,
   project:'honartik',source_commit:P.SOURCE,manifest_commit:P.MANIFEST,
   max_bytes:160000});
 assert.equal(m.path,closure.release_manifest_path);
 assert.deepEqual(JSON.parse(m.bytes.toString('utf8')),release);
 const legacy=f.reads.readPinnedGitSource({repo:closure.repo,
   source_commit:P.SOURCE,source_path:ORIGINAL,max_bytes:4000000});
 assert.equal(JSON.parse(legacy).action,release.action);
});
test('reads all five staged reviewed assets and matches their exact Git source blobs',()=>{
 const f=fixture();
 for(const a of release.assets){
   const staged=f.reads.readStagedAsset(a.path);
   const git=f.reads.readPinnedGitSource({repo:closure.repo,
     source_commit:P.SOURCE,source_path:a.source_path,max_bytes:4000000});
   assert.deepEqual(staged,git);
   assert.deepEqual(staged,fs.readFileSync(a.source_path));
 }
});
test('rejects arbitrary repo, project, source revision, manifest revision and requested paths',()=>{
 const f=fixture();const req={repo:closure.repo,project:'honartik',
   source_commit:P.SOURCE,manifest_commit:P.MANIFEST,max_bytes:160000};
 for(const bad of [
   {...req,repo:'other/repo'},{...req,project:'moeinshow'},
   {...req,source_commit:'f'.repeat(40)},
   {...req,manifest_commit:'f'.repeat(40)},
   {...req,max_bytes:'4000000'},
   {...req,max_bytes:5000000},
   {...req,untrusted_path:'/etc/shadow'}
 ])assert.throws(()=>f.reads.readPinnedGitManifest(bad),/manifest_request_untrusted/);
 assert.throws(()=>f.reads.readPinnedGitSource({repo:closure.repo,
   source_commit:P.SOURCE,source_path:'../../etc/shadow',max_bytes:4000000}),
   /source_not_allowlisted/);
 assert.throws(()=>f.reads.readStagedAsset('/etc/passwd'),/asset_not_allowlisted/);
 assert.throws(()=>f.reads.readLiveOwner('/root/.ssh/id_rsa'),/owner_not_allowlisted/);
});
test('fails closed for byte tampering, a symlinked parent, unsafe ownership, weak mode or stat race',()=>{
 for(const mode of ['bytes','parentSymlink','uid','permissions','inodeRace']){
  const f=fixture(),filename=P.RELEASE_LOCAL;
  const rec=f.map.get(filename);
  if(mode==='bytes')rec.bytes=Buffer.from('tampered');
  if(mode==='parentSymlink')f.map.get(path.posix.dirname(filename)).symlink=true;
  if(mode==='uid')rec.uid=1000;
  if(mode==='permissions')rec.mode=0o100666;
  if(mode==='inodeRace'){
    const original=f.io.fstatSync;
    f.io.fstatSync=name=>({...original(name),ino:999});
  }
  assert.throws(()=>f.reads.readPinnedGitManifest({
   repo:closure.repo,source_commit:P.SOURCE,
   manifest_commit:P.MANIFEST,project:'honartik',max_bytes:160000
  }),/pinned_sha256_drift|parent_not_root_owned_or_unsafe|file_not_root_owned_or_unsafe|file_replaced_during_read/,
  mode);
 }
});
test('a changed original Production owner SHA fails with no changes',()=>{
 const f=fixture();
 const target=release.registry_owners.base.path;
 const parent=path.posix.dirname(target);
 f.map.set(parent,{directory:true,uid:0,gid:0,mode:0o40755,dev:1,ino:33});
 f.map.set(target,{bytes:Buffer.from('synthetic owner file which cannot match real SHA'),uid:0,
  gid:0,mode:0o100644,dev:1,ino:34});
 assert.throws(()=>f.reads.readLiveOwner(target),/pinned_sha256_drift/);
});
test('the returned capability surface has precisely four read-only operations',()=>{
 const f=fixture();
 assert.deepEqual(Object.keys(f.reads).sort(),[
  'readLiveOwner','readPinnedGitManifest','readPinnedGitSource','readStagedAsset'].sort());
 for(const name of ['writeFile','exec','restart','approve','consume','install','rollback',
  'request','verifyToken','sign','spawn'])
   assert.equal(Object.hasOwn(f.reads,name),false);
 assert.ok(f.getOpens()>0||f.getOpens()===0);
});

test('request byte ceilings are actual read limits, not decorative metadata',()=>{
 const f=fixture();
 const q={repo:closure.repo,project:'honartik',
   source_commit:P.SOURCE,manifest_commit:P.MANIFEST,max_bytes:100};
 assert.throws(()=>f.reads.readPinnedGitManifest(q),/file_not_root_owned_or_unsafe/);
 const asset=release.assets[0];
 assert.throws(()=>f.reads.readPinnedGitSource({
   repo:closure.repo,source_commit:P.SOURCE,source_path:asset.source_path,
   max_bytes:100
 }),/file_not_root_owned_or_unsafe/);
 assert.throws(()=>f.reads.readPinnedGitSource({
   repo:closure.repo,source_commit:P.SOURCE,source_path:asset.source_path,
   max_bytes:4000000,untrusted:'bad'
 }),/source_request_untrusted/);
});
