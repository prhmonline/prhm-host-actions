'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {executeFileBackup}=require('../lib/universal-backup-executor.prototype');
const {verifyIsolatedRestore}=require('../lib/universal-backup-restore-verifier.prototype');
test('missing or altered completion marker makes backup unverifiable',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'backup-marker-'));
 try{
  const src=path.join(tmp,'src'),dst=path.join(tmp,'dst');
  await fs.mkdir(src);await fs.mkdir(dst);
  await fs.writeFile(path.join(src,'a.txt'),'fixture');
  const job_id=crypto.createHash('sha256').update('marker-check').digest('hex');
  const result=await executeFileBackup({status:'planned_not_executed',type:'files',files:['a.txt'],source_root:src,destination_root:dst,job_id});
  assert.equal((await verifyIsolatedRestore(result.archive_path,result.manifest_path)).verified,true);
  await fs.writeFile(result.commit_marker_path,'0'.repeat(64)+'\n');
  await assert.rejects(()=>verifyIsolatedRestore(result.archive_path,result.manifest_path),/completion_marker_mismatch/);
  await fs.unlink(result.commit_marker_path);
  await assert.rejects(()=>verifyIsolatedRestore(result.archive_path,result.manifest_path),/ENOENT/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
