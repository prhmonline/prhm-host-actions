'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const I=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const W=require('./honartik-universal-installer-native-journal-writer-v1.cjs');
const F=require('./honartik-universal-installer-journal-finalize-fixture-v1.cjs');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const linux=process.platform==='linux'&&typeof process.getuid==='function'&&process.getuid()!==0;
function sandbox(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),
  'prhm-honartik217-journal-inspect-fixture-'));
 fs.chmodSync(root,0o700);
 try{
  const versions=path.join(root,'versions');fs.mkdirSync(versions,{mode:0o700});
  function make(label){
   const b=path.join(root,'.source-'+label);
   fs.mkdirSync(path.join(b,'universal'),{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(b,'universal','cli.py'),'print('+JSON.stringify(label)+')\n',
    {mode:0o600});
   const h=readTree(b).digest;
   fs.renameSync(b,path.join(versions,h));
   return h;
  }
  const old=make('old'),next=make('candidate');
  fs.symlinkSync(path.join(versions,old),path.join(root,'current'));
  fs.writeFileSync(path.join(root,'installation.json'),
   JSON.stringify({digest:old,previous:null,entrypoint:'fixture-only'}),
   {mode:0o600});
  fs.writeFileSync(path.join(root,'deploy-project'),
   '#!/bin/sh\n# fixture-previous-wrapper\n',{mode:0o700});
  return run({root,old,next});
 }finally{fs.rmSync(root,{recursive:true,force:true})}
}
function prepared(f){
 const result=W.prepareIsolatedJournalFixture(f.root,f.next);
 return {...f,id:result.id};
}
function child(method,args,exit){
 const c=cp.spawnSync(process.execPath,[
  '-e','require(process.argv[1])[process.argv[2]](...process.argv.slice(3))',
  require.resolve('./honartik-universal-installer-journal-finalize-fixture-v1.cjs'),
  method,...args
 ],{encoding:'utf8',timeout:10000});
 assert.equal(c.status,exit,JSON.stringify(c));
}
test('finalizer exports only nonroot fixtures, not a native Production root action',()=>{
 assert.equal(F.ROOT_EXECUTOR_EXPORTED,false);
 assert.equal(F.PRODUCTION_EXECUTION_AUTHORIZED,false);
 assert.equal(F.LIVE_LEVEL4_APPROVAL_CONSUMED,false);
 assert.equal(F.installFixedRoot,undefined);
 assert.equal(F.issueApproval,undefined);
});
test('fixture routes reject production and untrusted path before disk writes',()=>{
 if(typeof process.getuid==='function'&&process.getuid()!==0){
  assert.throws(()=>F.commitFixture('/usr/local/libexec/deploy-control/universal',
   '11111111-2222-4333-8444-555555555555','a'.repeat(64),'b'.repeat(64)),
   /fixture_path_denied/);
 }
});
test('fixture module has no privileged native register/entrypoint surface',()=>{
 assert.deepEqual(Object.keys(F).sort(),[
  'simulateCutover','commitFixture','recoverFixture',
  'ROOT_EXECUTOR_EXPORTED','PRODUCTION_EXECUTION_AUTHORIZED',
  'LIVE_LEVEL4_APPROVAL_CONSUMED'].sort());
});
test('Linux: PREPARED cutover to COMMITTED fsyncs and re-reads exactly',
 {skip:!linux},()=>{
 sandbox(f=>{
  const s=prepared(f);
  F.simulateCutover(f.root,s.id,f.old,f.next);
  const ok=F.commitFixture(f.root,s.id,f.old,f.next);
  assert.equal(ok.committed,true);
  assert.equal(ok.lock_preserved,true);
  assert.equal(I.inspectIsolatedJournalFixture(f.root,s.id,f.old,f.next),'COMMITTED');
  const recover=F.recoverFixture(f.root,s.id,f.old,f.next);
  assert.equal(recover.committed,true);
  assert.equal(recover.rolled_back,false);
  assert.equal(fs.realpathSync(path.join(f.root,'current')),
    path.join(f.root,'versions',f.next));
  assert.equal(fs.existsSync(path.join(f.root,I.LOCK)),true);
  assert.throws(()=>W.prepareIsolatedJournalFixture(f.root,f.old),
    /old_journal_requires_reconciliation/);
 });
});
test('Linux: hard-exit after fsynced COMMITTED never permits rollback',
 {skip:!linux},()=>{
 sandbox(f=>{
  const s=prepared(f);
  F.simulateCutover(f.root,s.id,f.old,f.next);
  child('commitFixture',[f.root,s.id,f.old,f.next,'after_durable_commit'],105);
  assert.equal(I.inspectIsolatedJournalFixture(f.root,s.id,f.old,f.next),
   'COMMITTED');
  const r=F.recoverFixture(f.root,s.id,f.old,f.next);
  assert.equal(r.rolled_back,false);
  assert.equal(fs.realpathSync(path.join(f.root,'current')),
   path.join(f.root,'versions',f.next));
 });
});
for(const [point,exit] of [['after_pointer',102],['after_manifest',103],
 ['after_wrapper',104]]){
 test('Linux: interrupted cutover '+point+' restores exact original bytes',
  {skip:!linux},()=>{
  sandbox(f=>{
   const s=prepared(f);
   const origM=fs.readFileSync(path.join(f.root,'installation.json'));
   const origW=fs.readFileSync(path.join(f.root,'deploy-project'));
   child('simulateCutover',[f.root,s.id,f.old,f.next,point],exit);
   const r=F.recoverFixture(f.root,s.id,f.old,f.next);
   assert.equal(r.rolled_back,true);
   assert.equal(r.exact_preimage,true);
   assert.deepEqual(fs.readFileSync(path.join(f.root,'installation.json')),origM);
   assert.deepEqual(fs.readFileSync(path.join(f.root,'deploy-project')),origW);
   assert.equal(fs.realpathSync(path.join(f.root,'current')),
     path.join(f.root,'versions',f.old));
   assert.equal(I.inspectIsolatedJournalFixture(f.root,s.id,f.old,f.next),
     'ROLLED_BACK');
   assert.equal(fs.existsSync(path.join(f.root,I.LOCK)),true);
  });
 });
}
for(const [point,exit] of [['after_restore_pointer',106],
 ['after_restore_manifest',107],['after_restore_wrapper',108]]){
 test('Linux: second recovery after crash '+point+' is idempotent',
  {skip:!linux},()=>{
  sandbox(f=>{
   const s=prepared(f);
   F.simulateCutover(f.root,s.id,f.old,f.next);
   child('recoverFixture',[f.root,s.id,f.old,f.next,point],exit);
   const done=F.recoverFixture(f.root,s.id,f.old,f.next);
   assert.equal(done.rolled_back,true);
   assert.equal(F.recoverFixture(f.root,s.id,f.old,f.next).already_recovered,true);
  });
 });
}
test('Linux: crash after durable ROLLED_BACK remains idempotently closed',
 {skip:!linux},()=>{
 sandbox(f=>{
  const s=prepared(f);
  F.simulateCutover(f.root,s.id,f.old,f.next);
  child('recoverFixture',[f.root,s.id,f.old,f.next,'after_durable_rollback'],109);
  const r=F.recoverFixture(f.root,s.id,f.old,f.next);
  assert.equal(r.already_recovered,true);
  assert.equal(r.rolled_back,true);
 });
});
test('Linux: postimage corruption cannot write COMMITTED marker',
 {skip:!linux},()=>{
 sandbox(f=>{
  const s=prepared(f);
  F.simulateCutover(f.root,s.id,f.old,f.next);
  fs.writeFileSync(path.join(f.root,'deploy-project'),'forged wrapper');
  assert.throws(()=>F.commitFixture(f.root,s.id,f.old,f.next),
   /postimage_mismatch/);
  assert.equal(I.inspectIsolatedJournalFixture(f.root,s.id,f.old,f.next),
   'PREPARED');
  assert.equal(fs.existsSync(path.join(f.root,I.LOCK)),true);
 });
});
test('Linux: changed old bundle blocks rollback without clearing the fence',
 {skip:!linux},()=>{
 sandbox(f=>{
  const s=prepared(f);
  F.simulateCutover(f.root,s.id,f.old,f.next);
  fs.writeFileSync(path.join(f.root,'versions',f.old,'universal','cli.py'),
   'tampered old');
  assert.throws(()=>F.recoverFixture(f.root,s.id,f.old,f.next),
   /old_bundle_tampered/);
  assert.equal(fs.existsSync(path.join(f.root,I.LOCK)),true);
 });
});
