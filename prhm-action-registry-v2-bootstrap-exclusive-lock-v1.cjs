'use strict';
/**
 * Exact V2 Honartik bootstrap single-owner lock contract (source-only).
 *
 * Real filesystem writes and unlock/remove are intentionally NOT exported.
 * A separately signed, reviewed root launcher must attest and adopt the
 * immutable code, and provision a narrowly scoped root IO adapter.
 *
 * O_EXCL + O_NOFOLLOW and durable file+directory fsync make the first
 * authenticated claimant exclusive. Any subsequent attempt, truncated write,
 * uncertain result or stale lock FAILS CLOSED. No automatic retry/unlink.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const WAL=require('./prhm-action-registry-v2-bootstrap-wal-v1.cjs');
const LOCK='/var/lib/prhm-agent-selfmaint-exec/registry-bootstrap-v2.lock';
const PARENT='/var/lib/prhm-agent-selfmaint-exec';
const MAX=4096;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fail(x){throw Error('registry_v2_bootstrap_lock_'+x)}
function check(x,why){if(!x)fail(why)}
function payload(proposal){
 const proposal_sha256=WAL.digestProposal(proposal);
 check(UUID.test(proposal.request_id),'request_id_invalid');
 const o={
  schema:'prhm.registry-v2.bootstrap-exclusive-lock.v1',
  request_id:proposal.request_id,
  proposal_sha256,
  journal_path:WAL.JPATH,
  owner:'independent-signed-root-bootstrap-required',
  state:'RESERVED_NOT_AN_APPROVAL'
 };
 return Object.freeze(o);
}
function validateParent(io){
 check(typeof io?.lstatSync==='function'&&typeof io?.realpathSync==='function',
   'trusted_io_missing');
 const s=io.lstatSync(PARENT);
 check(s.isDirectory()&&!s.isSymbolicLink()&&
   io.realpathSync(PARENT)===PARENT&&
   s.uid===0&&s.gid===0&&(s.mode&0o777)===0o700&&
   Number.isSafeInteger(s.dev)&&Number.isSafeInteger(s.ino),
   'parent_unsafe');
 return s;
}
function lockBytes(proposal){
 const b=Buffer.from(JSON.stringify(payload(proposal))+'\n','utf8');
 check(b.length>100&&b.length<=MAX,'lock_length_invalid');
 return b;
}
function inspect({io,proposal}={}){
 check(io&&typeof io.openSync==='function'&&typeof io.fstatSync==='function'&&
   typeof io.readFileSync==='function'&&typeof io.closeSync==='function',
   'trusted_reader_missing');
 const parent=validateParent(io),expected=lockBytes(proposal);
 const s=io.lstatSync(LOCK);
 check(s.isFile()&&!s.isSymbolicLink()&&
   io.realpathSync(LOCK)===LOCK&&
   s.uid===0&&s.gid===0&&(s.mode&0o777)===0o600&&
   s.size===expected.length,'lock_file_unsafe_or_partial');
 const fd=io.openSync(LOCK,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let actual;
 try{
  const st=io.fstatSync(fd);
  check(st.isFile()&&st.dev===s.dev&&st.ino===s.ino&&st.size===s.size&&
   st.uid===0&&st.gid===0&&st.mode===s.mode,'lock_file_changed');
  actual=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 check(Buffer.isBuffer(actual)&&actual.equals(expected),
   'lock_identity_or_bytes_mismatch');
 const p=validateParent(io);
 check(p.dev===parent.dev&&p.ino===parent.ino,'parent_changed');
 return Object.freeze({
  schema:'prhm.registry-v2.bootstrap-lock-inspection.v1',
  request_id:proposal.request_id,
  proposal_sha256:payload(proposal).proposal_sha256,
  lock_present:true,identity_matches:true,
  // Even a valid lock isn't signed approval or authority to stage files.
  authorized:false,safe_to_resume:false,approval_consumed:false
 });
}
function createSyntheticLock({io,proposal}={}){
 check(io&&io!==fs&&typeof io.openSync==='function'&&
   typeof io.fsyncSync==='function'&&typeof io.writeSync==='function'&&
   typeof io.fstatSync==='function'&&typeof io.closeSync==='function',
   'production_lock_writer_not_authorized');
 // Never accept a fake summary in place of the canonical proposal.
 const expected=lockBytes(proposal);
 let created=false;
 function acquire(){
  check(!created,'same_process_lock_reused');
  const parent=validateParent(io);
  // No unlink of a pre-existing or stale lock, even if its bytes are valid.
  try{io.lstatSync(LOCK);fail('existing_lock_needs_operator_review')}
  catch(e){if(e?.code!=='ENOENT')throw e}
  let fd;
  fd=io.openSync(LOCK,
    fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{
   check(io.writeSync(fd,expected,0,expected.length)===expected.length,
     'short_lock_write_indeterminate');
   io.fsyncSync(fd);
   const st=io.fstatSync(fd);
   check(st.isFile()&&st.uid===0&&st.gid===0&&
     (st.mode&0o777)===0o600&&st.size===expected.length,
     'lock_create_metadata_drift');
  }finally{io.closeSync(fd)}
  const df=io.openSync(PARENT,
    fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
    fs.constants.O_NOFOLLOW);
  try{
   const st=io.fstatSync(df);
   check(st.isDirectory()&&st.uid===0&&st.gid===0&&
     st.dev===parent.dev&&st.ino===parent.ino,
     'parent_fd_swapped');
   io.fsyncSync(df);
  }finally{io.closeSync(df)}
  const after=validateParent(io);
  check(after.dev===parent.dev&&after.ino===parent.ino,
    'parent_path_replaced');
  inspect({io,proposal});
  created=true;
  return Object.freeze({
   schema:'prhm.registry-v2.synthetic-lock-acquired.v1',
   lock_path:LOCK,request_id:proposal.request_id,
   bytes_verified:true,fsync_verified:true,
   production:false,authorization:false
  });
 }
 return Object.freeze({acquire,inspect:()=>inspect({io,proposal})});
}
module.exports=Object.freeze({LOCK,PARENT,MAX,payload,lockBytes,
 inspect,createSyntheticLock});
