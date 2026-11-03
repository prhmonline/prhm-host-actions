'use strict';
// Genuine Linux atomic rename/fsync/backup and rollback, using ONLY disposable
// test files in os.tmpdir(). No production paths, services or root privileges.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const native=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-solo-six-'));
 fs.chmodSync(root,0o700);
 const owners=path.join(root,'owners'),assets=path.join(root,'assets'),workRoot=path.join(root,'work');
 for(const d of [owners,assets,workRoot])fs.mkdirSync(d,{mode:0o700});
 const steps=native.KEYS.map(key=>{
  const file=path.join(owners,key+'.js');
  const before=Buffer.from('baseline-'+key),nextBytes=Buffer.from('candidate-'+key);
  fs.writeFileSync(file,before,{mode:0o600});
  const st=fs.statSync(file);
  return {key,path:file,beforeSha:sha(before),afterSha:sha(nextBytes),
   nextBytes,expectedUid:st.uid,expectedGid:st.gid,expectedMode:0o600};
 });
 const originalCore=Buffer.from('existing-core');
 const core=path.join(assets,'soloCompanyRuntimeInstallCore.js');
 const worker=path.join(assets,'solo-company-runtime-root-action-v1.js');
 fs.writeFileSync(core,originalCore,{mode:0o600});
 const candidateCore=Buffer.from('candidate-core'),candidateWorker=Buffer.from('candidate-worker');
 const plan={schema:'prhm.registrar.native-transaction.v1',
  sourceCommit:'a'.repeat(40),manifestSha256:'b'.repeat(64),
  steps,assets:[
   {path:core,nextBytes:candidateCore,afterSha:sha(candidateCore)},
   {path:worker,nextBytes:candidateWorker,afterSha:sha(candidateWorker)}
  ]};
 return {root,workRoot,steps,core,worker,plan,originalCore,candidateCore,candidateWorker};
}
function cleanup(f){fs.rmSync(f.root,{recursive:true,force:true})}
test('six-file atomic native transaction commits all postimages',async()=>{
 const f=fixture();
 try{
  const result=await native.executeCore(f.plan,{workRoot:f.workRoot,
   postInstall:async()=>true,postRollback:async()=>true});
  assert.equal(result.status,'COMMITTED');
  for(const step of f.steps)assert.equal(sha(fs.readFileSync(step.path)),step.afterSha);
  assert.deepEqual(fs.readFileSync(f.core),f.candidateCore);
  assert.deepEqual(fs.readFileSync(f.worker),f.candidateWorker);
 }finally{cleanup(f)}
});
test('injected health failure restores four owners, existing core and removes new helper',async()=>{
 const f=fixture();
 try{
  let recovered=false;
  await assert.rejects(()=>native.executeCore(f.plan,{workRoot:f.workRoot,
   postInstall:async()=>false,postRollback:async()=>{recovered=true;return true}}),/postinstall_health/);
  assert.equal(recovered,true);
  for(const step of f.steps)assert.equal(sha(fs.readFileSync(step.path)),step.beforeSha);
  assert.deepEqual(fs.readFileSync(f.core),f.originalCore);
  assert.equal(fs.existsSync(f.worker),false);
  const journals=fs.readdirSync(f.workRoot).filter(x=>x.startsWith('txn-'));
  assert.equal(journals.length,1);
  const journal=JSON.parse(fs.readFileSync(path.join(f.workRoot,journals[0],'journal.json'),'utf8'));
  assert.equal(journal.status,'ROLLED_BACK');
 }finally{cleanup(f)}
});
test('midflight injected rename failure restores exact six-file preimages',async()=>{
 const f=fixture();
 try{
  await assert.rejects(()=>native.executeCore(f.plan,{workRoot:f.workRoot,
   postInstall:async()=>true,postRollback:async()=>true,
   onRenamed:(key,n)=>{if(n===4)throw Error('SIMULATED_MIDFLIGHT_FAULT')}}),
   /SIMULATED_MIDFLIGHT_FAULT/);
  for(const step of f.steps)assert.equal(sha(fs.readFileSync(step.path)),step.beforeSha);
  assert.deepEqual(fs.readFileSync(f.core),f.originalCore);
  assert.equal(fs.existsSync(f.worker),false);
 }finally{cleanup(f)}
});
