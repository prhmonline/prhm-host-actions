'use strict';
/**
 * Isolated U06 Native Root-path integration, SOURCE-ONLY.
 *
 * Drives actual U06 shared signed admission + Native durable lease/journal +
 * official independently signed/consumed L4 replay fence on real Linux disk.
 * No test callback can issue L4, forge a Native journal, or mark backup
 * successful. The only safe terminal tested here is verified ROLLED_BACK.
 *
 * Explicitly NOT a real Root Host Action, credential issuer, DB backup,
 * offsite restore, Production release, or full owner OIDC flow.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const SharedAdmission=require('./honartik-u06-root-signed-shared-lock-candidate-v1.cjs');
const NativeLease=require('./honartik-u06-native-root-lease-v1.cjs');
const NativeL4=require('./honartik-u06-native-root-l4-admission-v1.cjs');
const NativeScope=require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=x=>{throw Error('u06_isolated_native_'+x)};
const need=(v,x)=>{if(!v)fail(x)};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function exactDir(d){
 need(typeof d==='string'&&fs.realpathSync(d)===d,'directory_canonical');
 const s=fs.lstatSync(d),uid=process.getuid();
 need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===uid&&
  (s.mode&0o777)===0o700,'directory_untrusted');
}
function owned(file,max=200000){
 const a=fs.lstatSync(file),uid=process.getuid();
 need(a.isFile()&&!a.isSymbolicLink()&&a.uid===uid&&
  a.nlink===1&&(a.mode&0o777)===0o600&&a.size>0&&a.size<=max,
  'file_untrusted');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const b=fs.fstatSync(fd);
  need(a.dev===b.dev&&a.ino===b.ino&&a.size===b.size,'file_raced');
  return fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
}
function createIsolatedNativeRootPath({
 sharedRoot,authRoot,nativeRoot,nativePolicy,profile,adapter,credential,
 requestId,token,reviewedPolicySha256,checkpoint=null
}={}){
 need(process.platform==='linux'&&typeof process.getuid==='function'&&
  process.getuid()!==0,'unprivileged_fixture_only');
 need(/^\/tmp\/u06-root-lease-test-[a-zA-Z0-9]{6}$/.test(nativeRoot||''),
  'isolated_native_root_only');
 exactDir(nativeRoot);
 need(requestId&&UUID.test(requestId)&&typeof token==='string'&&
  token.length>120&&token.length<16384,'untrusted_signed_request');
 need(typeof reviewedPolicySha256==='string'&&
  /^[a-f0-9]{64}$/.test(reviewedPolicySha256),'policy_sha_missing');
 need(nativePolicy&&Object.keys(nativePolicy).sort().join('|')===
  ['policy','issuer','consumed','fence','policy_sha256'].sort().join('|')&&
  nativePolicy.policy_sha256===reviewedPolicySha256,
  'signed_native_policy_scope_mismatch');
 need(typeof checkpoint==='function'||checkpoint===null,'checkpoint_invalid');
 const shared=SharedAdmission.createUnprivilegedSignedLockFixture({sharedRoot,authRoot});
 const lease=NativeLease.createDisposableFixtureLease(nativeRoot,profile,adapter,credential);
 // Preflight must hold independently: even a valid L4 cannot create a
 // journal if the existing native lock/journal is present.
 const l4Path=path.join(nativePolicy.fence);
 function snap(){
  const details=shared.inspect();
  return Object.freeze({
   shared_locked:details.locked===true,
   shared_kind:details.kind||null,
   native:lease.inspect(),
   official_fence_files:fs.readdirSync(l4Path).length
  });
 }
 function step(mark){checkpoint?.(mark)}
 function executeVerifiedRollback(){
  // The actual Native coordinator's fixed journal+fence order is followed,
  // with the real modules (not a boolean fake receipt).
  const requested={
   token,requestId,paths:nativePolicy,nativeRoot,F:{
    operation:'honartik_back.production.native_backup',
    reviewed_l4_policy_sha256:reviewedPolicySha256
   }
  };
  const session=shared.beginAuthorized('native_backup_transaction',requested);
  step('shared_admitted');
  need(shared.assertAuthorized(session,'native_backup_transaction')===true,
   'signed_shared_session_untrusted');
  lease.acquire();
  step('native_locked');
  const pre=lease.attestPreimage();
  need(pre.profile_sha256&&pre.adapter_sha256,'native_preimage_not_attested');
  const journal=lease.prepareJournal();
  need(journal.state==='PREPARED'&&journal.durable===true&&
   lease.journalState()==='PREPARED','native_journal_not_durable');
  step('prepared_journal');
  const l4=NativeL4.createDisposableRootL4Fixture(requestId,()=>token,nativePolicy);
  const F=requested.F;
  const proof=l4.verifyNativeConsumedSignedLevel4(F,journal);
  need(proof.operation===NativeScope.OPERATION&&
   proof.approval_id===session.approval_id&&
   proof.signature_verified===true&&proof.consumed_ledger_verified===true,
   'native_l4_proof_drift');
  need(l4.reserveNativeLevel4ReplayFence(F,journal,proof)===true,
   'native_l4_fence_not_durable');
  step('native_l4_consumed');
  const old=NativeL4.createDisposableRootL4Fixture(requestId,()=>token,nativePolicy);
  const duplicate=old.verifyNativeConsumedSignedLevel4(F,journal);
  let replayRefused=false;
  try{old.reserveNativeLevel4ReplayFence(F,journal,duplicate)}
  catch(e){if(e.code==='EEXIST')replayRefused=true;else throw e}
  need(replayRefused,'native_replay_not_refused');
  // Only an actual, fsynced Native rollback journal may permit release.
  const rollback=lease.verifyAndRecordRollback();
  need(rollback.rolled_back===true&&rollback.durable===true&&
    lease.journalState()==='ROLLED_BACK','native_rollback_not_durable');
  step('rolled_back_journal');
  const journalFile=path.join(nativeRoot,'u06-rollback.json');
  const bytes=owned(journalFile);
  const row=JSON.parse(bytes.toString('utf8'));
  need(row.schema==='prhm.u06.root-rollback.v1'&&
   row.id===journal.id&&row.state==='ROLLED_BACK'&&
   row.rollback_original_profile_verified===true&&
   row.credential_absent_verified===true,
   'native_terminal_journal_untrusted');
  const digest=H(bytes);
  need(lease.release().released===true,'native_lease_not_released');
  step('native_unlocked');
  const complete=shared.finishFixture(session,{
   lease_id:session.binding.lease.id,kind:session.kind,
   approval_id:session.approval_id,terminal:'DONE',
   journal_sha256:digest
  });
  need(complete.released===true,'shared_lock_not_released');
  step('shared_released');
  return Object.freeze({
   source_only:true,verified_rollback:true,
   shared_lock_released:true,terminal_journal_sha256:digest,
   official_l4_consumption_count:1,official_l4_replay_denied:true,
   native_backup_executed:false,db_access_executed:false,
   root_action_installed:false,production_mutated:false
  });
 }
 return Object.freeze({
  executeVerifiedRollback,inspect:snap,
  ROOT_ACTION_REGISTERED:false,PRODUCTION_APPLY:false,
  NATIVE_BACKUP_EXECUTABLE:false
 });
}
module.exports=Object.freeze({
 createIsolatedNativeRootPath,
 ROOT_ACTION_REGISTERED:false,PRODUCTION_APPLY:false,
 NATIVE_BACKUP_EXECUTABLE:false,LEVEL4_ISSUER:false
});
if(require.main===module){
 process.stderr.write('Isolated U06 Native Root-path contract only; no CLI or Production apply.\n');
 process.exitCode=64;
}
