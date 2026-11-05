'use strict';
/**
 * Real kernel/filesystem exercise for exact Honartik V2 bootstrap.
 *
 * HARD LAB JAIL: may touch ONLY a direct private mkdtemp child of os.tmpdir
 * named prhm-registry-v2-lab-*. The production /opt, /var and /run trees
 * are NEVER writable through this module; paths are remapped into this jail.
 *
 * Implements actual O_EXCL, O_NOFOLLOW, fstat, file+parent fsync, SHA-pinned
 * byte writes and WAL intent -> physical op -> verified done. Deliberately
 * NO real root launcher / approval / rollback / service / socket / CLI.
 * SIGKILL leaves durable lock and WAL, and no method can resume or unlink.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const WAL=require('./prhm-action-registry-v2-bootstrap-wal-v1.cjs');
const LOCK=require('./prhm-action-registry-v2-bootstrap-exclusive-lock-v1.cjs');
const PREFIX='prhm-registry-v2-lab-';
const MAX_FILE_BYTES=4000000;
const C=fs.constants;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
function fail(s){throw Error('registry_v2_real_fs_lab_'+s)}
function check(v,s){if(!v)fail(s)}
function privateDir(p){
 const st=fs.lstatSync(p);
 check(st.isDirectory()&&!st.isSymbolicLink()&&
  fs.realpathSync(p)===p&&st.uid===process.getuid()&&
  st.gid===process.getgid()&&(st.mode&0o777)===0o700,
  'unsafe_directory_or_owner');
 return st;
}
function checkJail(root){
 check(typeof root==='string'&&
  path.isAbsolute(root)&&path.normalize(root)===root&&
  path.dirname(root)===path.resolve(os.tmpdir())&&
  /^prhm-registry-v2-lab-[a-zA-Z0-9]{6,}$/.test(path.basename(root))&&
  typeof process.getuid==='function'&&process.getuid()!==undefined,
  'non_lab_root_denied');
 privateDir(root);
 return root;
}
function mapped(root,original){
 check(typeof original==='string'&&original.startsWith('/')&&
  path.posix.normalize(original)===original&&
  !original.split('/').includes('..')&&
  /^\/[A-Za-z0-9._/-]+$/.test(original),'noncanonical_stage_path');
 const dest=path.join(root,original.slice(1));
 check(dest.startsWith(root+'/')&&dest!==root,'stage_outside_lab');
 return dest;
}
function secureDirPath(root,actual){
 check(actual===root||actual.startsWith(root+'/'),'untrusted_parent_path');
 let cursor=root;
 privateDir(cursor);
 for(const part of path.relative(root,actual).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);
  privateDir(cursor);
 }
 return privateDir(actual);
}
function readFile(root,filename,max=WAL.MAX){
 const parent=path.dirname(filename);
 const before=secureDirPath(root,parent);
 const st=fs.lstatSync(filename);
 check(st.isFile()&&!st.isSymbolicLink()&&
  fs.realpathSync(filename)===filename&&
  st.uid===process.getuid()&&st.gid===process.getgid()&&
  (st.mode&0o777)===0o600&&
  Number.isSafeInteger(st.size)&&st.size>0&&st.size<=max,
  'read_file_unsafe');
 const fd=fs.openSync(filename,C.O_RDONLY|C.O_NOFOLLOW);
 let b;
 try{
  const current=fs.fstatSync(fd);
  check(current.isFile()&&current.dev===st.dev&&
   current.ino===st.ino&&current.mode===st.mode&&
   current.uid===st.uid&&current.gid===st.gid&&
   current.size===st.size,'read_inode_changed');
  b=fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
 check(b.length===st.size,'short_read');
 const after=secureDirPath(root,parent);
 check(before.ino===after.ino&&before.dev===after.dev,
  'read_parent_changed');
 return Object.freeze({bytes:b,stat:st});
}
function fsyncDirectory(root,directory){
 secureDirPath(root,directory);
 const fd=fs.openSync(directory,C.O_RDONLY|C.O_NOFOLLOW|C.O_DIRECTORY);
 try{const s=fs.fstatSync(fd);check(s.isDirectory(),'sync_fd_not_directory');
  fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function createExclusive(root,file,bytes){
 check(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_FILE_BYTES,
  'untrusted_write_bytes');
 const parent=path.dirname(file),before=secureDirPath(root,parent);
 const fd=fs.openSync(file,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);
 try{
  const count=fs.writeSync(fd,bytes,0,bytes.length);
  check(count===bytes.length,'short_write_indeterminate');
  fs.fsyncSync(fd);
  const s=fs.fstatSync(fd);
  check(s.isFile()&&s.uid===process.getuid()&&
   s.gid===process.getgid()&&(s.mode&0o777)===0o600&&
   s.size===bytes.length,'exclusive_file_metadata_drift');
 }finally{fs.closeSync(fd)}
 fsyncDirectory(root,parent);
 const after=secureDirPath(root,parent);
 check(before.ino===after.ino&&before.dev===after.dev,
  'exclusive_parent_replaced');
 const result=readFile(root,file,MAX_FILE_BYTES);
 check(result.bytes.equals(bytes),'exclusive_postcondition_drift');
}
function appendRecord(root,filename,record,proposal){
 const before=readFile(root,filename);
 const state=WAL.scan(before.bytes,proposal);
 check(record.previous_sha256===state.last_sha256,'journal_previous_drift');
 const bytes=Buffer.from(JSON.stringify(record)+'\n');
 check(before.bytes.length+bytes.length<=WAL.MAX,'journal_full');
 const fd=fs.openSync(filename,C.O_WRONLY|C.O_APPEND|C.O_NOFOLLOW);
 try{
  const st=fs.fstatSync(fd);
  check(st.isFile()&&st.dev===before.stat.dev&&
    st.ino===before.stat.ino&&st.size===before.stat.size&&
    st.uid===before.stat.uid&&st.gid===before.stat.gid&&
    st.mode===before.stat.mode,'journal_append_race');
  check(fs.writeSync(fd,bytes,0,bytes.length)===bytes.length,
   'journal_short_append_indeterminate');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 fsyncDirectory(root,path.dirname(filename));
 const after=readFile(root,filename);
 const post=WAL.scan(after.bytes,proposal);
 check(post.last_sha256===record.record_sha256,
  'journal_postcondition_drift');
 return post;
}
function createLab({root,proposal,pinnedBytes}={}){
 checkJail(root);
 const identity=WAL.digestProposal(proposal);
 const files=proposal.operations.filter(s=>s.kind==='create_file');
 check(pinnedBytes&&typeof pinnedBytes==='object'&&
  Object.keys(pinnedBytes).length===20&&files.length===20,
  'pinned_source_set_invalid');
 const data=new Map();
 for(const op of files){
  const bytes=pinnedBytes[op.path];
  check(Buffer.isBuffer(bytes)&&bytes.length>0&&
    bytes.length<=MAX_FILE_BYTES&&
    sha(bytes)===op.sha256&&blob(bytes)===op.git_blob_sha1,
    'source_blob_not_git_pinned');
  data.set(op.path,Buffer.from(bytes));
 }
 const lock=mapped(root,LOCK.LOCK),journal=mapped(root,WAL.JPATH);
 let state='NEW';
 function review(){
  checkJail(root);
  const expected=LOCK.lockBytes(proposal);
  const observed=readFile(root,lock,LOCK.MAX);
  check(observed.bytes.equals(expected),
    'lock_request_or_proposal_drift');
  const j=readFile(root,journal);
  const scan=WAL.scan(j.bytes,proposal);
  check(scan.request_id===proposal.request_id&&
    scan.safe_to_resume===false,'journal_replay_guard_missing');
  return scan;
 }
 function begin(){
  check(state==='NEW','session_already_used');
  state='INDETERMINATE';
  checkJail(root);
  // The lab's pre-created private root ancestors mirror a reviewed,
  // individually attested root installation. Never create these as a
  // side effect of acquiring the lock.
  secureDirPath(root,path.dirname(lock));
  secureDirPath(root,path.dirname(journal));
  createExclusive(root,lock,LOCK.lockBytes(proposal));
  const record=WAL.makeRecord('header',-1,null,WAL.ZERO,proposal);
  createExclusive(root,journal,Buffer.from(JSON.stringify(record)+'\n'));
  const current=review();
  check(current.completed===0&&current.pending===null,
   'initial_journal_drift');
  state='STARTED';
  return current;
 }
 function step(i,{afterIntent,afterOperation}={}){
  check(state==='STARTED','lab_cannot_resume_or_replay');
  const before=review();
  check(Number.isSafeInteger(i)&&i===before.completed&&before.pending===null&&
   i<proposal.operation_count,'step_not_next_or_pending');
  const op=proposal.operations[i],dest=mapped(root,op.path);
  state='INDETERMINATE';
  const intent=WAL.makeRecord('intent',i,op,before.last_sha256,proposal);
  const started=appendRecord(root,journal,intent,proposal);
  check(started.pending===i&&started.completed===i,
   'intent_not_durable');
  if(afterIntent)afterIntent(i); // crash fault injection ONLY; no host action
  const parent=path.dirname(dest),beforeParent=secureDirPath(root,parent);
  if(op.kind==='mkdir'){
   fs.mkdirSync(dest,{mode:0o700});
   fsyncDirectory(root,parent);
   const s=privateDir(dest);
   check(s.uid===process.getuid()&&(s.mode&0o777)===0o700,
    'created_directory_postcondition');
  }else{
   check(op.kind==='create_file','unknown_physical_step');
   createExclusive(root,dest,data.get(op.path));
   const result=readFile(root,dest,MAX_FILE_BYTES);
   check(sha(result.bytes)===op.sha256&&blob(result.bytes)===op.git_blob_sha1,
    'created_file_hash_mismatch');
  }
  const afterParent=secureDirPath(root,parent);
  check(beforeParent.ino===afterParent.ino&&
   beforeParent.dev===afterParent.dev,'operation_parent_swapped');
  if(afterOperation)afterOperation(i); // SIGKILL before done
  const done=WAL.makeRecord('done',i,op,started.last_sha256,proposal);
  const finished=appendRecord(root,journal,done,proposal);
  check(finished.pending===null&&finished.completed===i+1,
   'done_postcondition_drift');
  state='STARTED';
  return finished;
 }
 return Object.freeze({begin,step,inspect:review,
  source_sha256:identity,simulated_approval_only:true,
  production_install_enabled:false});
}
module.exports=Object.freeze({PREFIX,checkJail,mapped,createLab});
