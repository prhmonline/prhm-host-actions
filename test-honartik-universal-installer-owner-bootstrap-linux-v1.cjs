/* SOURCE-ONLY: Honartik Issue #217 registration transaction review port from #221 exact 6effffd41c68f51bc394d42d7f334f23284dafb0. Not a registered Root-of-Trust action, L4 approval issuer, standalone CLI, or Production deployment. Independent reviewer must verify fixed owner/policy/asset target binding before any activation. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const tx=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
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
   path.join(__dirname,'test-honartik-universal-installer-owner-bootstrap-crash-child-v1.cjs'),x.base
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


test('throwing post-rollback verifier leaves FAIL-CLOSED journal',async()=>{
 const x=fixture();
 try{
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>false,
   postRollback:async()=>{throw Error('RESTART_FAILURE')}
  }),/rollback_health_unverified/);
  const txn=fs.readdirSync(x.journal).filter(n=>n.startsWith('txn-'))[0];
  const j=JSON.parse(fs.readFileSync(path.join(x.journal,txn,'journal.json')));
  assert.equal(j.status,'ROLLBACK_FAILED');
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>true,postRollback:async()=>true
  }),/pending_transaction_requires_recovery/);
 }finally{x.dispose()}
});
test('throwing crash recovery health remains blocked until verified',async()=>{
 if(process.platform!=='linux')return;
 const x=fixture();
 try{
  const run=cp.spawnSync(process.execPath,[
   path.join(__dirname,'test-honartik-universal-installer-owner-bootstrap-crash-child-v1.cjs'),x.base
  ],{timeout:10000,encoding:'utf8'});
  assert.equal(run.signal,'SIGKILL');
  const txn=fs.readdirSync(x.journal).filter(n=>n.startsWith('txn-'))[0];
  const target=path.join(x.journal,txn);
  await assert.rejects(tx.recoverAfterCrash({
   workRoot:x.journal,transaction:target,
   expectedTargets:x.steps.map(s=>s.path),
   postRollback:async()=>{throw Error('SERVICE_NOT_HEALTHY')}
  }),/recovery_service_health_unverified/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target,'journal.json'))).status,'ROLLBACK_FAILED');
  const ok=await tx.recoverAfterCrash({
   workRoot:x.journal,transaction:target,
   expectedTargets:x.steps.map(s=>s.path),postRollback:async()=>true
  });
  assert.equal(ok.status,'ROLLED_BACK');
  x.original();
 }finally{x.dispose()}
});

function withAsset(x,{existing=false}={}){
 const dir=path.join(x.base,'asset-dir');
 fs.mkdirSync(dir,{mode:0o700});
 const p=path.join(dir,'verified-action.cjs');
 const old=Buffer.from('old-action-asset\\n');
 if(existing)fs.writeFileSync(p,old,{mode:0o600});
 const nextBytes=Buffer.from('new-verified-action-asset\\n');
 x.plan.assets=[{path:p,nextBytes,afterSha:tx.HASH(nextBytes)}];
 return {path:p,before:existing?old:null,nextBytes};
}
test('atomic release commits Git-bound asset and four owner files together',async()=>{
 const x=fixture();
 try{
  const a=withAsset(x);
  const r=await tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>true,postRollback:async()=>true});
  assert.equal(r.status,'COMMITTED');
  assert.deepEqual(fs.readFileSync(a.path),a.nextBytes);
  assert.equal(fs.statSync(a.path).mode&0o777,0o600);
  const journal=JSON.parse(fs.readFileSync(path.join(r.transaction,'journal.json')));
  assert.equal(journal.assets.length,1);
  assert.equal(journal.assets[0].existed,false);
  for(const st of x.steps)assert.equal(tx.HASH(fs.readFileSync(st.path)),st.afterSha);
 }finally{x.dispose()}
});
test('failure after creating an asset removes asset and rolls back owners',async()=>{
 const x=fixture();
 try{
  const a=withAsset(x);
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>false,postRollback:async()=>true}),/postinstall_health/);
  x.original();
  assert.equal(fs.existsSync(a.path),false);
 }finally{x.dispose()}
});
test('existing asset original bytes are preserved on failed install',async()=>{
 const x=fixture();
 try{
  const a=withAsset(x,{existing:true});
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>false,postRollback:async()=>true}),/postinstall_health/);
  x.original();
  assert.deepEqual(fs.readFileSync(a.path),a.before);
  assert.equal(fs.statSync(a.path).mode&0o777,0o600);
 }finally{x.dispose()}
});
test('untrusted asset mutation during install blocks recovery without deleting it',async()=>{
 const x=fixture();
 try{
  const a=withAsset(x);
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>true,postRollback:async()=>true,
   onRenamed:key=>{if(key==='asset-0')fs.writeFileSync(a.path,'CONCURRENT_CHANGE')}
  }),/rollback_incomplete/);
  assert.equal(fs.readFileSync(a.path,'utf8'),'CONCURRENT_CHANGE');
  const txn=fs.readdirSync(x.journal).find(n=>n.startsWith('txn-'));
  const j=JSON.parse(fs.readFileSync(path.join(x.journal,txn,'journal.json')));
  assert.equal(j.status,'ROLLBACK_FAILED');
 }finally{x.dispose()}
});
test('SIGKILL after asset rename restores newly created asset during independent recovery',async()=>{
 if(process.platform!=='linux')return;
 const x=fixture();
 try{
  const a=withAsset(x);
  const run=cp.spawnSync(process.execPath,[
   path.join(__dirname,'test-honartik-universal-installer-owner-bootstrap-crash-child-v1.cjs'),x.base,'asset'
  ],{timeout:10000,encoding:'utf8'});
  assert.equal(run.signal,'SIGKILL',JSON.stringify(run));
  assert.equal(fs.existsSync(a.path),true);
  const txn=fs.readdirSync(x.journal).find(n=>n.startsWith('txn-'));
  const recovery=await tx.recoverAfterCrash({workRoot:x.journal,
   transaction:path.join(x.journal,txn),expectedTargets:x.steps.map(z=>z.path),
   expectedAssets:[a.path],postRollback:async()=>true});
  assert.equal(recovery.status,'ROLLED_BACK');
  assert.equal(fs.existsSync(a.path),false);
  x.original();
 }finally{x.dispose()}
});
test('asset journal cannot authorize rollback outside trusted asset target list',async()=>{
 const x=fixture();
 try{
  const a=withAsset(x);
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>false,postRollback:async()=>true}),/postinstall_health/);
  const txn=fs.readdirSync(x.journal).find(n=>n.startsWith('txn-'));
  assert.throws(()=>tx.restoreFromJournal(path.join(x.journal,txn),
    x.steps.map(z=>z.path),[]),/recovery_target_mismatch/);
  assert.throws(()=>tx.restoreFromJournal(path.join(x.journal,txn),
    x.steps.map(z=>z.path),['/tmp/wrong']),/recovery_target_mismatch/);
 }finally{x.dispose()}
});
test('crash during PREPARING recovers without requiring unfinished backups',async()=>{
 const x=fixture();
 try{
  const a=withAsset(x);
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>false,postRollback:async()=>true}),/postinstall_health/);
  const txn=fs.readdirSync(x.journal).find(n=>n.startsWith('txn-'));
  const dir=path.join(x.journal,txn),jf=path.join(dir,'journal.json');
  const j=JSON.parse(fs.readFileSync(jf));
  j.status='PREPARING';
  fs.writeFileSync(jf,JSON.stringify(j));
  for(const name of fs.readdirSync(dir)){
   if(name.endsWith('.before'))fs.unlinkSync(path.join(dir,name));
  }
  const recovered=await tx.recoverAfterCrash({workRoot:x.journal,
   transaction:dir,expectedTargets:x.steps.map(z=>z.path),
   expectedAssets:[a.path],postRollback:async()=>true});
  assert.equal(recovered.status,'ROLLED_BACK');
  x.original();
  assert.equal(fs.existsSync(a.path),false);
 }finally{x.dispose()}
});
test('PREPARING must refuse owner drift instead of trusting incomplete backups',async()=>{
 const x=fixture();
 try{
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.journal,
   postInstall:async()=>false,postRollback:async()=>true}),/postinstall_health/);
  const txn=fs.readdirSync(x.journal).find(n=>n.startsWith('txn-'));
  const dir=path.join(x.journal,txn),jf=path.join(dir,'journal.json');
  const j=JSON.parse(fs.readFileSync(jf));
  j.status='PREPARING';fs.writeFileSync(jf,JSON.stringify(j));
  fs.writeFileSync(x.steps[0].path,'CONCURRENT_UNTRUSTED_CONTENT');
  await assert.rejects(tx.recoverAfterCrash({workRoot:x.journal,
   transaction:dir,expectedTargets:x.steps.map(z=>z.path),
   postRollback:async()=>true}),/preparing_owner_drift/);
  assert.equal(fs.readFileSync(x.steps[0].path,'utf8'),'CONCURRENT_UNTRUSTED_CONTENT');
 }finally{x.dispose()}
});
test('module exposes no standalone apply and rejects unbound plan',()=>{
 assert.equal(Object.isFrozen(tx),true);
 assert.equal(Object.keys(tx).some(x=>/sign|issueApproval|executeShell/.test(x)),false);
 assert.throws(()=>tx.checkPlan({schema:'invalid',steps:[]}),/plan_invalid/);
});
