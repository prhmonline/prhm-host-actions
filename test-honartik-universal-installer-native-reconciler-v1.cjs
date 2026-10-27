'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const W=require('./honartik-universal-installer-native-journal-writer-v1.cjs');
const I=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const R=require('./honartik-universal-installer-native-reconciler-v1.cjs');
const F=require('./honartik-universal-installer-journal-finalize-fixture-v1.cjs');
const L=require('./honartik-universal-installer-native-l4-fence-v1.cjs');
const G=require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const {CONTRACT:C}=require('./honartik-universal-installer-l4-v1.cjs');
const linux=process.platform==='linux'&&process.getuid?.()!==0;
function setup(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-honartik217-journal-inspect-fixture-'));
 fs.chmodSync(root,0o700);
 let fence;
 try{
  const versions=path.join(root,'versions');fs.mkdirSync(versions,{mode:0o700});
  function make(name){
   const source=path.join(root,'.source-'+name);
   fs.mkdirSync(path.join(source,'universal'),{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(source,'universal','cli.py'),'print('+JSON.stringify(name)+')\n',{mode:0o600});
   const digest=readTree(source).digest;
   fs.renameSync(source,path.join(versions,digest));
   return digest;
  }
  const old=make('old'),next=make('next');
  fs.symlinkSync(path.join(versions,old),path.join(root,'current'));
  const manifest=Buffer.from(JSON.stringify({digest:old,previous:null,entrypoint:'fixture-only'}));
  const wrapper=Buffer.from('#!/bin/sh\n# original fixture\n');
  fs.writeFileSync(path.join(root,'installation.json'),manifest,{mode:0o600});
  fs.writeFileSync(path.join(root,'deploy-project'),wrapper,{mode:0o700});
  const prepared=W.prepareIsolatedJournalFixture(root,next);
  const id=prepared.id;
  fence=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-honartik217-fence-fixture-'));
  fs.chmodSync(fence,0o700);
  const proof={ok:true,action:C.action,
   request_id:'11111111-2222-4333-8444-555555555555',
   approval_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
   policy_sha256:G.PINNED_POLICY_SHA,
   arguments_sha256:G.ARGUMENTS_SHA,
   signature_verified:true,consumed_ledger_verified:true,
   execution_fence_reserved:false,installer_upgraded:false};
  const bound=L.reserveIsolatedFixtureFence(fence,proof);
  W.bindIsolatedApprovalFixture(root,id,old,next,bound);
  const marker={schema:'prhm.honartik217.fixed-python-attempt.v1',action:C.action,
   state:'started_once_recovery_only',journal_id:id,
   request_id:proof.request_id,approval_id:proof.approval_id,
   old_digest:C.existing_digest,new_digest:C.candidate_digest};
  // Test's old/next differ from Production's fixed SHAs. Only the nonroot
  // fixture adjusts marker hashes to match its uniquely created bundles.
  marker.old_digest=old;marker.new_digest=next;
  const attempt=path.join(root,'python-attempt-started.json');
  fs.writeFileSync(attempt,JSON.stringify(marker)+'\n',{mode:0o600});
  return fn({root,old,next,id,manifest,wrapper,attempt});
 }finally{
  fs.rmSync(root,{recursive:true,force:true});
  if(fence)fs.rmSync(fence,{recursive:true,force:true});
 }
}
function fixtureCall(o,op,crash){
 return R.reconcileIsolatedFixture(o.root,o.id,o.old,o.next,op,crash);
}
function hardCrash(o,op,stage,code){
 const c=cp.spawnSync(process.execPath,[
  '-e','require(process.argv[1]).reconcileIsolatedFixture(...JSON.parse(process.argv[2]))',
  require.resolve('./honartik-universal-installer-native-reconciler-v1.cjs'),
  JSON.stringify([o.root,o.id,o.old,o.next,op,stage])
 ],{timeout:10000,encoding:'utf8'});
 assert.equal(c.status,code,c.stderr||c.stdout);
}
test('no root registration, CLI, generic arbitrary shell, or automatic journal retirement',()=>{
 assert.equal(R.ROOT_ACTION_REGISTERED,false);
 assert.equal(R.PRODUCTION_EXECUTION_AUTHORIZED,false);
 assert.equal(R.TERMINAL_ARCHIVAL_IMPLEMENTED,false);
 assert.equal(R.run,undefined);
 assert.equal(R.exec,undefined);
 assert.equal(R.reconcileFixedRootJournal.length,2);
});
test('nonroot never enters real Production reconciliation',()=>{
 if(process.getuid?.()!==0)
  assert.throws(()=>R.reconcileFixedRootJournal('11111111-2222-4333-8444-555555555555','rollback'),
   /root_required/);
});
test('fixture path escape denied before reading or writing',()=>{
 if(process.getuid?.()!==0)
  assert.throws(()=>R.reconcileIsolatedFixture('/etc',
   '11111111-2222-4333-8444-555555555555','a'.repeat(64),'b'.repeat(64),'rollback'),
   /fixture_scope_denied/);
});
test('Linux: committed cutover creates durable COMMITTED after one-time attempt',
 {skip:!linux},()=>{
 setup(o=>{
  F.simulateCutover(o.root,o.id,o.old,o.next);
  const result=fixtureCall(o,'commit');
  assert.equal(result.state,'COMMITTED');assert.equal(result.lease_retained,true);
  assert.equal(I.inspectIsolatedJournalFixture(o.root,o.id,o.old,o.next),'COMMITTED');
  assert.equal(fixtureCall(o,'inspect').idempotent,true);
  assert.throws(()=>fixtureCall(o,'rollback'),/terminal_never_mutated/);
  assert.equal(fs.existsSync(path.join(o.root,I.LOCK)),true);
  assert.equal(fs.existsSync(path.join(o.root,I.JOURNAL)),true);
 });
});
test('Linux: missing one-time execution record prohibits COMMITTED', {skip:!linux},()=>{
 setup(o=>{
  F.simulateCutover(o.root,o.id,o.old,o.next);
  fs.unlinkSync(o.attempt);
  assert.throws(()=>fixtureCall(o,'commit'),/ENOENT|file_untrusted/);
  assert.equal(I.inspectIsolatedJournalFixture(o.root,o.id,o.old,o.next),'PREPARED');
  assert.equal(fs.existsSync(path.join(o.root,I.LOCK)),true);
 });
});
test('Linux: wrong request or approval prevents commit and keeps PREPARED', {skip:!linux},()=>{
 setup(o=>{
  F.simulateCutover(o.root,o.id,o.old,o.next);
  const a=JSON.parse(fs.readFileSync(o.attempt));
  a.approval_id='77777777-8888-4888-8888-777777777777';
  fs.writeFileSync(o.attempt,JSON.stringify(a)+'\n');
  assert.throws(()=>fixtureCall(o,'commit'),/attempt_or_approval_unbound/);
  assert.equal(I.inspectIsolatedJournalFixture(o.root,o.id,o.old,o.next),'PREPARED');
 });
});
test('Linux: commit cannot finalize corrupted postimage', {skip:!linux},()=>{
 setup(o=>{
  F.simulateCutover(o.root,o.id,o.old,o.next);
  fs.writeFileSync(path.join(o.root,'deploy-project'),'bad wrapper');
  assert.throws(()=>fixtureCall(o,'commit'),/commit_file_modes_invalid|commit_manifest_drift|commit_bundle_drift|file_untrusted|ENOENT|post_manifest_json|untrusted_file|commit_/);
  // The native commit handler validates mode/digest/pointer, and this test
  // deliberately corrupts a postimage rather than granting COMMITTED.
  assert.equal(I.inspectIsolatedJournalFixture(o.root,o.id,o.old,o.next),'PREPARED');
 });
});
for(const [point,code] of [['after_pointer',124],['after_manifest',125],
 ['after_wrapper',126],['after_terminal_marker',123]]){
 test('Linux: crash recovery '+point+' restores exact preimages and keeps lock',
  {skip:!linux},()=>{
  setup(o=>{
   F.simulateCutover(o.root,o.id,o.old,o.next);
   hardCrash(o,'rollback',point,code);
   const r=point==='after_terminal_marker'?
    fixtureCall(o,'inspect'):fixtureCall(o,'rollback');
   assert.equal(r.state,'ROLLED_BACK');
   if(point==='after_terminal_marker')
    assert.throws(()=>fixtureCall(o,'rollback'),/terminal_never_mutated/);
   assert.equal(I.inspectIsolatedJournalFixture(o.root,o.id,o.old,o.next),'ROLLED_BACK');
   assert.deepEqual(fs.readFileSync(path.join(o.root,'installation.json')),o.manifest);
   assert.deepEqual(fs.readFileSync(path.join(o.root,'deploy-project')),o.wrapper);
   assert.equal(fs.statSync(path.join(o.root,'deploy-project')).mode&0o777,0o700);
   assert.equal(fs.existsSync(path.join(o.root,I.LOCK)),true);
  });
 });
}
test('Linux: crash after durable COMMITTED must never roll back', {skip:!linux},()=>{
 setup(o=>{
  F.simulateCutover(o.root,o.id,o.old,o.next);
  hardCrash(o,'commit','after_terminal_marker',122);
  assert.equal(I.inspectIsolatedJournalFixture(o.root,o.id,o.old,o.next),'COMMITTED');
  const current=fs.realpathSync(path.join(o.root,'current'));
  assert.equal(current,path.join(o.root,'versions',o.next));
  assert.throws(()=>fixtureCall(o,'rollback'),/terminal_never_mutated/);
  assert.equal(fs.existsSync(path.join(o.root,I.LOCK)),true);
 });
});
test('Linux: mismatched journal/lease retains recovery evidence', {skip:!linux},()=>{
 setup(o=>{
  F.simulateCutover(o.root,o.id,o.old,o.next);
  const lease=path.join(o.root,I.LOCK);
  const value=JSON.parse(fs.readFileSync(lease));
  value.lease_id='99999999-8888-4777-8666-555555555555';
  fs.writeFileSync(lease,JSON.stringify(value)+'\n');
  assert.throws(()=>fixtureCall(o,'commit'),/lease_record_mismatch/);
  assert.equal(fs.existsSync(lease),true);
  assert.equal(fs.existsSync(path.join(o.root,I.JOURNAL)),true);
 });
});
