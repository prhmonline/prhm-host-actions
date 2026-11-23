'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {executeFileBackup}=require('../lib/universal-backup-executor.prototype');
test('rejects symlink source and leaves no published archive',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'agent3-fail-'));
 try{
  const src=path.join(tmp,'src'),dest=path.join(tmp,'dest');
  await fs.mkdir(src);await fs.mkdir(dest);
  await fs.writeFile(path.join(tmp,'secret'),'secret');
  await fs.symlink(path.join(tmp,'secret'),path.join(src,'link'));
  const job_id=crypto.createHash('sha256').update('failure-test').digest('hex');
  await assert.rejects(()=>executeFileBackup({status:'planned_not_executed',type:'files',files:['link'],source_root:src,destination_root:dest,job_id}));
  assert.deepEqual(await fs.readdir(dest),[]);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
