'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {executeFileBackup}=require('../lib/universal-backup-executor.prototype');
const {verifyIsolatedRestore}=require('../lib/universal-backup-restore-verifier.prototype');

test('reject manipulated path before tar extraction, even with recomputed marker hash',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'backup-unsafe-manifest-'));
 try{
  const source=path.join(tmp,'source'),destination=path.join(tmp,'dest');
  await fs.mkdir(source);await fs.mkdir(destination);
  await fs.writeFile(path.join(source,'safe.txt'),'sample');
  const job_id=crypto.createHash('sha256').update('unsafe-manifest-fixture').digest('hex');
  const result=await executeFileBackup({status:'planned_not_executed',type:'files',files:['safe.txt'],source_root:source,destination_root:destination,job_id});
  const manifest=JSON.parse(await fs.readFile(result.manifest_path,'utf8'));
  manifest.files[0].path='../escape.txt';
  const bytes=Buffer.from(JSON.stringify(manifest)+'\n');
  await fs.writeFile(result.manifest_path,bytes);
  await fs.writeFile(result.commit_marker_path,crypto.createHash('sha256').update(bytes).digest('hex')+'\n');
  await assert.rejects(()=>verifyIsolatedRestore(result.archive_path,result.manifest_path),/unsafe_manifest/);
  await assert.rejects(()=>fs.stat(path.join(tmp,'escape.txt')),{code:'ENOENT'});
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
