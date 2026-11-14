'use strict';
/**
 * U06 shared exclusive operation gate — SOURCE-ONLY.
 *
 * One O_EXCL, fsynced lock for all five fixture actor types:
 * owner challenge issuance, sealed evidence staging, OIDC consumption,
 * expired challenge reconciliation, and Native backup admission.
 * The same file path is shared across OS processes; no TTL auto-reclaim.
 * The real Root actor adapters are NOT bound. A crash leaves a fail-closed
 * lock until a separately reviewed authorized recovery.
 *
 * THIS IS NOT A LIVE ROOT ACTION OR A PRIVILEGED CLI. The only constructor
 * strictly requires an unprivileged fixture under /tmp/.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const KINDS=Object.freeze([
 'owner_challenge_issuance','owner_evidence_staging','owner_evidence_consumption',
 'expired_challenge_reconciliation','native_backup_transaction'
]);
const LOCK_NAME='u06-owner-shared-exclusive.lock';
const RECEIPTS='u06-owner-shared-receipts';
const SHA=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=x=>{throw Error('u06_shared_lock_'+x)};
const need=(v,x)=>{if(!v)fail(x)};
const absent=p=>{try{fs.lstatSync(p);return false}catch(e){if(e.code==='ENOENT')return true;throw e}};
function sync(dir){
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function trustDir(dir,uid){
 const d=fs.lstatSync(dir);
 need(d.isDirectory()&&!d.isSymbolicLink()&&d.uid===uid&&
   (d.mode&0o777)===0o700,'untrusted_directory');
}
function strictFile(file,uid,max=8192){
 const a=fs.lstatSync(file);
 need(a.isFile()&&!a.isSymbolicLink()&&a.uid===uid&&a.nlink===1&&
   (a.mode&0o777)===0o600&&a.size>0&&a.size<=max,'untrusted_file');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const b=fs.fstatSync(fd);
  need(a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
    a.mode===b.mode&&b.nlink===1,'file_raced');
  return fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
}
function exclusive(file,bytes,uid){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
   fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  const st=fs.fstatSync(fd);
  need(st.isFile()&&st.uid===uid&&st.nlink===1&&
    (st.mode&0o777)===0o600,'new_file_invalid');
  fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 sync(path.dirname(file));
}
function parse(b,key){try{return JSON.parse(b.toString('utf8'))}catch{fail(key)}}
class FixtureSharedGate {
 constructor(root,uid,hook){
  this.root=root;this.uid=uid;this.hook=hook;
  this.lock=path.join(root,LOCK_NAME);
  this.history=path.join(root,RECEIPTS);
  trustDir(root,uid);trustDir(this.history,uid);
 }
 inspect(){
  trustDir(this.root,this.uid);
  if(absent(this.lock))return Object.freeze({locked:false});
  const v=parse(strictFile(this.lock,this.uid),'lock_malformed');
  need(v.schema==='prhm.u06.shared-owner-exclusive.v1'&&
    KINDS.includes(v.kind)&&/^[0-9a-f]{40}$/.test(v.id||'')&&
    /^[0-9a-f]{64}$/.test(v.token_sha256||''),'lock_scope_drift');
  return Object.freeze({locked:true,kind:v.kind,id:v.id,
    requires_manual_recovery:true});
 }
 begin(kind){
  need(KINDS.includes(kind),'operation_not_allowed');
  trustDir(this.root,this.uid);trustDir(this.history,this.uid);
  need(absent(this.lock),'busy_or_unrecovered');
  // Never run one of these operations while Native already owns its
  // distinct exclusive transaction/journal. Native must take shared first.
  for(const f of ['u06-exclusive.lease','u06-rollback.json'])
   need(absent(path.join(this.root,f)),'existing_native_transaction');
  const id=crypto.randomBytes(20).toString('hex');
  const token=crypto.randomBytes(32).toString('hex');
  const msg=Buffer.from(JSON.stringify({schema:'prhm.u06.shared-owner-exclusive.v1',
    id,kind,token_sha256:SHA(token),state:'HELD'})+'\n');
  // If interrupted during O_EXCL+write+fsync, preserve the blocking
  // incomplete leaf. Never delete/reclaim it automatically.
  try{exclusive(this.lock,msg,this.uid)}
  catch(e){if(e?.code==='EEXIST')fail('busy_or_unrecovered');throw e}
  this.hook?.('acquired',kind);
  return Object.freeze({id,kind,token});
 }
 assertHeld(lease,kind){
  need(lease&&typeof lease==='object'&&KINDS.includes(kind)&&
    lease.kind===kind&&/^[0-9a-f]{40}$/.test(lease.id||'')&&
    /^[0-9a-f]{64}$/.test(lease.token||''),'lease_invalid');
  const v=parse(strictFile(this.lock,this.uid),'lock_malformed');
  need(v.schema==='prhm.u06.shared-owner-exclusive.v1'&&v.state==='HELD'&&
    v.id===lease.id&&v.kind===kind&&
    v.token_sha256===SHA(lease.token),'wrong_lease_owner');
  return true;
 }
 finish(lease,kind,{terminalProof}={}){
  this.assertHeld(lease,kind);
  // A real Root binding MUST validate terminalProof against its own
  // durable native journal; in fixture, it may only prove lock semantics.
  need(terminalProof===true,'terminal_journal_not_attested');
  trustDir(this.history,this.uid);
  const file=path.join(this.history,lease.id+'.completed.json');
  exclusive(file,Buffer.from(JSON.stringify({
    schema:'prhm.u06.shared-owner-exclusive-completed.v1',
    id:lease.id,kind,token_sha256:SHA(lease.token),terminal:true
  })+'\n'),this.uid);
  this.hook?.('receipt_durable',kind);
  this.assertHeld(lease,kind);
  fs.unlinkSync(this.lock);sync(this.root);
  this.hook?.('unlocked',kind);
  return Object.freeze({released:true,kind,receipt_durable:true});
 }
 // Fixture ONLY: recover if the terminal receipt is already fsynced and
 // matches the lock. No dynamic unlink of a live/partial lease.
 resumeTerminalRelease(lease,kind){
  this.assertHeld(lease,kind);
  const receipt=parse(strictFile(path.join(this.history,lease.id+'.completed.json'),
    this.uid),'receipt_malformed');
  need(receipt.schema==='prhm.u06.shared-owner-exclusive-completed.v1'&&
    receipt.terminal===true&&receipt.id===lease.id&&
    receipt.kind===kind&&receipt.token_sha256===SHA(lease.token),
    'terminal_receipt_drift');
  fs.unlinkSync(this.lock);sync(this.root);
  return Object.freeze({released:true,recovery:'terminal_receipt_verified'});
 }
}
function createUnprivilegedFixtureSharedGate(root,{failureHook=null}={}){
 need(process.platform==='linux'&&typeof process.getuid==='function'&&
   process.getuid()!==0,'unprivileged_fixture_only');
 need(typeof root==='string'&&
   /^\/tmp\/u06-owner-shared-test-[a-f0-9]{12}$/.test(root),
   'fixture_root_rejected');
 need(fs.realpathSync(root)===root,'fixture_root_symlink');
 need(failureHook===null||typeof failureHook==='function','hook_invalid');
 const uid=process.getuid();
 trustDir(root,uid);
 const history=path.join(root,RECEIPTS);
 if(absent(history)){fs.mkdirSync(history,{mode:0o700});sync(root)}
 trustDir(history,uid);
 return new FixtureSharedGate(root,uid,failureHook);
}
/**
 * Guard for imported actual source functions. A caller passing arbitrary
 * {assertHeld:()=>true} cannot satisfy this guard: the lease must be checked
 * against the concrete fixture gate object and its private on-disk lock.
 * This intentionally refuses all Root invocations pending a separately
 * signed and installed production Root gate. No live bypass is exported.
 */
function assertSourceBoundLease(binding,kind){
 need(KINDS.includes(kind),'operation_not_allowed');
 need(typeof process.getuid==='function'&&process.getuid()!==0,
   'live_root_gate_not_installed');
 need(binding&&typeof binding==='object'&&
   Object.keys(binding).sort().join('|')==='gate|lease'&&
   binding.gate instanceof FixtureSharedGate,'untrusted_binding');
 const gate=binding.gate;
 // Require the constructor to have validated its private fixture path
 // (including owner, symlink, 0700 path and fixed /tmp prefix).
 need(typeof gate.root==='string'&&
   /^\/tmp\/u06-owner-shared-test-[a-f0-9]{12}$/.test(gate.root)&&
   fs.realpathSync(gate.root)===gate.root,'binding_path_invalid');
 return gate.assertHeld(binding.lease,kind);
}

module.exports=Object.freeze({
 KINDS,LOCK_NAME,RECEIPTS,createUnprivilegedFixtureSharedGate,assertSourceBoundLease,
 ROOT_ENTRYPOINT:false,PRODUCTION_AUTHORIZED:false,LEVEL4_ISSUER:false
});
if(require.main===module){
 process.stderr.write('U06 shared lock is fixture-only; no Root CLI or Host Action.\n');
 process.exitCode=64;
}
