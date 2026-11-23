'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {executeFileBackup}=require('../lib/universal-backup-executor.prototype');
const {verifyIsolatedRestore}=require('../lib/universal-backup-restore-verifier.prototype');
test('isolated backup round trip, without touching production',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'agent3-backup-smoke-'));
 try{
  const source=path.join(temp,'source'),dest=path.join(temp,'dest');
  await fs.mkdir(source);await fs.mkdir(dest);
  await fs.writeFile(path.join(source,'sample.txt'),'isolated smoke fixture');
  const job_id=crypto.createHash('sha256').update('agent3-isolated-smoke').digest('hex');
  const result=await executeFileBackup({status:'planned_not_executed',type:'files',files:['sample.txt'],source_root:source,destination_root:dest,job_id});
  const archive=result.archive_path||result.archive||path.join(dest,job_id+'.tar.gz');
  const manifest=result.manifest_path||result.manifest||path.join(dest,job_id+'.manifest.json');
  const verified=await verifyIsolatedRestore(archive,manifest);
  assert.equal(verified.verified,true);
  assert.equal(verified.file_count,1);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
