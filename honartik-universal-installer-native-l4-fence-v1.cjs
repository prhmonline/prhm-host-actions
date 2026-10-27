'use strict';
/**
 * Issue #217 — native single-use approval fence, source only.
 * Production entrypoint has NO caller-chosen directory, scope or token.
 * This is not a Host Actions registration or an installer runner.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {ACTION,readNativeConsumedProof}=
 require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const FENCE_DIR='/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const deny=x=>{throw Error('honartik217_approval_fence_'+x)};
const need=(x,n)=>{if(!x)deny(n)};
function fsyncDir(dir){
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
   fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function checkPrivateDirectory(directory,owner){
 const st=fs.lstatSync(directory);
 need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===owner&&
   (st.mode&0o777)===0o700&&st.nlink>=2,'fence_directory_untrusted');
 return st;
}
function reserve(dir,proof,owner){
 need(proof&&proof.ok===true&&proof.action===ACTION&&
   UUID.test(proof.request_id||'')&&UUID.test(proof.approval_id||'')&&
   SHA.test(proof.policy_sha256||'')&&SHA.test(proof.arguments_sha256||'')&&
   proof.signature_verified===true&&
   proof.consumed_ledger_verified===true&&
   proof.execution_fence_reserved===false&&
   proof.installer_upgraded===false,'approval_proof_untrusted');
 const before=checkPrivateDirectory(dir,owner);
 const file=path.join(dir,proof.approval_id+'.json');
 const record=Buffer.from(JSON.stringify({
   schema_version:'prhm.honartik217.l4-execution-fence.v1',
   action:ACTION,
   approval_id:proof.approval_id,
   request_id:proof.request_id,
   policy_sha256:proof.policy_sha256,
   arguments_sha256:proof.arguments_sha256,
   created_at:new Date().toISOString(),
   state:'reserved_no_replay'
 })+'\n');
 let fd;
 try{
  fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  const stat=fs.fstatSync(fd);
  need(stat.isFile()&&stat.uid===owner&&
    (stat.mode&0o777)===0o600&&stat.nlink===1,'fence_file_unsafe');
  need(fs.writeSync(fd,record,0,record.length)===record.length,
    'fence_short_write');
  fs.fsyncSync(fd);
 }catch(error){
   // Never remove a partial fence: the approval is permanently burned.
   if(error?.code==='EEXIST')deny('approval_replayed');
   throw error;
 }finally{if(fd!==undefined)fs.closeSync(fd)}
 const after=checkPrivateDirectory(dir,owner);
 need(before.dev===after.dev&&before.ino===after.ino&&
   before.uid===after.uid&&before.mode===after.mode,
   'fence_directory_changed');
 fsyncDir(dir);
 return Object.freeze({
   ok:true,action:ACTION,approval_id:proof.approval_id,
   request_id:proof.request_id,durable_one_time_fence:true,
   policy_sha256:proof.policy_sha256,
   arguments_sha256:proof.arguments_sha256,
   installer_upgraded:false
 });
}
function reserveFixedApprovalFence(requestId,rootSealedTokenLoader){
 need(typeof process.getuid==='function'&&process.getuid()===0,'root_required');
 const proof=readNativeConsumedProof(requestId,rootSealedTokenLoader);
 return reserve(FENCE_DIR,proof,0);
}
function reserveIsolatedFixtureFence(dir,proof){
 need(typeof process.getuid==='function'&&process.getuid()!==0,
   'fixture_must_be_nonroot');
 need(typeof dir==='string'&&path.dirname(dir)===os.tmpdir()&&
   path.basename(dir).startsWith('prhm-honartik217-fence-fixture-'),
   'fixture_path_denied');
 return reserve(dir,proof,process.getuid());
}
module.exports=Object.freeze({
 ACTION,reserveFixedApprovalFence,reserveIsolatedFixtureFence,
 REAL_ROOT_REGISTRATION:false,INSTALLER_APPLY_PRESENT:false
});
