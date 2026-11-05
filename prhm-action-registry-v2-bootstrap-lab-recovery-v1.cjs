'use strict';
/**
 * PRHM Shared Registry V2: actual filesystem rollback EXERCISE, LAB-ONLY.
 *
 * NOT a Production root installer, not an L4 authority, not a general
 * delete API. Every read/write is mapped into a 0700 mkdtemp child of
 * os.tmpdir whose basename is prhm-registry-v2-lab-*. No host path can be
 * selected. A verified complete WAL prefix with NO pending intent is a
 * prerequisite. Journal with pending/torn/foreign state FAILS CLOSED.
 *
 * Before deleting anything, a durable exclusive rollback intent is fsynced.
 * For each step: append+fsync intent; verify exact created inode/bytes;
 * unlink or empty rmdir; fsync parent; append+fsync done. Interrupted
 * recovery leaves the lock, forward WAL, and partial recovery journal for
 * independent manual review. NEVER automatically retries an uncertain op.
 *
 * Does not auto-unlock or clear either WAL or forward one-time lock.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const os=require('node:os');
const REAL=require('./prhm-action-registry-v2-bootstrap-real-fs-lab-v1.cjs');
const WAL=require('./prhm-action-registry-v2-bootstrap-wal-v1.cjs');
const LOCK=require('./prhm-action-registry-v2-bootstrap-exclusive-lock-v1.cjs');
const C=fs.constants;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const RECOVERY_PATH=WAL.PARENT+'/registry-bootstrap-v2-lab-rollback.jsonl';
function fail(reason){throw Error('registry_v2_lab_recovery_'+reason)}
function must(ok,reason){if(!ok)fail(reason)}
function safeDir(root,dir){
 REAL.checkJail(root);
 must(dir===root||dir.startsWith(root+'/'),'parent_outside_lab');
 let here=root;
 for(const part of path.relative(root,dir).split(path.sep).filter(Boolean)){
  here=path.join(here,part);
  const st=fs.lstatSync(here);
  must(st.isDirectory()&&!st.isSymbolicLink()&&
    fs.realpathSync(here)===here&&st.uid===process.getuid()&&
    st.gid===process.getgid()&&(st.mode&0o777)===0o700,
    'untrusted_parent_directory');
 }
 return true;
}
function syncDir(root,dir){
 safeDir(root,dir);
 const fd=fs.openSync(dir,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);
 try{must(fs.fstatSync(fd).isDirectory(),'not_dir_fd');fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
}
function readExact(root,filename,{bytes=null,hash=null,max=4000000}={}){
 safeDir(root,path.dirname(filename));
 const st=fs.lstatSync(filename);
 must(st.isFile()&&!st.isSymbolicLink()&&
  fs.realpathSync(filename)===filename&&
  st.uid===process.getuid()&&st.gid===process.getgid()&&
  (st.mode&0o777)===0o600&&st.size>0&&st.size<=max,
  'unexpected_file_metadata');
 const fd=fs.openSync(filename,C.O_RDONLY|C.O_NOFOLLOW);
 let buf;
 try{
  const after=fs.fstatSync(fd);
  must(after.isFile()&&after.dev===st.dev&&after.ino===st.ino&&
   after.uid===st.uid&&after.gid===st.gid&&
   after.mode===st.mode&&after.size===st.size,
   'file_changed_during_read');
  buf=fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
 must(buf.length===st.size&&
  (bytes===null||buf.equals(bytes))&&
  (hash===null||sha(buf)===hash),
  'file_bytes_or_digest_drift');
 return buf;
}
function absent(filename){
 try{fs.lstatSync(filename);return false}catch(e){
  if(e.code==='ENOENT')return true;throw e
 }
}
function recoveryCandidates(root,proposal){
 REAL.checkJail(root);
 const lock=REAL.mapped(root,LOCK.LOCK);
 const journal=REAL.mapped(root,WAL.JPATH);
 readExact(root,lock,{bytes:LOCK.lockBytes(proposal),max:LOCK.MAX});
 const state=WAL.scan(readExact(root,journal,{max:WAL.MAX}),proposal);
 must(state.pending===null&&state.completed>0 &&
  state.ready_for_external_review===true &&
  state.safe_to_resume===false,
  'forward_journal_indeterminate_or_empty');
 const intent=REAL.mapped(root,RECOVERY_PATH);
 safeDir(root,path.dirname(intent));
 must(absent(intent),'existing_recovery_requires_independent_review');
 const completed=proposal.operations.slice(0,state.completed);
 const done=new Set(completed.map(x=>x.path));
 // Verify every applied step precisely and all NOT-yet-applied targets absent.
 for(const step of proposal.operations){
  const filename=REAL.mapped(root,step.path);
  const created=done.has(step.path);
  if(!created){
   must(absent(filename),'unrecorded_write_requires_manual_review');
  }else if(step.kind==='mkdir'){
   safeDir(root,filename);
  }else{
   must(step.kind==='create_file','unexpected_operation');
   const bytes=readExact(root,filename,{hash:step.sha256});
   must(blob(bytes)===step.git_blob_sha1,'git_blob_drift');
  }
 }
 const createdDirs=completed.filter(x=>x.kind==='mkdir');
 const createdPaths=new Set(completed.map(x=>x.path));
 // Reject any unknown files *before the first mutation*. No rmdir may
 // accidentally delete something created by another actor or another action.
 for(const entry of createdDirs){
  const here=REAL.mapped(root,entry.path);
  const found=fs.readdirSync(here);
  for(const name of found){
   const child=entry.path+'/'+name;
   must(createdPaths.has(child),'foreign_child_inside_stage_directory');
  }
 }
 return Object.freeze({
  schema:'prhm.registry-v2.lab-recovery-preview.v1',
  request_id:proposal.request_id,
  forward_wal_sha256:state.last_sha256,
  proposal_sha256:WAL.digestProposal(proposal),
  steps:Object.freeze([...completed].reverse().map(x=>Object.freeze({...x}))),
  count:completed.length,root,authorized:false,
  production_rollback:false
 });
}
function append(root,log,item){
 const bytes=Buffer.from(JSON.stringify(item)+'\n');
 must(bytes.length<4000,'audit_record_size');
 const fd=fs.openSync(log,C.O_WRONLY|C.O_APPEND|C.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  must(stat.isFile()&&stat.uid===process.getuid()&&
   (stat.mode&0o777)===0o600,'audit_file_changed');
  must(fs.writeSync(fd,bytes,0,bytes.length)===bytes.length,
   'audit_short_write_indeterminate');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 syncDir(root,path.dirname(log));
}
function createLabRecovery({root,proposal}={}){
 REAL.checkJail(root);
 const p=WAL.digestProposal(proposal);
 let used=false;
 function preview(){
  must(!used,'recovery_session_used');
  return recoveryCandidates(root,proposal);
 }
 function rollback({afterIntent,afterPhysical}={}){
  must(!used,'recovery_session_used');
  used=true; // any exception is terminal; never resume or replay
  const reviewed=recoveryCandidates(root,proposal);
  must(reviewed.proposal_sha256===p,'proposal_changed');
  const log=REAL.mapped(root,RECOVERY_PATH);
  const start=Buffer.from(JSON.stringify({
   schema:'prhm.registry-v2.lab-recovery-journal.v1',
   kind:'start',request_id:proposal.request_id,
   proposal_sha256:p,forward_wal_sha256:reviewed.forward_wal_sha256,
   steps:reviewed.count,environment:'isolated-mkdtemp-lab',
   authorized_for_production:false
  })+'\n');
  safeDir(root,path.dirname(log));
  const fd=fs.openSync(log,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);
  try{
   must(fs.writeSync(fd,start,0,start.length)===start.length,
     'recovery_header_short_write_indeterminate');
   fs.fsyncSync(fd);
  }finally{fs.closeSync(fd)}
  syncDir(root,path.dirname(log));
  let completed=0;
  for(const step of reviewed.steps){
   // Re-attest the durable original forward WAL and lock before each write.
   readExact(root,REAL.mapped(root,LOCK.LOCK),{
    bytes:LOCK.lockBytes(proposal),max:LOCK.MAX
   });
   const forward=WAL.scan(readExact(root,REAL.mapped(root,WAL.JPATH),
    {max:WAL.MAX}),proposal);
   must(forward.pending===null&&forward.completed===reviewed.count&&
    forward.last_sha256===reviewed.forward_wal_sha256,
    'forward_wal_or_lock_modified');
   const filename=REAL.mapped(root,step.path);
   const parent=path.dirname(filename);
   safeDir(root,parent);
   if(step.kind==='create_file'){
    const b=readExact(root,filename,{hash:step.sha256});
    must(blob(b)===step.git_blob_sha1,'created_file_not_exact_git_blob');
   }else{
    must(step.kind==='mkdir','unreviewed_step_kind');
    safeDir(root,filename);
    must(fs.readdirSync(filename).length===0,
      'stage_directory_not_empty');
   }
   append(root,log,{
    kind:'intent',index:completed,step_kind:step.kind,
    path:step.path,proposal_sha256:p
   });
   if(typeof afterIntent==='function')afterIntent(completed);
   if(step.kind==='create_file')fs.unlinkSync(filename);
   else fs.rmdirSync(filename);
   syncDir(root,parent);
   if(typeof afterPhysical==='function')afterPhysical(completed);
   must(absent(filename),'rollback_postcondition_failed');
   append(root,log,{
    kind:'done',index:completed,step_kind:step.kind,
    path:step.path,proposal_sha256:p
   });
   completed++;
  }
  for(const step of proposal.operations)
   must(absent(REAL.mapped(root,step.path)),
    'rollback_staged_object_still_present');
  // Evidence preservation is mandatory; never delete one-time lock or WAL.
  readExact(root,REAL.mapped(root,LOCK.LOCK),{
   bytes:LOCK.lockBytes(proposal),max:LOCK.MAX
  });
  const final=WAL.scan(readExact(root,REAL.mapped(root,WAL.JPATH),
   {max:WAL.MAX}),proposal);
  must(final.last_sha256===reviewed.forward_wal_sha256,
   'forward_evidence_changed');
  append(root,log,{
   kind:'complete',count:completed,request_id:proposal.request_id,
   proposal_sha256:p,original_forward_wal_preserved:true,
   original_lock_preserved:true
  });
  return Object.freeze({
   result:'ISOLATED_LAB_ROLLBACK_VERIFIED',
   reversed_steps:completed,forward_lock_preserved:true,
   forward_wal_preserved:true,
   production_changed:false,approval_consumed:false,
   root_installer_available:false,auto_resume_allowed:false
  });
 }
 return Object.freeze({preview,rollback});
}
module.exports=Object.freeze({RECOVERY_PATH,createLabRecovery});
