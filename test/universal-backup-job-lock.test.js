'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {executeFileBackup}=require('../lib/universal-backup-executor.prototype');

test('concurrent backup attempts for same job cannot both publish',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'backup-lock-'));
 try{
  const source=path.join(tmp,'source'),destination=path.join(tmp,'dest');
  await fs.mkdir(source);await fs.mkdir(destination);
  await fs.writeFile(path.join(source,'a.txt'),'same');
  const plan={status:'planned_not_executed',type:'files',project_id:'demo',profile_id:'test',
    files:['a.txt'],source_root:source,destination_root:destination,
    job_id:crypto.createHash('sha256').update('single-job-lock').digest('hex')};
  const results=await Promise.allSettled([executeFileBackup(plan),executeFileBackup(plan)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  const output=results.find(x=>x.status==='fulfilled').value;
  assert.ok((await fs.stat(output.commit_marker_path)).isFile());
  assert.equal((await fs.readdir(destination)).filter(n=>n.endsWith('.complete')).length,1);
  assert.ok(!(await fs.readdir(destination)).some(n=>n.endsWith('.lock')));
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
