'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {verifyEncryptedBundle}=require('../lib/agent3-encrypted-bundle.candidate');

test('SIGKILL before atomic publication never exposes an accepted backup',async(t)=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'agent3-kill-test-'));
 let child=null;
 try{
  const source=path.join(tmp,'src'),destination=path.join(tmp,'dest');
  await fs.mkdir(source);await fs.mkdir(destination);
  const fd=await fs.open(path.join(source,'large.bin'),'wx',0o600);
  try{await fd.truncate(96*1024*1024);}finally{await fd.close();}
  const job_id=crypto.createHash('sha256').update('killed-job-fixture').digest('hex');
  const key=crypto.randomBytes(32);
  const script=[
    "const m=require(process.argv[1]);",
    "const root=process.argv[2],dest=process.argv[3],job=process.argv[4];",
    "const key=Buffer.from(process.argv[5],'hex');",
    "m.createEncryptedBundle({status:'planned_not_executed',type:'files',",
    "project_id:'fixture',profile_id:'fixture',source_root:root,",
    "destination_root:dest,job_id:job,files:['large.bin']},key).then(()=>process.exit(0),()=>process.exit(1));"
  ].join('');
  child=spawn(process.execPath,['-e',script,require.resolve('../lib/agent3-encrypted-bundle.candidate'),source,destination,job_id,key.toString('hex')],{stdio:'ignore'});
  let staged=false;
  for(let i=0;i<300;i++){
   const names=await fs.readdir(destination);
   if(names.some(x=>x.startsWith('.agent3-stage-'))){staged=true;break;}
   if(child.exitCode!==null)break;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(staged,'observed in-progress staging');
  child.kill('SIGKILL');
  await new Promise(resolve=>child.once('close',resolve));
  const entries=await fs.readdir(destination);
  assert.ok(entries.some(x=>x.startsWith('.agent3-stage-')),'orphan stage may require approved recovery');
  assert.ok(!entries.includes(job_id),'no published bundle on crash');
  await assert.rejects(verifyEncryptedBundle(path.join(destination,job_id),key));
 }finally{
  if(child&&child.exitCode===null)child.kill('SIGKILL');
  await fs.rm(tmp,{recursive:true,force:true});
 }
});
