'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createPlanner,verifyEvidence}=require('../lib/universal-backup-policy');
const {executeFileBackup}=require('../lib/universal-backup-executor.prototype');

test('accept persisted hashes as integrity evidence but not production readiness',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'backup-evidence-'));
 try{
  const root=path.join(tmp,'src'),destination=path.join(tmp,'dst');
  await fs.mkdir(root);await fs.mkdir(destination);
  await fs.writeFile(path.join(root,'a.txt'),'content a');
  const plan=createPlanner({projects:{example:{root,destination,profiles:{files:{type:'files',files:['a.txt']}}}}})
    .planCreate({project_id:'example',profile_id:'files',idempotency_key:'evidence-valid-12345'});
  const actual=await executeFileBackup(plan);
  assert.deepEqual(verifyEvidence(actual,plan),{job_id:plan.job_id,verified:true,production_ready:false});
  assert.throws(()=>verifyEvidence({...actual,archive_sha256:'0'.repeat(64)},plan),/denied/);
  await fs.writeFile(actual.commit_marker_path,'0'.repeat(64)+'\n');
  assert.throws(()=>verifyEvidence(actual,plan),/denied/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('metadata claims cannot substitute missing archives',()=>{
 const plan={job_id:'a'.repeat(64),destination_root:'/tmp',files:['a.txt'],expected_file_count:1,project_id:'example',profile_id:'files'};
 const forged={job_id:plan.job_id,file_count:1,archive_sha256:'a'.repeat(64),manifest_sha256:'a'.repeat(64),
  archive_readback_ok:true,manifest_verified:true,atomic_commit_ok:true};
 assert.throws(()=>verifyEvidence(forged,plan),/denied/);
});
