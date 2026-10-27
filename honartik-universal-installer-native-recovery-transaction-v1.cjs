'use strict';
/**
 * Issue #217: native durable transaction preimage journal / recovery fixture.
 * SOURCE ONLY. No privileged production entrypoint or Host Actions binding.
 * Only isolated non-root Linux fixtures under os.tmpdir() are exposed.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const fail=x=>{throw Error('honartik217_tx_'+x)};
const need=(ok,x)=>{if(!ok)fail(x)};
const SHA=/^[a-f0-9]{64}$/;
const FILES=Object.freeze({pointer:'current',manifest:'installation.json',
  wrapper:'deploy-project',lock:'install-transaction.lock',
  journal:'install-transaction.journal'});
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function syncDir(dir){
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function atomicFile(file,bytes,mode=0o600){
 const tmp=path.join(path.dirname(file),'.honartik217-'+crypto.randomUUID());
 const fd=fs.openSync(tmp,fs.constants.O_CREAT|fs.constants.O_EXCL|
   fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,mode);
 try{
  need(fs.writeSync(fd,bytes,0,bytes.length)===bytes.length,'short_write');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 fs.renameSync(tmp,file);syncDir(path.dirname(file));
}
function assertFixture(root) {
 need(typeof process.getuid==='function'&&process.getuid()!==0,'nonroot_only');
 need(typeof root==='string'&&path.dirname(root)===os.tmpdir()&&
   path.basename(root).startsWith('prhm-honartik217-recovery-fixture-'),
   'fixture_path_denied');
 const s=fs.lstatSync(root);
 need(s.isDirectory()&&!s.isSymbolicLink()&&
  s.uid===process.getuid()&&(s.mode&0o777)===0o700,'fixture_ownership');
 return root;
}
function snapshot(root) {
 assertFixture(root);
 const current=path.join(root,FILES.pointer);
 const stat=fs.lstatSync(current);
 need(stat.isSymbolicLink(),'pointer_absent');
 const target=fs.realpathSync(current);
 need(path.dirname(target)===path.join(root,'versions')&&
  SHA.test(path.basename(target)),'pointer_escape');
 const digest=readTree(target).digest;
 need(digest===path.basename(target),'active_bundle_tampered');
 const manifest=fs.readFileSync(path.join(root,FILES.manifest));
 const wrapper=fs.readFileSync(path.join(root,FILES.wrapper));
 const json=JSON.parse(manifest.toString('utf8'));
 need(json.digest===digest&&wrapper.length>0,'preimage_mismatch');
 return {digest,target,manifest,wrapper,
  manifestMode:fs.statSync(path.join(root,FILES.manifest)).mode&0o777,
  wrapperMode:fs.statSync(path.join(root,FILES.wrapper)).mode&0o777};
}
function journalFile(root){return path.join(root,FILES.journal)}
function getJournal(root){
 const p=journalFile(root),s=fs.lstatSync(p);
 need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&
   (s.mode&0o777)===0o600,'journal_not_private');
 const v=JSON.parse(fs.readFileSync(p,'utf8'));
 need(v.schema==='prhm.honartik217.fixture-recovery.v1'&&
   ['PREPARED','COMMITTED','ROLLED_BACK'].includes(v.state)&&SHA.test(v.old)&&SHA.test(v.next)&&v.old!==v.next&&
   typeof v.manifest_base64==='string'&&typeof v.wrapper_base64==='string'&&
   SHA.test(v.manifest_sha256)&&SHA.test(v.wrapper_sha256)&&
   Number.isInteger(v.manifest_mode)&&v.manifest_mode>=0o400&&
   v.manifest_mode<=0o777&&Number.isInteger(v.wrapper_mode)&&
   v.wrapper_mode>=0o400&&v.wrapper_mode<=0o777,
   'journal_untrusted');
 const manifest=Buffer.from(v.manifest_base64,'base64');
 const wrapper=Buffer.from(v.wrapper_base64,'base64');
 need(sha(manifest)===v.manifest_sha256&&sha(wrapper)===v.wrapper_sha256,
   'journal_integrity');
 return {journal:v,manifest,wrapper};
}
function beginFixture(root,newDigest){
 assertFixture(root);need(SHA.test(newDigest),'candidate_invalid');
 const pre=snapshot(root);
 need(pre.digest!==newDigest,'same_bundle');
 const target=path.join(root,'versions',newDigest);
 need(readTree(target).digest===newDigest,'candidate_content_drift');
 // Never automatically delete a previous journal or lock.
 need(!fs.existsSync(journalFile(root)),'old_journal_requires_reconciliation');
 const lock=path.join(root,FILES.lock);
 const fd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_EXCL|
  fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 try{
  const content=Buffer.from(JSON.stringify({
   schema:'prhm.honartik217.fixture-recovery.v1',state:'PREPARED',
   old:pre.digest,next:newDigest,
   manifest_base64:pre.manifest.toString('base64'),
   wrapper_base64:pre.wrapper.toString('base64'),
   manifest_sha256:sha(pre.manifest),wrapper_sha256:sha(pre.wrapper),
   manifest_mode:pre.manifestMode,wrapper_mode:pre.wrapperMode
  })+'\n');
  atomicFile(journalFile(root),content);
  fs.fsyncSync(fd);syncDir(root);
 }finally{fs.closeSync(fd)}
 return {prepared:true,old:pre.digest,next:newDigest};
}
function changePointer(root,target){
 const tmp=path.join(root,'.pointer-'+crypto.randomUUID());
 fs.symlinkSync(path.join(root,'versions',target),tmp);
 fs.renameSync(tmp,path.join(root,FILES.pointer));syncDir(root);
}
function applyFixture(root,stage=null) {
 assertFixture(root);
 const {journal:j}=getJournal(root);
 need(fs.lstatSync(path.join(root,FILES.lock)).isFile(),'exclusive_lock_lost');
 const before=fs.realpathSync(path.join(root,FILES.pointer));
 need(path.basename(before)===j.old,'preimage_pointer_drift');
 changePointer(root,j.next);
 if(stage==='crash_after_pointer')process.exit(87);
 if(stage==='after_pointer')throw Error('INJECTED_AFTER_POINTER');
 atomicFile(path.join(root,FILES.manifest),Buffer.from(JSON.stringify({
  digest:j.next,previous:j.old,entrypoint:'fixture-only'
 })));
 if(stage==='crash_after_manifest')process.exit(88);
 if(stage==='after_manifest')throw Error('INJECTED_AFTER_MANIFEST');
 atomicFile(path.join(root,FILES.wrapper),Buffer.from('#!/bin/sh\n# fixture-new-wrapper\n'),0o700);
 if(stage==='crash_after_wrapper')process.exit(89);
 if(stage==='after_wrapper')throw Error('INJECTED_AFTER_WRAPPER');
 need(snapshot(root).digest===j.next,'postimage_failed');
 return {switched:true,requires_commit:true};
}
function finishFixture(root,crashStage=null){
 assertFixture(root);const {journal:j}=getJournal(root);
 need(fs.lstatSync(path.join(root,FILES.lock)).isFile(),'exclusive_lock_lost');
 need(snapshot(root).digest===j.next,'postimage_not_verified');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,FILES.manifest),'utf8'));
 need(manifest.digest===j.next&&manifest.previous===j.old&&
   manifest.entrypoint==='fixture-only','postimage_manifest_mismatch');
 const wrapper=fs.readFileSync(path.join(root,FILES.wrapper),'utf8');
 need(wrapper==='#!/bin/sh\n# fixture-new-wrapper\n','postimage_wrapper_mismatch');
 const previous=fs.readFileSync(journalFile(root));
 const next=Buffer.from(JSON.stringify({...j,state:'COMMITTED'})+'\n');
 need(previous.length>0,'journal_missing');
 atomicFile(journalFile(root),next);
 // A durable COMMITTED marker is the point of no return. Simulate abrupt
 // termination after fsync to ensure recovery never rolls back this install.
 if(crashStage==='crash_after_commit_marker')process.exit(90);
 fs.unlinkSync(path.join(root,FILES.lock));
 syncDir(root);
 return {committed:true,installed_digest:j.next};
}
function recoverFixture(root){
 assertFixture(root);
 const {journal:j,manifest,wrapper}=getJournal(root);
 if(j.state==='COMMITTED'){
  // A durably committed transaction must NEVER be rolled back just because
  // the process died before acknowledging success or releasing its lock.
  const post=snapshot(root);
  need(post.digest===j.next,'committed_candidate_drift');
  const m=JSON.parse(post.manifest.toString('utf8'));
  need(m.previous===j.old&&m.entrypoint==='fixture-only',
    'committed_manifest_drift');
  need(post.wrapper.equals(Buffer.from('#!/bin/sh\n# fixture-new-wrapper\n')),
    'committed_wrapper_drift');
  const lock=path.join(root,FILES.lock);
  if(fs.existsSync(lock)){
   const st=fs.lstatSync(lock);
   need(st.isFile()&&!st.isSymbolicLink()&&
     st.uid===process.getuid()&&(st.mode&0o777)===0o600,
     'committed_recovery_lock_unsafe');
   fs.unlinkSync(lock);syncDir(root);
  }
  // Leave the journal as permanent evidence and replay prevention.
  return {committed:true,rolled_back:false,digest:j.next};
 }
 if(j.state==='ROLLED_BACK'){
  const pre=snapshot(root);
  need(pre.digest===j.old&&pre.manifest.equals(manifest)&&
    pre.wrapper.equals(wrapper)&&pre.manifestMode===j.manifest_mode&&
    pre.wrapperMode===j.wrapper_mode,'rolled_back_preimage_drift');
  return {rolled_back:true,already_recovered:true,digest:j.old};
 }
 need(fs.lstatSync(path.join(root,FILES.lock)).isFile(),'exclusive_lock_lost');
 const current=path.basename(fs.realpathSync(path.join(root,FILES.pointer)));
 need(current===j.old||current===j.next,'third_party_pointer');
 const old=path.join(root,'versions',j.old);
 need(readTree(old).digest===j.old,'old_bundle_modified');
 const expected=JSON.parse(manifest.toString('utf8'));
 need(expected.digest===j.old,'journal_manifest_wrong_old');
 changePointer(root,j.old);
 atomicFile(path.join(root,FILES.manifest),manifest,j.manifest_mode);
 atomicFile(path.join(root,FILES.wrapper),wrapper,j.wrapper_mode);
 const back=snapshot(root);
 need(back.digest===j.old&&back.manifest.equals(manifest)&&
   back.wrapper.equals(wrapper)&&back.manifestMode===j.manifest_mode&&
   back.wrapperMode===j.wrapper_mode,'rollback_unverified');
 const closed=Buffer.from(JSON.stringify({...j,state:'ROLLED_BACK'})+'\n');
 atomicFile(journalFile(root),closed);fs.unlinkSync(path.join(root,FILES.lock));
 syncDir(root);
 return {rolled_back:true,exact_bytes_restored:true,digest:j.old};
}
module.exports=Object.freeze({beginFixture,applyFixture,finishFixture,
 recoverFixture,snapshot,PRODUCTION_EXECUTION_AUTHORIZED:false});
