'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const W=require('./honartik-universal-installer-native-journal-writer-v1.cjs');
const I=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const {CONTRACT}=require('./honartik-universal-installer-l4-v1.cjs');
const {PINNED_POLICY_SHA}=require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const supported=process.platform==='linux'&&typeof process.getuid==='function'&&process.getuid()!==0;
function fixture(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),
  'prhm-honartik217-journal-inspect-fixture-'));
 fs.chmodSync(root,0o700);
 try{
  const versions=path.join(root,'versions');fs.mkdirSync(versions,{mode:0o700});
  function make(label){
   const build=path.join(root,'.stage-'+label);
   fs.mkdirSync(path.join(build,'universal'),{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(build,'universal','cli.py'),
     'print('+JSON.stringify(label)+')\n',{mode:0o600});
   const digest=readTree(build).digest;
   fs.renameSync(build,path.join(versions,digest));
   return digest;
  }
  const old=make('previous'),next=make('candidate');
  fs.symlinkSync(path.join(versions,old),path.join(root,'current'));
  fs.writeFileSync(path.join(root,'installation.json'),
    JSON.stringify({digest:old,previous:null,entrypoint:'fixture-only'}),
    {mode:0o600});
  fs.writeFileSync(path.join(root,'deploy-project'),
    '#!/bin/sh\n# fixture-preimage\n',{mode:0o700});
  return run({root,old,next});
 }finally{fs.rmSync(root,{recursive:true,force:true})}
}
test('new writer exports no install command, approval or registration',()=>{
 assert.equal(W.ROOT_ACTION_REGISTERED,false);
 assert.equal(W.INSTALLER_MUTATION_EXPORTED,false);
 assert.equal(W.LIVE_APPROVAL_CONSUMPTION,false);
 assert.equal(W.apply,undefined);
 assert.equal(W.commitRoot,undefined);
 assert.equal(W.rootPath,undefined);
 assert.equal(W.prepareFixedRootJournal.length,0);
});
test('root PREPARED entrypoint is not callable by nonroot',()=>{
 if(typeof process.getuid==='function'&&process.getuid()!==0)
   assert.throws(()=>W.prepareFixedRootJournal(),/root_required/);
});
test('live writer has no caller chosen directory or candidate sha',()=>{
 assert.equal(W.prepareFixedRootJournal.length,0);
 assert.equal(CONTRACT.action,'honartik_universal_installer_upgrade_v1');
 assert.equal(PINNED_POLICY_SHA.length,64);
});
test('Linux: actual O_EXCL lock + canonical fsynced journal round trip',
 {skip:!supported},()=>{
 fixture(({root,old,next})=>{
  const result=W.prepareIsolatedJournalFixture(root,next);
  assert.match(result.id,/^[a-f0-9-]{36}$/);
  assert.equal(result.approved,false);
  assert.equal(result.installed,false);
  const journal=JSON.parse(fs.readFileSync(path.join(root,I.JOURNAL)));
  const lease=JSON.parse(fs.readFileSync(path.join(root,I.LOCK)));
  assert.equal(journal.journal_id,result.id);
  assert.equal(journal.lease_id,lease.lease_id);
  assert.equal(journal.lease_id,result.lease_id);
  assert.equal(journal.old_digest,old);
  assert.equal(journal.next_digest,next);
  assert.equal(journal.policy_sha256,PINNED_POLICY_SHA);
  assert.equal(fs.statSync(path.join(root,I.JOURNAL)).mode&0o777,0o600);
  assert.equal(fs.statSync(path.join(root,I.LOCK)).mode&0o777,0o600);
  assert.equal(I.inspectIsolatedJournalFixture(root,result.id,old,next),'PREPARED');
  assert.equal(fs.realpathSync(path.join(root,'current')),
    path.join(root,'versions',old));
 });
});
test('Linux: replay refuses to remove durable lock, journal or previous bytes',
 {skip:!supported},()=>{
 fixture(({root,old,next})=>{
  const done=W.prepareIsolatedJournalFixture(root,next);
  const journal=fs.readFileSync(path.join(root,I.JOURNAL));
  const lock=fs.readFileSync(path.join(root,I.LOCK));
  assert.throws(()=>W.prepareIsolatedJournalFixture(root,next),
   /old_journal_requires_reconciliation/);
  assert.deepEqual(fs.readFileSync(path.join(root,I.JOURNAL)),journal);
  assert.deepEqual(fs.readFileSync(path.join(root,I.LOCK)),lock);
  assert.equal(I.inspectIsolatedJournalFixture(root,done.id,old,next),'PREPARED');
 });
});
test('Linux: hard process death after durable lease prevents second attempt',
 {skip:!supported},()=>{
 fixture(({root,next})=>{
  const child=cp.spawnSync(process.execPath,[
   '-e','require(process.argv[1]).prepareIsolatedJournalFixture(process.argv[2],process.argv[3],"after_lease")',
   require.resolve('./honartik-universal-installer-native-journal-writer-v1.cjs'),
   root,next
  ],{timeout:10000,encoding:'utf8'});
  assert.equal(child.status,95,child.stderr);
  assert.equal(fs.existsSync(path.join(root,I.LOCK)),true);
  assert.equal(fs.existsSync(path.join(root,I.JOURNAL)),false);
  assert.throws(()=>W.prepareIsolatedJournalFixture(root,next),/EEXIST/);
  assert.equal(fs.existsSync(path.join(root,I.LOCK)),true);
 });
});
test('Linux: hard process death after fsynced PREPARED survives lost ack',
 {skip:!supported},()=>{
 fixture(({root,old,next})=>{
  const child=cp.spawnSync(process.execPath,[
   '-e','require(process.argv[1]).prepareIsolatedJournalFixture(process.argv[2],process.argv[3],"after_journal")',
   require.resolve('./honartik-universal-installer-native-journal-writer-v1.cjs'),
   root,next
  ],{timeout:10000,encoding:'utf8'});
  assert.equal(child.status,96,child.stderr);
  const journal=JSON.parse(fs.readFileSync(path.join(root,I.JOURNAL)));
  assert.equal(I.inspectIsolatedJournalFixture(root,journal.journal_id,old,next),
   'PREPARED');
  assert.throws(()=>W.prepareIsolatedJournalFixture(root,next),
   /old_journal_requires_reconciliation/);
 });
});
test('Linux: wrong source digest or tampered bundle denied before acquiring lock',
 {skip:!supported},()=>{
 fixture(({root,next})=>{
  fs.writeFileSync(path.join(root,'versions',next,'universal','cli.py'),
   'tampered\n');
  assert.throws(()=>W.prepareIsolatedJournalFixture(root,next),
   /candidate_bundle_drift/);
  assert.equal(fs.existsSync(path.join(root,I.LOCK)),false);
  assert.equal(fs.existsSync(path.join(root,I.JOURNAL)),false);
 });
});
test('Linux: pointer escape and symlink source denied without lock mutation',
 {skip:!supported},()=>{
 fixture(({root,next})=>{
  fs.unlinkSync(path.join(root,'current'));
  fs.symlinkSync(os.tmpdir(),path.join(root,'current'));
  assert.throws(()=>W.prepareIsolatedJournalFixture(root,next),
   /preimage_pointer_drift/);
  assert.equal(fs.existsSync(path.join(root,I.LOCK)),false);
 });
});
test('Linux: no outside-fixture writes and no permissive fixture directory',
 {skip:!supported},()=>{
 assert.throws(()=>W.prepareIsolatedJournalFixture('/etc','a'.repeat(64)),
   /fixture_path_denied/);
 fixture(({root,next})=>{
  fs.chmodSync(root,0o777);
  assert.throws(()=>W.prepareIsolatedJournalFixture(root,next),
   /directory_untrusted/);
  assert.equal(fs.existsSync(path.join(root,I.LOCK)),false);
 });
});
test('Linux: lock identity tampering prevents independent PREPARED readback',
 {skip:!supported},()=>{
 fixture(({root,old,next})=>{
  const r=W.prepareIsolatedJournalFixture(root,next);
  const f=path.join(root,I.LOCK);
  const d=JSON.parse(fs.readFileSync(f));
  d.lease_id='99999999-8888-4777-8666-555555555555';
  fs.writeFileSync(f,JSON.stringify(d)+'\n');
  assert.throws(()=>I.inspectIsolatedJournalFixture(root,r.id,old,next),
   /lease_record_mismatch/);
 });
});

const F=require('./honartik-universal-installer-native-l4-fence-v1.cjs');
const {ARGUMENTS_SHA}=require('./honartik-universal-installer-native-approval-gate-v1.cjs');
function reserveFixtureProof(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-honartik217-fence-fixture-'));
 fs.chmodSync(dir,0o700);
 const proof={
   ok:true,action:CONTRACT.action,
   request_id:'11111111-2222-4333-8444-555555555555',
   approval_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
   policy_sha256:PINNED_POLICY_SHA,arguments_sha256:ARGUMENTS_SHA,
   signature_verified:true,consumed_ledger_verified:true,
   execution_fence_reserved:false,installer_upgraded:false
 };
 try{return {dir,bound:F.reserveIsolatedFixtureFence(dir,proof)}}
 catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e}
}
test('source-only root approval binding is forbidden for nonroot',()=>{
 if(typeof process.getuid==='function'&&process.getuid()!==0){
  assert.throws(()=>W.bindFixedRootSignedApproval({
   journalId:'11111111-2222-4333-8444-555555555555',
   requestId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
   rootSealedTokenLoader:()=>''}),/binding_root_required/);
 }
});
test('Linux: one-use fenced signed proof binds durable PREPARED journal once',
 {skip:!supported},()=>{
 fixture(({root,old,next})=>{
  const j=W.prepareIsolatedJournalFixture(root,next);
  const one=reserveFixtureProof();
  try{
   const result=W.bindIsolatedApprovalFixture(root,j.id,old,next,one.bound);
   assert.equal(result.ok,true);
   assert.equal(result.signed_consumed_once,true);
   assert.equal(result.installer_upgraded,false);
   assert.equal(result.approval_id,one.bound.approval_id);
   assert.equal(I.inspectIsolatedJournalFixture(root,j.id,old,next),'PREPARED');
   const record=JSON.parse(fs.readFileSync(path.join(root,I.JOURNAL)));
   assert.equal(record.approval_id,one.bound.approval_id);
   assert.equal(record.request_id,one.bound.request_id);
   assert.equal(fs.existsSync(path.join(root,I.LOCK)),true);
   assert.equal(fs.realpathSync(path.join(root,'current')),
     path.join(root,'versions',old));
   const bytes=fs.readFileSync(path.join(root,I.JOURNAL));
   assert.throws(()=>W.bindIsolatedApprovalFixture(root,j.id,old,next,one.bound),
     /binding_journal_drift/);
   assert.deepEqual(fs.readFileSync(path.join(root,I.JOURNAL)),bytes);
  }finally{fs.rmSync(one.dir,{recursive:true,force:true})}
 });
});
test('Linux: wrong policy, arguments or absent one-use fence rejected without mutation',
 {skip:!supported},()=>{
 fixture(({root,old,next})=>{
  const j=W.prepareIsolatedJournalFixture(root,next);
  const one=reserveFixtureProof();
  try{
   const original=fs.readFileSync(path.join(root,I.JOURNAL));
   for(const changes of [
    {policy_sha256:'f'.repeat(64)},
    {arguments_sha256:'f'.repeat(64)},
    {durable_one_time_fence:false},
    {approval_id:'../etc/passwd'},
    {installer_upgraded:true}
   ]){
    assert.throws(()=>W.bindIsolatedApprovalFixture(root,j.id,old,next,
      {...one.bound,...changes}),/signed_fence_binding_invalid/);
    assert.deepEqual(fs.readFileSync(path.join(root,I.JOURNAL)),original);
   }
  }finally{fs.rmSync(one.dir,{recursive:true,force:true})}
 });
});
test('Linux: crashed binding before journal does not counterfeit approval',
 {skip:!supported},()=>{
 fixture(({root,old,next})=>{
  const j=W.prepareIsolatedJournalFixture(root,next);
  const one=reserveFixtureProof();
  try{
   const child=cp.spawnSync(process.execPath,[
    '-e','require(process.argv[1]).bindIsolatedApprovalFixture(process.argv[2],process.argv[3],process.argv[4],process.argv[5],JSON.parse(process.argv[6]),"after_fence")',
    require.resolve('./honartik-universal-installer-native-journal-writer-v1.cjs'),
    root,j.id,old,next,JSON.stringify(one.bound)],{encoding:'utf8',timeout:10000});
   assert.equal(child.status,97,child.stderr);
   const record=JSON.parse(fs.readFileSync(path.join(root,I.JOURNAL)));
   assert.equal(record.request_id,null);
   assert.equal(record.approval_id,null);
   assert.equal(I.inspectIsolatedJournalFixture(root,j.id,old,next),'PREPARED');
   assert.equal(fs.existsSync(path.join(one.dir,one.bound.approval_id+'.json')),true);
   assert.throws(()=>F.reserveIsolatedFixtureFence(one.dir,{
    ok:true,action:CONTRACT.action,request_id:one.bound.request_id,
    approval_id:one.bound.approval_id,policy_sha256:PINNED_POLICY_SHA,
    arguments_sha256:ARGUMENTS_SHA,signature_verified:true,
    consumed_ledger_verified:true,execution_fence_reserved:false,
    installer_upgraded:false
   }),/approval_replayed/);
  }finally{fs.rmSync(one.dir,{recursive:true,force:true})}
 });
});
test('Linux: crash after journal fsync preserves canonical receipt and lease',
 {skip:!supported},()=>{
 fixture(({root,old,next})=>{
  const j=W.prepareIsolatedJournalFixture(root,next);
  const one=reserveFixtureProof();
  try{
   const child=cp.spawnSync(process.execPath,[
    '-e','require(process.argv[1]).bindIsolatedApprovalFixture(process.argv[2],process.argv[3],process.argv[4],process.argv[5],JSON.parse(process.argv[6]),"after_journal")',
    require.resolve('./honartik-universal-installer-native-journal-writer-v1.cjs'),
    root,j.id,old,next,JSON.stringify(one.bound)],{encoding:'utf8',timeout:10000});
   assert.equal(child.status,98,child.stderr);
   assert.equal(I.inspectIsolatedJournalFixture(root,j.id,old,next),'PREPARED');
   const record=JSON.parse(fs.readFileSync(path.join(root,I.JOURNAL)));
   assert.equal(record.approval_id,one.bound.approval_id);
   assert.equal(record.request_id,one.bound.request_id);
   assert.equal(fs.existsSync(path.join(root,I.LOCK)),true);
   assert.throws(()=>W.bindIsolatedApprovalFixture(root,j.id,old,next,one.bound),
     /binding_journal_drift/);
  }finally{fs.rmSync(one.dir,{recursive:true,force:true})}
 });
});
