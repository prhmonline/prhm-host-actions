'use strict';
/**
 * Issue #217 — SOURCE ONLY non-root commit/rollback crash fixtures.
 * This module deliberately has NO root entrypoint, privileged executor,
 * Approval Center coupling, token verifier, registration, or Production apply.
 * A reviewed native root owner must implement separate equivalent transactions
 * before any real Level-4 upgrade is permitted.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const I=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const fail=x=>{throw Error('honartik217_fixture_finalize_'+x)};
const need=(b,x)=>{if(!b)fail(x)};
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const NEW_WRAPPER=Buffer.from('#!/bin/sh\n# fixture-new-wrapper\n');
function fixture(root){
 need(typeof process.getuid==='function'&&process.getuid()!==0,'nonroot_required');
 need(typeof root==='string'&&path.dirname(root)===os.tmpdir()&&
  path.basename(root).startsWith('prhm-honartik217-journal-inspect-fixture-'),
  'fixture_path_denied');
 const st=fs.lstatSync(root);
 need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&
   (st.mode&0o777)===0o700,'fixture_ownership');
 return root;
}
function fsyncDir(dir){
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
   fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function atomicReplace(root,name,bytes,mode=0o600){
 const dest=path.join(root,name);
 const prior=fs.lstatSync(dest);
 need(prior.isFile()&&!prior.isSymbolicLink()&&
   prior.uid===process.getuid()&&prior.nlink===1,'mutation_target_untrusted');
 const temp=path.join(root,'.txn-stage-'+crypto.randomUUID());
 const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|
   fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
 try{
  need(fs.writeSync(fd,bytes,0,bytes.length)===bytes.length,'short_write');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 fs.renameSync(temp,dest);fsyncDir(root);
}
function atomicPointer(root,targetDigest){
 need(SHA.test(targetDigest),'target_invalid');
 const target=path.join(root,'versions',targetDigest);
 const dest=path.join(root,'current');
 const current=fs.lstatSync(dest);
 need(current.isSymbolicLink()&&current.uid===process.getuid(),
  'current_pointer_untrusted');
 const temporary=path.join(root,'.pointer-stage-'+crypto.randomUUID());
 fs.symlinkSync(target,temporary);
 fs.renameSync(temporary,dest);
 fsyncDir(root);
}
function readRecord(root,expectId,old,next){
 const journal=path.join(root,I.JOURNAL);
 const st=fs.lstatSync(journal);
 need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&
   (st.mode&0o777)===0o600&&st.nlink===1&&st.size<=512000,
   'journal_file_untrusted');
 const fd=fs.openSync(journal,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let bytes;
 try{
  const x=fs.fstatSync(fd);
  need(x.ino===st.ino&&x.dev===st.dev&&x.size===st.size,
    'journal_file_race');
  bytes=fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
 return I.parseJournalFixtureBytes(bytes,expectId,old,next);
}
function validate(root,id,old,next){
 fixture(root);
 need(UUID.test(id)&&SHA.test(old)&&SHA.test(next)&&old!==next,
  'transaction_identity_invalid');
 const state=I.inspectIsolatedJournalFixture(root,id,old,next);
 return {state,...readRecord(root,id,old,next)};
}
function simulateCutover(root,id,old,next,crash=null){
 const {state}=validate(root,id,old,next);
 need(state==='PREPARED','must_be_prepared');
 atomicPointer(root,next);
 if(crash==='after_pointer')process.exit(102);
 const manifest=Buffer.from(JSON.stringify({digest:next,previous:old,
  entrypoint:'fixture-only'}));
 atomicReplace(root,'installation.json',manifest,0o600);
 if(crash==='after_manifest')process.exit(103);
 atomicReplace(root,'deploy-project',NEW_WRAPPER,0o700);
 if(crash==='after_wrapper')process.exit(104);
 return {pending:true,approval_verified:false,production_changed:false};
}
function verifiedPostimage(root,old,next){
 const pointer=fs.realpathSync(path.join(root,'current'));
 need(pointer===path.join(root,'versions',next),'new_pointer_missing');
 need(readTree(pointer).digest===next,'candidate_bundle_drift');
 const mf=path.join(root,'installation.json');
 const wf=path.join(root,'deploy-project');
 for(const [file,mode] of [[mf,0o600],[wf,0o700]]){
  const st=fs.lstatSync(file);
  need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&
    st.nlink===1&&(st.mode&0o777)===mode,'postimage_file_unsafe');
 }
 const m=fs.readFileSync(mf),w=fs.readFileSync(wf);
 let json;
 try{json=JSON.parse(m.toString('utf8'))}catch{fail('post_manifest_json')}
 need(json.digest===next&&json.previous===old&&
   json.entrypoint==='fixture-only'&&w.equals(NEW_WRAPPER),
   'postimage_mismatch');
 return {manifest:m,wrapper:w};
}
function commitFixture(root,id,old,next,crash=null){
 const {state,record}=validate(root,id,old,next);
 need(state==='PREPARED','commit_requires_prepared');
 const post=verifiedPostimage(root,old,next);
 // Synthetic nonroot IDs only; this is NEVER a Level-4 authorization claim.
 const j=I.serializeForFixture({...record,state:'COMMITTED',
  request_id:'11111111-2222-4333-8444-555555555555',
  approval_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  post_manifest_sha256:digest(post.manifest),
  post_wrapper_sha256:digest(post.wrapper),
  post_manifest_mode:0o600,post_wrapper_mode:0o700});
 atomicReplace(root,I.JOURNAL,j,0o600);
 if(crash==='after_durable_commit')process.exit(105);
 need(I.inspectIsolatedJournalFixture(root,id,old,next)==='COMMITTED',
  'commit_readback_unverified');
 // Leave lock + journal intact: only a future trusted reconciler may retire.
 return {committed:true,rolled_back:false,lock_preserved:true,
  approval_verified:false,production_changed:false};
}
function recoverFixture(root,id,old,next,crash=null){
 const {state,record,preManifest,preWrapper}=validate(root,id,old,next);
 if(state==='COMMITTED')return {committed:true,rolled_back:false,
   state:'COMMITTED',lock_preserved:true};
 if(state==='ROLLED_BACK')return {committed:false,rolled_back:true,
   already_recovered:true,lock_preserved:true};
 need(state==='PREPARED','recovery_state_invalid');
 // Old copy is verified by inspector before modifying anything.
 atomicPointer(root,old);
 if(crash==='after_restore_pointer')process.exit(106);
 atomicReplace(root,'installation.json',preManifest,
  record.preimage_manifest_mode);
 if(crash==='after_restore_manifest')process.exit(107);
 atomicReplace(root,'deploy-project',preWrapper,
  record.preimage_wrapper_mode);
 if(crash==='after_restore_wrapper')process.exit(108);
 // Verify restored exact bytes/modes BEFORE writing durable ROLLED_BACK.
 for(const [name,content,mode] of [
  ['installation.json',preManifest,record.preimage_manifest_mode],
  ['deploy-project',preWrapper,record.preimage_wrapper_mode]]){
  const p=path.join(root,name),st=fs.lstatSync(p);
  need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&
    (st.mode&0o777)===mode&&fs.readFileSync(p).equals(content),
    'restore_postimage_invalid');
 }
 const closed=I.serializeForFixture({...record,state:'ROLLED_BACK'});
 atomicReplace(root,I.JOURNAL,closed,0o600);
 if(crash==='after_durable_rollback')process.exit(109);
 need(I.inspectIsolatedJournalFixture(root,id,old,next)==='ROLLED_BACK',
  'rollback_readback_unverified');
 return {rolled_back:true,exact_preimage:true,lock_preserved:true,
  production_changed:false};
}
module.exports=Object.freeze({
 simulateCutover,commitFixture,recoverFixture,
 ROOT_EXECUTOR_EXPORTED:false,PRODUCTION_EXECUTION_AUTHORIZED:false,
 LIVE_LEVEL4_APPROVAL_CONSUMED:false
});
