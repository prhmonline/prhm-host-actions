'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createEncryptedBundle,verifyEncryptedBundle}=require('../lib/agent3-encrypted-bundle.candidate');
const mk=async fn=>{
 const t=await fs.mkdtemp(path.join(os.tmpdir(),'agent3-encrypted-fixture-'));
 try{
  const source=path.join(t,'source'),destination=path.join(t,'destination');
  await fs.mkdir(source);await fs.mkdir(destination);
  await fs.mkdir(path.join(source,'sub'));
  await fs.writeFile(path.join(source,'sub','a.txt'),'sensitive content secret one');
  await fs.writeFile(path.join(source,'b.txt'),crypto.randomBytes(8192));
  const plan={status:'planned_not_executed',type:'files',project_id:'example',profile_id:'source',
    source_root:source,destination_root:destination,
    job_id:crypto.createHash('sha256').update('job-test').digest('hex'),
    files:['sub/a.txt','b.txt']};
  await fn({t,source,destination,plan,key:crypto.randomBytes(32)});
 }finally{await fs.rm(t,{recursive:true,force:true});}
};
test('encrypted bundle publishes one atomic namespace, no plaintext and independently restores',()=>mk(async({t,source,destination,plan,key})=>{
 const before=await Promise.all(plan.files.map(async n=>crypto.createHash('sha256').update(await fs.readFile(path.join(source,n))).digest('hex')));
 const e=await createEncryptedBundle(plan,key);
 assert.equal(e.encrypted_at_rest,true);assert.equal(e.atomic_namespace_commit,true);
 assert.equal(e.verified_restore,false);
 const names=(await fs.readdir(destination)).sort();
 assert.deepEqual(names,[plan.job_id]);
 const contents=(await fs.readdir(e.bundle_path)).sort();
 assert.deepEqual(contents,['file:0000.enc','file:0001.enc','header.json','manifest.enc']);
 for(const name of contents){
  const b=await fs.readFile(path.join(e.bundle_path,name));
  assert.ok(!b.includes('sensitive content secret one'));
 }
 const isolated=path.join(t,'restore');
 await fs.mkdir(isolated);
 const out=await verifyEncryptedBundle(e.bundle_path,key,{restoreRoot:isolated});
 assert.equal(out.verified,true);assert.equal(out.file_count,2);
 assert.equal(out.restored_to_isolated_directory,true);
 const after=await Promise.all(plan.files.map(async n=>crypto.createHash('sha256').update(await fs.readFile(path.join(isolated,n))).digest('hex')));
 assert.deepEqual(after,before);
 await assert.rejects(createEncryptedBundle(plan,key),/already_published|EEXIST/);
}));
test('wrong key, ciphertext tampering and forged path fail closed',()=>mk(async({plan,key})=>{
 const e=await createEncryptedBundle(plan,key);
 await assert.rejects(verifyEncryptedBundle(e.bundle_path,crypto.randomBytes(32)),/decrypt_failed/);
 const h=JSON.parse(await fs.readFile(path.join(e.bundle_path,'header.json'),'utf8'));
 h.items[0].iv='00'.repeat(12);
 await fs.writeFile(path.join(e.bundle_path,'header.json'),JSON.stringify(h));
 await assert.rejects(verifyEncryptedBundle(e.bundle_path,key),/decrypt_failed/);
}));
test('rejects unsafe plan and symlinked source without publishing',()=>mk(async({t,plan,key,destination,source})=>{
 const invalid={...plan,files:['../secret']};
 await assert.rejects(createEncryptedBundle(invalid,key),/unsafe_filename/);
 await fs.symlink(path.join(source,'b.txt'),path.join(source,'linked'));
 await assert.rejects(createEncryptedBundle({...plan,files:['linked']},key));
 assert.deepEqual(await fs.readdir(destination),[]);
}));
test('concurrent same-job calls never publish more than once',()=>mk(async({plan,key,destination})=>{
 const outcomes=await Promise.allSettled([createEncryptedBundle(plan,key),createEncryptedBundle(plan,key)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await fs.readdir(destination)).filter(x=>x===plan.job_id).length,1);
}));
