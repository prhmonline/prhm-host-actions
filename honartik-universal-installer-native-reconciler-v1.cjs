'use strict';
/**
 * Issue #217 native terminal reconciliation, SOURCE ONLY.
 * No CLI, no root action registration, no installer or token issuer.
 * This is a fixed owner capability for the existing coordinator AFTER
 * signed Level-4 authorization and native Root-of-Trust registration.
 * The fixture uses identical state transition code, restricted to /tmp.
 * A terminal journal/lock is NEVER erased here: retirement needs separate
 * reviewed durable archival and cannot be substituted by 'unlock'.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto');
const I=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const {CONTRACT:C}=require('./honartik-universal-installer-l4-v1.cjs');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const FENCE='/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4';
const ATTEMPT='python-attempt-started.json';
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=x=>{throw Error('honartik217_reconcile_'+x)};
const need=(ok,x)=>{if(!ok)fail(x)};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fsyncDir(dir){
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function ownerDir(dir,uid,mode=null){
 const s=fs.lstatSync(dir);
 need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===uid&&
  (s.mode&0o022)===0&&(mode===null||(s.mode&0o777)===mode),
  'directory_untrusted');
}
function rootAncestors(file){
 let d=path.dirname(file);
 while(true){
  const s=fs.lstatSync(d);
  need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&
   (s.mode&0o022)===0,'root_parent_untrusted');
  if(d==='/')break;
  d=path.dirname(d);
 }
}
function checkedRead(file,uid,max=512000,mode=null){
 const st=fs.lstatSync(file);
 need(st.isFile()&&!st.isSymbolicLink()&&st.uid===uid&&
  st.nlink===1&&(st.mode&0o022)===0&&
  (mode===null||(st.mode&0o777)===mode)&&st.size>0&&st.size<=max,
  'file_untrusted');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const x=fs.fstatSync(fd);
  need(x.dev===st.dev&&x.ino===st.ino&&x.uid===uid&&
   x.mode===st.mode&&x.size===st.size,'file_race');
  return fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
}
function strictJournal(ctx,id){
 const bytes=checkedRead(path.join(ctx.fence,I.JOURNAL),ctx.uid,512000,0o600);
 let raw;
 try{raw=JSON.parse(bytes.toString('utf8'))}catch{fail('journal_invalid_json')}
 need(raw.journal_id===id&&raw.old_digest===ctx.old&&raw.next_digest===ctx.next,
  'journal_wrong_identity');
 const parsed=I.parseJournalFixtureBytes(bytes,id,ctx.old,ctx.next);
 // parseJournalFixtureBytes validates fixture entrypoint. For the fixed real
 // root journal, independent root inspector verifies the real entrypoint,
 // so avoid using the fixture parser as an authority for that path.
 return {raw,parsed,bytes};
}
function guardedJournal(ctx,id){
 need(UUID.test(id||'')&&SHA.test(ctx.old)&&SHA.test(ctx.next)&&
  ctx.old!==ctx.next,'identity_invalid');
 if(ctx.uid===0){
  rootAncestors(path.join(ctx.fence,I.JOURNAL));
  rootAncestors(path.join(ctx.prefix,'current'));
 }else{
  need(path.dirname(ctx.fence)===os.tmpdir()&&
    path.basename(ctx.fence).startsWith('prhm-honartik217-journal-inspect-fixture-')&&
    ctx.fence===ctx.prefix,'fixture_scope_denied');
 }
 ownerDir(ctx.fence,ctx.uid,0o700);
 const state=ctx.uid===0?I.inspectFixedNativeJournalState(id):
  I.inspectIsolatedJournalFixture(ctx.fence,id,ctx.old,ctx.next);
 // Do not trust an in-memory bool or missing journal as recoverable.
 const bytes=checkedRead(path.join(ctx.fence,I.JOURNAL),ctx.uid,512000,0o600);
 let raw;
 try{raw=JSON.parse(bytes.toString('utf8'))}catch{fail('journal_json')}
 need(raw.journal_id===id&&raw.state===state&&
  raw.old_digest===ctx.old&&raw.next_digest===ctx.next,
  'journal_changed_after_inspection');
 if(ctx.uid!==0)I.parseJournalFixtureBytes(bytes,id,ctx.old,ctx.next);
 else need(bytes.equals(I.serializeForFixture(raw)),
  'root_journal_noncanonical');
 const preM=Buffer.from(raw.preimage_manifest_b64,'base64');
 const preW=Buffer.from(raw.preimage_wrapper_b64,'base64');
 return {state,raw,bytes,preM,preW};
}
function attemptBound(ctx,record){
 const file=path.join(ctx.fence,ATTEMPT);
 const bytes=checkedRead(file,ctx.uid,8192,0o600);
 let a;
 try{a=JSON.parse(bytes.toString('utf8'))}catch{fail('attempt_invalid_json')}
 need(a.schema==='prhm.honartik217.fixed-python-attempt.v1'&&
  a.action===C.action&&a.state==='started_once_recovery_only'&&
  a.journal_id===record.journal_id&&
  a.request_id===record.request_id&&a.approval_id===record.approval_id&&
  a.old_digest===ctx.old&&a.new_digest===ctx.next,
  'attempt_or_approval_unbound');
 return true;
}
function atomicReplace(file,bytes,mode,uid,crash=null){
 const old=fs.lstatSync(file);
 need(old.isFile()&&!old.isSymbolicLink()&&old.uid===uid&&
  old.nlink===1&&(old.mode&0o022)===0,'replace_target_unsafe');
 const dir=path.dirname(file),tmp=path.join(dir,'.honartik217-reconcile-'+crypto.randomUUID());
 const fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
 try{
  const n=fs.writeSync(fd,bytes,0,bytes.length);
  need(n===bytes.length,'short_write');fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 const now=fs.lstatSync(file);
 need(now.dev===old.dev&&now.ino===old.ino&&
  now.uid===uid,'concurrent_target_replacement');
 fs.renameSync(tmp,file);fsyncDir(dir);
 if(crash==='after_replace')process.exit(121);
}
function terminalRecord(ctx,id,kind,record,preM,preW,crash=null){
 need(kind==='COMMITTED'||kind==='ROLLED_BACK','terminal_state_invalid');
 // Rollback never authorizes a new Python execution.
 const j={...record,state:kind};
 if(kind==='COMMITTED'){
  need(UUID.test(record.request_id||'')&&UUID.test(record.approval_id||''),
   'commit_without_approval');
  attemptBound(ctx,record);
  const ptr=fs.realpathSync(path.join(ctx.prefix,'current'));
  need(ptr===path.join(ctx.prefix,'versions',ctx.next),'commit_pointer_drift');
  need(readTree(ptr).digest===ctx.next,'commit_bundle_drift');
  const m=checkedRead(path.join(ctx.prefix,'installation.json'),ctx.uid,131072);
  const w=checkedRead(path.join(ctx.prefix,'deploy-project'),ctx.uid,131072);
  need(w.subarray(0,10).toString('utf8')==='#!/bin/sh\n',
   'commit_wrapper_layout_invalid');
  let p;try{p=JSON.parse(m.toString('utf8'))}catch{fail('commit_manifest_json')}
  need(p.digest===ctx.next&&p.previous===ctx.old&&
   p.entrypoint===ctx.entrypoint,'commit_manifest_drift');
  const ms=fs.lstatSync(path.join(ctx.prefix,'installation.json'));
  const ws=fs.lstatSync(path.join(ctx.prefix,'deploy-project'));
  const mm=ms.mode&0o777,wm=ws.mode&0o777;
  need([0o600,0o644].includes(mm)&&[0o700,0o744,0o755].includes(wm),
   'commit_file_modes_invalid');
  j.post_manifest_sha256=sha(m);j.post_wrapper_sha256=sha(w);
  j.post_manifest_mode=mm;j.post_wrapper_mode=wm;
 }else{
  const target=fs.realpathSync(path.join(ctx.prefix,'current'));
  need(target===path.join(ctx.prefix,'versions',ctx.old),'rollback_pointer_drift');
  need(readTree(target).digest===ctx.old,'rollback_bundle_drift');
  for(const [filename,data,mode] of [
   ['installation.json',preM,record.preimage_manifest_mode],
   ['deploy-project',preW,record.preimage_wrapper_mode]]){
   const file=path.join(ctx.prefix,filename);
   const bytes=checkedRead(file,ctx.uid,131072,mode);
   need(bytes.equals(data),'rollback_preimage_unverified');
  }
  j.post_manifest_sha256=null;j.post_wrapper_sha256=null;
  j.post_manifest_mode=null;j.post_wrapper_mode=null;
 }
 const serialized=I.serializeForFixture(j);
 atomicReplace(path.join(ctx.fence,I.JOURNAL),serialized,0o600,ctx.uid);
 if(crash==='after_terminal_marker')process.exit(kind==='COMMITTED'?122:123);
 need((ctx.uid===0?I.inspectFixedNativeJournalState(id):
  I.inspectIsolatedJournalFixture(ctx.fence,id,ctx.old,ctx.next))===kind,
  'terminal_readback_failed');
 return Object.freeze({ok:true,state:kind,lease_retained:true,
  terminal_evidence_retained:true,approval_reusable:false});
}
function reconcile(ctx,id,operation,crash=null){
 const {state,raw,preM,preW}=guardedJournal(ctx,id);
 if(state==='COMMITTED'||state==='ROLLED_BACK'){
  need(operation==='inspect','terminal_never_mutated');
  return Object.freeze({ok:true,state,lease_retained:true,idempotent:true});
 }
 need(state==='PREPARED','unexpected_state');
 if(operation==='inspect')return Object.freeze({ok:true,state,
  lease_retained:true,idempotent:true});
 if(operation==='commit')
  return terminalRecord(ctx,id,'COMMITTED',raw,preM,preW,crash);
 need(operation==='rollback','operation_denied');
 // An unconsumed/unbound approval can have no Python attempt.
 if(raw.request_id!==null||raw.approval_id!==null){
  need(UUID.test(raw.request_id||'')&&UUID.test(raw.approval_id||''),
   'rollback_approval_pair_invalid');
  // Empty attempt marker after fsynced O_EXCL still indicates possible
  // partial execution, so recovery may proceed only from this journal.
 }
 const ptr=path.join(ctx.prefix,'current');
 const resolved=fs.realpathSync(ptr);
 need([ctx.old,ctx.next].some(x=>
  resolved===path.join(ctx.prefix,'versions',x)),
  'rollback_third_party_pointer');
 const original=path.join(ctx.prefix,'versions',ctx.old);
 need(readTree(original).digest===ctx.old,'rollback_old_bytes_modified');
 const st=fs.lstatSync(ptr);
 need(st.isSymbolicLink()&&st.uid===ctx.uid,'rollback_pointer_untrusted');
 const temp=path.join(ctx.prefix,'.honartik217-restore-'+crypto.randomUUID());
 fs.symlinkSync(original,temp);fs.renameSync(temp,ptr);fsyncDir(ctx.prefix);
 if(crash==='after_pointer')process.exit(124);
 atomicReplace(path.join(ctx.prefix,'installation.json'),preM,
  raw.preimage_manifest_mode,ctx.uid);
 if(crash==='after_manifest')process.exit(125);
 atomicReplace(path.join(ctx.prefix,'deploy-project'),preW,
  raw.preimage_wrapper_mode,ctx.uid);
 if(crash==='after_wrapper')process.exit(126);
 return terminalRecord(ctx,id,'ROLLED_BACK',raw,preM,preW,crash);
}
function fixedContext(){
 return Object.freeze({uid:0,fence:FENCE,prefix:C.installer_prefix,
  old:C.existing_digest,next:C.candidate_digest,
  entrypoint:C.installer_prefix+'/deploy-project'});
}
function reconcileFixedRootJournal(id,operation){
 need(process.getuid?.()===0,'root_required');
 need(['inspect','commit','rollback'].includes(operation),
  'operation_denied');
 return reconcile(fixedContext(),id,operation);
}
function reconcileIsolatedFixture(root,id,old,next,operation,crash=null){
 need(process.getuid?.()!==0,'fixture_nonroot_required');
 return reconcile({uid:process.getuid(),fence:root,prefix:root,old,next,
  entrypoint:'fixture-only'},id,operation,crash);
}
module.exports=Object.freeze({
 reconcileFixedRootJournal,reconcileIsolatedFixture,
 ROOT_ACTION_REGISTERED:false,PRODUCTION_EXECUTION_AUTHORIZED:false,
 TERMINAL_ARCHIVAL_IMPLEMENTED:false
});
