'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const installer=require('../ops/agent3-universal-backup/install-candidate.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent3-installer-security-'));
 fs.chmodSync(root,0o700);
 const staging=path.join(root,'staging');
 const lib=path.join(staging,'lib');
 fs.mkdirSync(lib,{recursive:true,mode:0o700});
 const hashes={};
 for(const rel of installer.FILES){
  const b=Buffer.from('pinned fixture for '+rel);
  const file=path.join(staging,rel);
  fs.writeFileSync(file,b,{mode:0o600});
  hashes[rel]=sha(b);
 }
 return {root,staging,lib,hashes,
   cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('four pinned leaf descriptors read from private stage with no symlink parents',async()=>{
 const f=fixture();
 try{
  const files=await installer.hashStage(f.staging,f.hashes);
  assert.deepEqual(Object.keys(files).sort(),installer.FILES.slice().sort());
  for(const rel of installer.FILES)assert.equal(sha(files[rel]),f.hashes[rel]);
 }finally{f.cleanup();}
});
test('parent directory symlink aborts before reading any source',async()=>{
 const f=fixture();
 try{
  fs.renameSync(f.lib,path.join(f.root,'actual-lib'));
  fs.symlinkSync(path.join(f.root,'actual-lib'),f.lib);
  await assert.rejects(installer.hashStage(f.staging,f.hashes),/unsafe_parent_directory/);
 }finally{f.cleanup();}
});
test('symlinked leaf and public-writable staging parents abort',async()=>{
 const f=fixture();
 try{
  const file=path.join(f.staging,installer.FILES[0]);
  fs.renameSync(file,file+'.original');
  fs.symlinkSync(file+'.original',file);
  await assert.rejects(installer.hashStage(f.staging,f.hashes),/unsafe_stage_file/);
  fs.unlinkSync(file);
  fs.renameSync(file+'.original',file);
  fs.chmodSync(f.staging,0o777);
  await assert.rejects(installer.hashStage(f.staging,f.hashes),/unsafe_parent_directory/);
 }finally{f.cleanup();}
});
test('oversized staged source and wrong SHA are rejected',async()=>{
 const f=fixture();
 try{
  const file=path.join(f.staging,installer.FILES[0]);
  fs.writeFileSync(file,Buffer.alloc(4*1024*1024+1),{mode:0o600});
  await assert.rejects(installer.hashStage(f.staging,f.hashes),/unsafe_stage_file/);
  fs.writeFileSync(file,Buffer.from('wrong'),{mode:0o600});
  await assert.rejects(installer.hashStage(f.staging,f.hashes),/sha_mismatch/);
 }finally{f.cleanup();}
});
test('exclusive install lock rejects concurrent and retained crash locks',async()=>{
 const f=fixture();
 try{
  const a=await installer.acquireInstallLock(f.root);
  await assert.rejects(installer.acquireInstallLock(f.root),/concurrent_or_stale_install_lock/);
  await installer.releaseInstallLock(a);
  const b=await installer.acquireInstallLock(f.root);
  await installer.releaseInstallLock(b);
  assert.equal(fs.existsSync(path.join(f.root,'.agent3-installer.lock')),false);
  fs.writeFileSync(path.join(f.root,'.agent3-installer.lock'),'stale',{mode:0o600});
  await assert.rejects(installer.acquireInstallLock(f.root),/concurrent_or_stale_install_lock/);
 }finally{f.cleanup();}
});
test('lock release refuses to remove another inode after tampering',async()=>{
 const f=fixture();
 try{
  const a=await installer.acquireInstallLock(f.root);
  fs.renameSync(path.join(f.root,'.agent3-installer.lock'),path.join(f.root,'.saved-lock'));
  fs.writeFileSync(path.join(f.root,'.agent3-installer.lock'),'replacement',{mode:0o600});
  await assert.rejects(installer.releaseInstallLock(a),/install_lock_replaced/);
  assert.equal(fs.readFileSync(path.join(f.root,'.agent3-installer.lock'),'utf8'),'replacement');
 }finally{f.cleanup();}
});
