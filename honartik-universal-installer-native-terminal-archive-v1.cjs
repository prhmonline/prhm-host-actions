'use strict';
/**
 * Issue #217 — FIXED terminal evidence archive. SOURCE ONLY.
 * Archive is append-only for one terminal journal_id; this module NEVER
 * deletes or retires the live exclusive lease, installer journal, consumed
 * approval receipt or execution-attempt marker. It cannot issue approvals,
 * register a Host Action, install Python or change Production.
 * A separate trusted Root-of-Trust owner must review/install/bind it.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const I=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const {CONTRACT:C}=require('./honartik-universal-installer-l4-v1.cjs');
const FENCE='/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4';
const ARCHIVE_NAME='terminal-evidence';
const ATTEMPT='python-attempt-started.json';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=s=>{throw Error('honartik217_terminal_archive_'+s)};
const need=(v,s)=>{if(!v)fail(s)};
function syncDir(d){
 const fd=fs.openSync(d,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function privateDir(dir,uid){
 const s=fs.lstatSync(dir);
 need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===uid&&
  (s.mode&0o777)===0o700,'directory_untrusted');
}
function trustedAncestors(file){
 let d=path.dirname(file);
 while(true){
  const s=fs.lstatSync(d);
  need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&
   (s.mode&0o022)===0,'root_parent_untrusted');
  if(d==='/')break;d=path.dirname(d);
 }
}
function exactRead(file,uid,max=512000,mode=0o600,allowEmpty=false){
 const st=fs.lstatSync(file);
 need(st.isFile()&&!st.isSymbolicLink()&&st.uid===uid&&
  st.nlink===1&&(st.mode&0o777)===mode&&
  (allowEmpty?st.size>=0:st.size>0)&&st.size<=max,'source_untrusted');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const now=fs.fstatSync(fd);
  need(now.dev===st.dev&&now.ino===st.ino&&now.uid===uid&&
   now.mode===st.mode&&now.size===st.size,'source_read_race');
  const bytes=fs.readFileSync(fd);
  need(bytes.length===st.size,'source_short_read');
  return bytes;
 }finally{fs.closeSync(fd)}
}
function writeImmutable(file,bytes){
 need(Buffer.isBuffer(bytes),'invalid_archive_bytes');
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o400);
 try{
  need(fs.writeSync(fd,bytes,0,bytes.length)===bytes.length,'archive_short_write');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
}
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort()
   .map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function terminalBytes(ctx,id){
 need(UUID.test(id||''),'journal_id_invalid');
 const state=ctx.uid===0?
  I.inspectFixedNativeJournalState(id):
  I.inspectIsolatedJournalFixture(ctx.root,id,ctx.old,ctx.next);
 need(state==='COMMITTED'||state==='ROLLED_BACK','not_terminal');
 const journal=exactRead(path.join(ctx.root,I.JOURNAL),ctx.uid);
 const lock=exactRead(path.join(ctx.root,I.LOCK),ctx.uid,8192);
 let j,l;
 try{j=JSON.parse(journal.toString('utf8'));l=JSON.parse(lock.toString('utf8'))}
 catch{fail('record_json')}
 need(j.journal_id===id&&j.lease_id===l.lease_id&&
  j.state===state,'lease_journal_drift');
 const entries={journal,lock};
 const attemptPath=path.join(ctx.root,ATTEMPT);
 if(fs.existsSync(attemptPath)){
  // Even an empty marker is burned; do not erase it or silently upgrade
  // its evidentiary meaning. Empty files are not valid archive receipts.
  entries.attempt=exactRead(attemptPath,ctx.uid,8192,0o600,true);
  // A zero-byte O_EXCL marker is a durable burned execution attempt.
  // It is admissible only for a rolled-back interrupted install, NEVER
  // for a COMMITTED transition requiring verified Python execution.
  if(entries.attempt.length===0)need(state==='ROLLED_BACK',
    'empty_attempt_cannot_commit');
 }else need(state==='ROLLED_BACK'&&j.request_id===null&&
  j.approval_id===null,'terminal_attempt_missing');
 if(j.approval_id!==null){
  need(UUID.test(j.approval_id||''),'approval_id_invalid');
  entries.approval=exactRead(path.join(ctx.root,j.approval_id+'.json'),
   ctx.uid,8192);
  let a;try{a=JSON.parse(entries.approval.toString('utf8'))}
  catch{fail('approval_receipt_json')}
  need(a.approval_id===j.approval_id&&
   a.request_id===j.request_id&&a.state==='reserved_no_replay',
   'approval_receipt_mismatch');
 }
 // Readback again before any archival output. Source remains write-locked.
 need((ctx.uid===0?I.inspectFixedNativeJournalState(id):
  I.inspectIsolatedJournalFixture(ctx.root,id,ctx.old,ctx.next))===state,
  'terminal_source_changed');
 need(exactRead(path.join(ctx.root,I.JOURNAL),ctx.uid).equals(journal)&&
  exactRead(path.join(ctx.root,I.LOCK),ctx.uid,8192).equals(lock),
  'terminal_source_race');
 return {state,entries,j};
}
function validateFinal(destination,expected,uid){
 privateDir(destination,uid);
 const expectedNames=Object.keys(expected).sort();
 need(fs.readdirSync(destination).sort().join('|')===
  expectedNames.join('|'),'archived_files_drift');
 for(const [name,bytes] of Object.entries(expected)){
  const got=exactRead(path.join(destination,name),uid,512000,0o400,
   name==='attempt');
  need(got.equals(bytes),'archived_bytes_drift');
 }
 return Object.freeze({ok:true,archived:true,idempotent:true,
  lock_preserved:true,archive_path:destination});
}
function archive(ctx,id,crash=null){
 need(ctx&&typeof ctx.root==='string'&&typeof ctx.uid==='number',
  'invalid_context');
 privateDir(ctx.root,ctx.uid);
 if(ctx.uid===0)trustedAncestors(path.join(ctx.root,I.JOURNAL));
 else need(path.dirname(ctx.root)===os.tmpdir()&&
  path.basename(ctx.root).startsWith('prhm-honartik217-journal-inspect-fixture-'),
  'fixture_scope_denied');
 const {state,entries,j}=terminalBytes(ctx,id);
 const meta={
  schema:'prhm.honartik217.terminal-evidence.v1',
  action:C.action,journal_id:id,lease_id:j.lease_id,
  state,approval_id:j.approval_id,request_id:j.request_id,
  digests:Object.fromEntries(Object.keys(entries).sort()
   .map(name=>[name,sha(entries[name])])),
  lease_retained:true,original_journal_retained:true,
  approval_reusable:false
 };
 const all={...entries,'manifest.json':Buffer.from(canonical(meta)+'\n')};
 const archiveParent=path.join(ctx.root,ARCHIVE_NAME);
 try{fs.mkdirSync(archiveParent,{mode:0o700})}
 catch(e){if(e?.code!=='EEXIST')throw e}
 privateDir(archiveParent,ctx.uid);
 syncDir(ctx.root);
 const final=path.join(archiveParent,id);
 if(fs.existsSync(final))return validateFinal(final,all,ctx.uid);
 const stage=path.join(archiveParent,'.stage-'+crypto.randomUUID());
 fs.mkdirSync(stage,{mode:0o700});
 syncDir(archiveParent);
 if(crash==='after_stage')process.exit(131);
 for(const [name,bytes] of Object.entries(all))writeImmutable(path.join(stage,name),bytes);
 syncDir(stage);
 if(crash==='after_fsync')process.exit(132);
 need(!fs.existsSync(final),'archive_conflict');
 fs.renameSync(stage,final);
 syncDir(archiveParent);
 if(crash==='after_rename')process.exit(133);
 const result=validateFinal(final,all,ctx.uid);
 need((ctx.uid===0?I.inspectFixedNativeJournalState(id):
  I.inspectIsolatedJournalFixture(ctx.root,id,ctx.old,ctx.next))===state,
  'source_changed_after_archive');
 return result;
}
function archiveFixedRootTerminalJournal(journalId){
 need(process.getuid?.()===0,'root_required');
 return archive({root:FENCE,uid:0},journalId);
}
function archiveIsolatedTerminalFixture(root,id,old,next,crash=null){
 need(process.getuid?.()!==0,'fixture_nonroot_required');
 return archive({root,uid:process.getuid(),old,next},id,crash);
}
module.exports=Object.freeze({
 archiveFixedRootTerminalJournal,archiveIsolatedTerminalFixture,
 ROOT_ACTION_REGISTERED:false,TERMINAL_LEASE_RETIRED:false,
 PRODUCTION_EXECUTION_AUTHORIZED:false
});
