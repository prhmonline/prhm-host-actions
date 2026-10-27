'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const tx=require('./shared-registrar-native-filesystem-v1.cjs');
function fixture(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-reg-linux-'));
 fs.chmodSync(base,0o700);
 const journal=path.join(base,'journal');
 fs.mkdirSync(journal,{mode:0o700});
 const steps=tx.KEYS.map(key=>{
  const p=path.join(base,key+'.js');
  const before=Buffer.from('original-fixture-owner-'+key+'\n');
  const nextBytes=Buffer.from('candidate-fixture-owner-'+key+'\n');
  fs.writeFileSync(p,before,{mode:0o600});
  return {key,path:p,beforeSha:tx.HASH(before),
   afterSha:tx.HASH(nextBytes),nextBytes};
 });
 const plan={schema:'prhm.registrar.native-transaction.v1',steps,
  sourceCommit:'a'.repeat(40),manifestSha256:'b'.repeat(64)};
 const old=Object.fromEntries(steps.map(s=>[s.path,fs.readFileSync(s.path)]));
 return {base,journal,plan,steps,old,
  dispose:()=>fs.rmSync(base,{recursive:true,force:true}),
  original:()=>{for(const s of steps){
   assert.deepEqual(fs.readFileSync(s.path),old[s.path]);
   assert.equal(fs.statSync(s.path).mode&0o777,0o600);
  }}
 };
}
test('real Linux atomic installation: all four owners, journal COMMITTED',async()=>{
 const x=fixture();
 try{
  const r=await tx.executeCore(x.plan,{workRoot:x.journal,postInstall:async()=>true,postRollback:async()=>true});
  assert.equal(r.status,'COMMITTED');
  for(const s of x.steps)assert.equal(tx.HASH(fs.readFileSync(s.path)),s.afterSha);
  const j=JSON.parse(fs.readFileSync(path.join(r.transaction,'journal.json')));
  assert.equal(j.status,'COMMITTED');
  assert.equal(fs.existsSync(path.join(x.journal,'active.lock')),false);
  assert.equal(fs.existsSync(path.join(r.transaction,'base.before')),true);
 }finally{x.dispose()}
});
test('injected failure after two renames restores exact bytes and modes',async()=>{
 const x=fixture();
 try{
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>true,postRollback:async()=>true,onRenamed:(key,i)=>{if(i===1)throw Error('INJECT_AFTER_TWO_RENAMES')}
  }),/INJECT_AFTER_TWO_RENAMES/);
  x.original();
  const dirs=fs.readdirSync(x.journal).filter(n=>n.startsWith('txn-'));
  assert.equal(dirs.length,1);
  const j=JSON.parse(fs.readFileSync(path.join(x.journal,dirs[0],'journal.json')));
  assert.equal(j.status,'ROLLED_BACK');
 }finally{x.dispose()}
});
test('failed post-install health triggers four-owner rollback',async()=>{
 const x=fixture();
 try{
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>false,postRollback:async()=>true}),/postinstall_health/);
  x.original();
 }finally{x.dispose()}
});
test('preimage drift aborts before modifying a single owner',async()=>{
 const x=fixture();
 try{
  fs.writeFileSync(x.steps[2].path,'unexpected');
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>true,postRollback:async()=>true}),/preimage_sha_drift/);
  for(let i=0;i<2;i++)assert.deepEqual(fs.readFileSync(x.steps[i].path),x.old[x.steps[i].path]);
 }finally{x.dispose()}
});
test('unsafe symlink target aborts before modifying a single owner',async()=>{
 const x=fixture();
 try{
  fs.unlinkSync(x.steps[0].path);
  fs.symlinkSync(x.steps[1].path,x.steps[0].path);
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>true,postRollback:async()=>true}),/unsafe_file/);
  assert.deepEqual(fs.readFileSync(x.steps[1].path),x.old[x.steps[1].path]);
 }finally{x.dispose()}
});
test('SIGKILL crash after first rename, then independent-process recovery',async()=>{
 if(process.platform!=='linux')return;
 const x=fixture();
 try{
  const run=cp.spawnSync(process.execPath,[
   path.join(__dirname,'test-shared-registrar-crash-child-v1.cjs'),x.base
  ],{timeout:10000,encoding:'utf8'});
  assert.equal(run.signal,'SIGKILL',JSON.stringify(run));
  assert.notDeepEqual(fs.readFileSync(x.steps[0].path),x.old[x.steps[0].path]);
  const dirs=fs.readdirSync(x.journal).filter(n=>n.startsWith('txn-'));
  assert.equal(dirs.length,1);
  const r=await tx.recoverAfterCrash({workRoot:x.journal,postRollback:async()=>true,
   transaction:path.join(x.journal,dirs[0]),expectedTargets:x.steps.map(s=>s.path)});
  assert.equal(r.status,'ROLLED_BACK');
  x.original();
  assert.equal(fs.existsSync(path.join(x.journal,'active.lock')),false);
 }finally{x.dispose()}
});
test('recovery will not break a live owner lock',async()=>{
 const x=fixture();
 try{
  fs.writeFileSync(path.join(x.journal,'active.lock'),JSON.stringify({pid:process.pid}));
  await assert.rejects(tx.recoverAfterCrash({
   workRoot:x.journal,postRollback:async()=>true,transaction:path.join(x.journal,'txn-missing'),
   expectedTargets:x.steps.map(s=>s.path)
  }),/lock_owner_active/);
 }finally{x.dispose()}
});
test('recovery rejects non-allowlisted destination even with a journal',async()=>{
 const x=fixture();
 try{
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>false,postRollback:async()=>true}),/postinstall_health/);
  const dirs=fs.readdirSync(x.journal).filter(n=>n.startsWith('txn-'));
  assert.throws(()=>tx.restoreFromJournal(path.join(x.journal,dirs[0]),
   ['/tmp/not-a-verified-owner',...x.steps.slice(1).map(s=>s.path)]
  ),/recovery_target_mismatch/);
 }finally{x.dispose()}
});
test('concurrent mutation during install causes unverified rollback hard STOP',async()=>{
 const x=fixture();
 try{
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>true,postRollback:async()=>true,
   onRenamed:(key,i)=>{
    if(i===0)fs.writeFileSync(x.steps[2].path,'UNTRUSTED_DRIFT')
   }
  }),/rollback_incomplete/);
  // Fail-closed: never replace the concurrently modified unrelated bytes.
  assert.equal(fs.readFileSync(x.steps[2].path,'utf8'),'UNTRUSTED_DRIFT');
  assert.deepEqual(fs.readFileSync(x.steps[0].path),x.old[x.steps[0].path]);
 }finally{x.dispose()}
});

test('failed post-rollback service health leaves a blocking recovery journal',async()=>{
 const x=fixture();
 try{
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
    postInstall:async()=>false,postRollback:async()=>false
  }),/rollback_health_unverified/);
  x.original();
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
    postInstall:async()=>true,postRollback:async()=>true
  }),/pending_transaction_requires_recovery/);
  const txn=fs.readdirSync(x.journal).filter(n=>n.startsWith('txn-'))[0];
  const file=path.join(x.journal,txn);
  const result=await tx.recoverAfterCrash({workRoot:x.journal,
    transaction:file,expectedTargets:x.steps.map(s=>s.path),
    postRollback:async()=>true});
  assert.equal(result.status,'ROLLED_BACK');
 }finally{x.dispose()}
});
test('recovery without a trusted service health check fails closed',async()=>{
 const x=fixture();
 try{
  await assert.rejects(tx.recoverAfterCrash({workRoot:x.journal,
    transaction:path.join(x.journal,'txn-missing'),
    expectedTargets:x.steps.map(s=>s.path)}),/recovery_health_callback_required/);
 }finally{x.dispose()}
});

test('module exposes no standalone apply and rejects unbound plan',()=>{
 assert.equal(Object.isFrozen(tx),true);
 assert.equal(Object.keys(tx).some(x=>/sign|issueApproval|executeShell/.test(x)),false);
 assert.throws(()=>tx.checkPlan({schema:'invalid',steps:[]}),/plan_invalid/);
});
