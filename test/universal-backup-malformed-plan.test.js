'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {executeFileBackup}=require('../lib/universal-backup-executor.prototype');
test('malformed plan fails closed before creating backup staging files',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'backup-invalid-'));
 try {
  const src=path.join(tmp,'src'),dst=path.join(tmp,'dst');
  await fs.mkdir(src);await fs.mkdir(dst);await fs.writeFile(path.join(src,'ok.txt'),'ok');
  const base={status:'planned_not_executed',type:'files',source_root:src,destination_root:dst,job_id:crypto.createHash('sha256').update('invalid-plan').digest('hex')};
  for(const files of [[],['ok.txt','ok.txt'],['../ok.txt'],['bad\\name'],['ok.txt\0'],['/etc/passwd']]){
   await assert.rejects(()=>executeFileBackup({...base,files}));
   assert.deepEqual(await fs.readdir(dst),[]);
  }
 } finally {await fs.rm(tmp,{recursive:true,force:true});}
});
