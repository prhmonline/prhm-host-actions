'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {CONTRACT}=require('./honartik-universal-installer-l4-v1.cjs');
const {ARGUMENTS_SHA,PINNED_POLICY_SHA}=
  require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const J=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const h=b=>crypto.createHash('sha256').update(b).digest('hex');
const jid='11111111-2222-4333-8444-555555555555';
const lease='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const rid='22222222-3333-4444-8555-666666666666';
const aid='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const skipLinux=process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()===0;
function make(old=CONTRACT.existing_digest,next=CONTRACT.candidate_digest,state='PREPARED'){
 const preManifest=Buffer.from(JSON.stringify({digest:old,previous:null,entrypoint:'fixture-only'}));
 const preWrapper=Buffer.from('#!/bin/sh\n# previous fixture\n');
 const postManifest=Buffer.from(JSON.stringify({digest:next,previous:old,entrypoint:'fixture-only'}));
 const postWrapper=Buffer.from('#!/bin/sh\n# new fixture\n');
 const committed=state==='COMMITTED';
 return {record:{
  schema:J.SCHEMA,action:CONTRACT.action,operation:CONTRACT.operation,
  state,journal_id:jid,lease_id:lease,
  old_digest:old,next_digest:next,
  policy_sha256:PINNED_POLICY_SHA,arguments_sha256:ARGUMENTS_SHA,
  request_id:committed?rid:null,approval_id:committed?aid:null,
  preimage_manifest_b64:preManifest.toString('base64'),
  preimage_manifest_sha256:h(preManifest),preimage_manifest_mode:0o600,
  preimage_wrapper_b64:preWrapper.toString('base64'),
  preimage_wrapper_sha256:h(preWrapper),preimage_wrapper_mode:0o700,
  post_manifest_sha256:committed?h(postManifest):null,
  post_wrapper_sha256:committed?h(postWrapper):null,
  post_manifest_mode:committed?0o600:null,
  post_wrapper_mode:committed?0o700:null,
  record_sha256:null
 },preManifest,preWrapper,postManifest,postWrapper};
}
test('inspector has no Root Action registration, token or mutation API',()=>{
 assert.equal(J.ROOT_ACTION_REGISTERED,false);
 assert.equal(J.PRODUCTION_APPLY_PRESENT,false);
 assert.equal(typeof J.inspectFixedNativeJournalState,'function');
 assert.equal(J.install,undefined);
 assert.equal(J.register,undefined);
 assert.equal(J.consumeApproval,undefined);
 assert.equal(J.FENCE,undefined);
});
test('canonical PREPARED fixture record validates exact operation and hashes',()=>{
 const {record}=make();
 const b=J.serializeForFixture(record);
 const proof=J.parseJournalFixtureBytes(b,jid,record.old_digest,record.next_digest);
 assert.equal(proof.record.state,'PREPARED');
 assert.equal(proof.record.record_sha256.length,64);
 assert.deepEqual(proof.preManifest,Buffer.from(record.preimage_manifest_b64,'base64'));
});
test('canonical COMMITTED fixture requires complete postimage and approval pair',()=>{
 const {record}=make(undefined,undefined,'COMMITTED');
 const b=J.serializeForFixture(record);
 assert.equal(J.parseJournalFixtureBytes(b,jid,record.old_digest,record.next_digest)
  .record.state,'COMMITTED');
 for(const change of [
   {post_manifest_sha256:null},{post_wrapper_sha256:null},
   {post_manifest_mode:null},{post_wrapper_mode:0o777},
   {approval_id:null},{request_id:null}
 ]){
   assert.throws(()=>J.parseJournalFixtureBytes(
     J.serializeForFixture({...record,...change}),jid,record.old_digest,record.next_digest),
     /committed_proof_incomplete|committed_modes_untrusted/);
 }
});
test('unexpected policy, digest, identity or runtime-controlled fields fail closed',()=>{
 const {record}=make();
 for(const change of [
  {action:'arbitrary'},{operation:'host_action.other'},
  {policy_sha256:'a'.repeat(64)},{arguments_sha256:'b'.repeat(64)},
  {old_digest:'c'.repeat(64)},{next_digest:'d'.repeat(64)},
  {journal_id:'99999999-2222-4333-8444-555555555555'},
  {extra_untrusted_field:true},{schema:'forged'}
 ]){
  assert.throws(()=>J.parseJournalFixtureBytes(
    J.serializeForFixture({...record,...change}),jid,record.old_digest,record.next_digest),
    /journal_scope_drift|record_fields/);
 }
});
test('corruption, reordered JSON and noncanonical preimage are rejected',()=>{
 const {record}=make();
 const b=J.serializeForFixture(record);
 assert.throws(()=>J.parseJournalFixtureBytes(Buffer.concat([b,Buffer.from(' ')]),
   jid,record.old_digest,record.next_digest),/journal_sha_or_noncanonical/);
 const changed=Buffer.from(b);
 changed[changed.length-5]^=1;
 assert.throws(()=>J.parseJournalFixtureBytes(changed,jid,
   record.old_digest,record.next_digest),/journal_sha_or_noncanonical|record_json/);
 assert.throws(()=>J.parseJournalFixtureBytes(
   J.serializeForFixture({...record,preimage_wrapper_b64:'AA===='}),
   jid,record.old_digest,record.next_digest),/base64_shape/);
 assert.throws(()=>J.parseJournalFixtureBytes(
   J.serializeForFixture({...record,preimage_manifest_sha256:'0'.repeat(64)}),
   jid,record.old_digest,record.next_digest),/preimage_hash_drift/);
});
test('root reader denies nonroot before touching fixed production policy',()=>{
 if(typeof process.getuid==='function'&&process.getuid()!==0){
  assert.throws(()=>J.inspectFixedNativeJournalState(jid),/root_required/);
 }
});
function fixture(cb){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),
  'prhm-honartik217-journal-inspect-fixture-'));
 fs.chmodSync(dir,0o700);
 try{
  const versions=path.join(dir,'versions');fs.mkdirSync(versions,{mode:0o700});
  function build(label){
   const initial=path.join(dir,'.build-'+label);
   fs.mkdirSync(path.join(initial,'universal'),{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(initial,'universal','cli.py'),
     'print('+JSON.stringify(label)+')\n',{mode:0o600});
   const digest=readTree(initial).digest;
   fs.renameSync(initial,path.join(versions,digest));
   return digest;
  }
  const old=build('previous'),next=build('candidate');
  const f=make(old,next);
  fs.symlinkSync(path.join(versions,old),path.join(dir,'current'));
  fs.writeFileSync(path.join(dir,'installation.json'),f.preManifest,{mode:0o600});
  fs.writeFileSync(path.join(dir,'deploy-project'),f.preWrapper,{mode:0o700});
  fs.writeFileSync(path.join(dir,J.LOCK),JSON.stringify({
    schema:J.LEASE_SCHEMA,lease_id:lease})+'\n',
    {mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(dir,J.JOURNAL),
    J.serializeForFixture(f.record),{mode:0o600});
  return cb({dir,old,next,...f});
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('Linux fixture: PREPARED pointer may be old or partially switched', {skip:skipLinux},()=>{
 fixture(({dir,old,next})=>{
  assert.equal(J.inspectIsolatedJournalFixture(dir,jid,old,next),'PREPARED');
  fs.unlinkSync(path.join(dir,'current'));
  fs.symlinkSync(path.join(dir,'versions',next),path.join(dir,'current'));
  assert.equal(J.inspectIsolatedJournalFixture(dir,jid,old,next),'PREPARED');
 });
});
test('Linux fixture: fsynced COMMITTED verifies actual manifest and wrapper bytes',
 {skip:skipLinux},()=>{
 fixture(({dir,old,next,record,postManifest,postWrapper})=>{
  fs.unlinkSync(path.join(dir,'current'));
  fs.symlinkSync(path.join(dir,'versions',next),path.join(dir,'current'));
  fs.writeFileSync(path.join(dir,'installation.json'),postManifest);
  fs.writeFileSync(path.join(dir,'deploy-project'),postWrapper);
  fs.writeFileSync(path.join(dir,J.JOURNAL),
    J.serializeForFixture({...record,state:'COMMITTED',request_id:rid,
     approval_id:aid,post_manifest_sha256:h(postManifest),
     post_wrapper_sha256:h(postWrapper),post_manifest_mode:0o600,
     post_wrapper_mode:0o700}));
  assert.equal(J.inspectIsolatedJournalFixture(dir,jid,old,next),'COMMITTED');
  fs.writeFileSync(path.join(dir,'deploy-project'),'tampered postimage');
  assert.throws(()=>J.inspectIsolatedJournalFixture(dir,jid,old,next),
    /committed_postimage_drift/);
 });
});
test('Linux fixture: ROLLED_BACK requires exact preimage, not just old pointer',
 {skip:skipLinux},()=>{
 fixture(({dir,old,next,record})=>{
  fs.writeFileSync(path.join(dir,J.JOURNAL),
    J.serializeForFixture({...record,state:'ROLLED_BACK'}));
  assert.equal(J.inspectIsolatedJournalFixture(dir,jid,old,next),'ROLLED_BACK');
  fs.writeFileSync(path.join(dir,'deploy-project'),'changed old wrapper');
  assert.throws(()=>J.inspectIsolatedJournalFixture(dir,jid,old,next),
    /rolled_back_preimage_drift/);
 });
});
test('Linux fixture: missing or symlinked lock never unlocks', {skip:skipLinux},()=>{
 fixture(({dir,old,next})=>{
  fs.unlinkSync(path.join(dir,J.LOCK));
  assert.throws(()=>J.inspectIsolatedJournalFixture(dir,jid,old,next),
    /ENOENT/);
  fs.symlinkSync(path.join(dir,J.JOURNAL),path.join(dir,J.LOCK));
  assert.throws(()=>J.inspectIsolatedJournalFixture(dir,jid,old,next),
    /untrusted_lock/);
 });
});
test('Linux fixture: symlink journal, changed bundle, pointer escape fail closed',
 {skip:skipLinux},()=>{
 fixture(({dir,old,next})=>{
  const journal=path.join(dir,J.JOURNAL);
  const backup=fs.readFileSync(journal);
  fs.unlinkSync(journal);fs.symlinkSync(path.join(dir,'installation.json'),journal);
  assert.throws(()=>J.inspectIsolatedJournalFixture(dir,jid,old,next),
    /untrusted_file/);
  fs.unlinkSync(journal);fs.writeFileSync(journal,backup,{mode:0o600});
  fs.writeFileSync(path.join(dir,'versions',old,'universal','cli.py'),
    'tampered bundle\n');
  assert.throws(()=>J.inspectIsolatedJournalFixture(dir,jid,old,next),
    /old_bundle_tampered/);
 });
});
test('Linux fixture: no parent trust broadening or arbitrary source directories',
 {skip:skipLinux},()=>{
 assert.throws(()=>J.inspectIsolatedJournalFixture('/etc',jid,
   CONTRACT.existing_digest,CONTRACT.candidate_digest),
   /fixture_path_denied/);
 fixture(({dir,old,next})=>{
  fs.chmodSync(dir,0o777);
  assert.throws(()=>J.inspectIsolatedJournalFixture(dir,jid,old,next),
    /fixture_owner/);
 });
});

test('Linux fixture: changed lease identity cannot authorize journal readback',
 {skip:skipLinux},()=>{
 fixture(({dir,old,next})=>{
  const file=path.join(dir,J.LOCK);
  fs.writeFileSync(file,JSON.stringify({
   schema:J.LEASE_SCHEMA,
   lease_id:'99999999-8888-4777-8666-555555555555'
  })+'\n');
  assert.throws(()=>J.inspectIsolatedJournalFixture(dir,jid,old,next),
   /lease_record_mismatch/);
 });
});
