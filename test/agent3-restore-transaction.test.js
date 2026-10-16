'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {createEncryptedBundle,verifyEncryptedBundle}=require('../lib/agent3-encrypted-bundle.candidate');
test('tampered second ciphertext does not publish partially authenticated plaintext to restore destination',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'agent3-restore-txn-'));
 try{
   const src=path.join(tmp,'source'),dst=path.join(tmp,'backups'),restore=path.join(tmp,'restore');
   for(const p of [src,dst,restore])await fs.mkdir(p);
   await fs.writeFile(path.join(src,'first.txt'),'valid-sensitive-contents');
   await fs.writeFile(path.join(src,'second.txt'),'second-sensitive-content');
   const job_id=crypto.createHash('sha256').update('atomic-restore-test').digest('hex');
   const plan={type:'files',status:'planned_not_executed',project_id:'fixture',profile_id:'files',
     job_id,source_root:src,destination_root:dst,files:['first.txt','second.txt']};
   const key=crypto.randomBytes(32),backup=await createEncryptedBundle(plan,key);
   const tamper=path.join(backup.bundle_path,'file:0001.enc');
   const buf=await fs.readFile(tamper);
   buf[0]^=1;
   await fs.writeFile(tamper,buf);
   await assert.rejects(verifyEncryptedBundle(backup.bundle_path,key,{restoreRoot:restore}),/decrypt_failed/);
   assert.deepEqual(await fs.readdir(restore),[]);
   assert.equal((await fs.readdir(tmp)).filter(x=>x.startsWith('.agent3-restore-verify-')).length,0);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
