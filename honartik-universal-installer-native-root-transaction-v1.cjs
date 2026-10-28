'use strict';
/*
 * Issue #217 native fixed transaction assembly — SOURCE ONLY.
 * Import has no effects. This is neither a registered Root-of-Trust action
 * nor an Approval Center issuer. Existing trusted native Host Actions owner
 * must provide ONLY the confirmed request UUID and its root-sealed token
 * resolver after independent review and L4 authorize-consume.
 */
const fs=require('node:fs'),path=require('node:path');
const {CONTRACT:C}=require('./honartik-universal-installer-l4-v1.cjs');
const Gate=require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const Journal=require('./honartik-universal-installer-native-journal-writer-v1.cjs');
const Inspector=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const Python=require('./honartik-universal-installer-native-python-bridge-v1.cjs');
const Reconcile=require('./honartik-universal-installer-native-reconciler-v1.cjs');
const Archive=require('./honartik-universal-installer-native-terminal-archive-v1.cjs');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const FENCE='/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4';
const SOURCE=path.join(FENCE,'candidate-source');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=why=>{throw Error('honartik217_fixed_root_transaction_'+why)};
const need=(yes,why)=>{if(!yes)fail(why)};
function fixedStageReadOnly(){
 const dir=fs.lstatSync(FENCE);
 need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===0&&
  (dir.mode&0o777)===0o700,'fence_untrusted');
 const top=fs.lstatSync(SOURCE);
 need(top.isDirectory()&&!top.isSymbolicLink()&&top.uid===0&&
  (top.mode&0o022)===0,'staged_source_untrusted');
 let seen=0;
 function walk(dir){
  for(const name of fs.readdirSync(dir)){
   need(++seen<=1024,'source_entry_count_limit');
   const p=path.join(dir,name),st=fs.lstatSync(p);
   need(st.uid===0&&(st.mode&0o022)===0&&!st.isSymbolicLink(),
    'source_entry_untrusted');
   if(st.isDirectory())walk(p);
   else need(st.isFile()&&st.nlink===1,'source_special_file');
  }
 }
 walk(SOURCE);
 need(readTree(SOURCE).digest===C.candidate_digest,
  'candidate_source_sha_drift');
 return true;
}
function recoveryDecision(state){
 if(state==='PREPARED')return 'ROLLBACK_EXACT_PREIMAGE';
 if(state==='COMMITTED')return 'RETAIN_COMMIT_AND_LEASE';
 if(state==='ROLLED_BACK')return 'RETAIN_ROLLBACK_AND_LEASE';
 return 'REQUIRE_MANUAL_ROOT_RECOVERY';
}
function runFixedRootSignedInstaller(requestId,rootSealedTokenLoader){
 need(process.getuid?.()===0,'trusted_root_required');
 need(typeof requestId==='string'&&UUID.test(requestId),
  'signed_request_uuid_required');
 need(typeof rootSealedTokenLoader==='function',
  'trusted_sealed_loader_required');
 // Authenticated JWS + consumed-ledger read, not token issuance.
 const proof=Gate.readNativeConsumedProof(requestId,rootSealedTokenLoader);
 need(proof.ok===true&&proof.action===C.action&&
  proof.request_id===requestId&&proof.signature_verified===true&&
  proof.consumed_ledger_verified===true&&
  proof.policy_sha256===Gate.PINNED_POLICY_SHA,
  'consumed_l4_preflight_invalid');
 fixedStageReadOnly();
 let id=null;
 try{
  const journal=Journal.prepareFixedRootJournal();
  need(journal&&UUID.test(journal.id||'')&&journal.state==='PREPARED',
   'journal_prepare_ambiguous');
  id=journal.id;
  need(Inspector.inspectFixedNativeJournalState(id)==='PREPARED',
   'prepared_journal_not_durable');
  const bound=Journal.bindFixedRootSignedApproval({
   journalId:id,requestId,rootSealedTokenLoader
  });
  need(bound.ok===true&&bound.journal_id===id&&
   bound.request_id===requestId&&
   bound.approval_id===proof.approval_id&&
   bound.signed_consumed_once===true,
   'signed_l4_journal_binding_failed');
  // Fixed root-only Python bridge uses real installed interpreter, fixed
  // installer digest and fsynced O_EXCL non-replay execution marker.
  const installed=Python.installViaFixedTrustedPython(
   id,requestId,rootSealedTokenLoader);
  need(installed.ok===true&&installed.installer_switched===true&&
   installed.committed===false&&installed.lease_preserved===true&&
   installed.backend_deployed===false,'fixed_python_install_incomplete');
  const committed=Reconcile.reconcileFixedRootJournal(id,'commit');
  need(committed.ok===true&&committed.state==='COMMITTED'&&
   committed.lease_retained===true,'commit_unverified');
  need(Inspector.inspectFixedNativeJournalState(id)==='COMMITTED',
   'committed_journal_not_durable');
  const archived=Archive.archiveFixedRootTerminalJournal(id);
  need(archived.archived===true&&archived.lock_preserved===true,
   'commit_terminal_evidence_missing');
  return Object.freeze({ok:true,action:C.action,journal_id:id,
   installer_upgraded:true,committed:true,
   terminal_evidence_archived:true,lease_retained:true,
   approval_reusable:false,backend_deployed:false,
   yii_migrations_executed:false});
 }catch{
  // Lost PREPARED acknowledgement is unknown: lease may exist. Never retry.
  if(!id)fail('JOURNAL_PREPARE_UNCERTAIN_RETAIN_LEASE');
  let state='UNKNOWN';
  try{state=Inspector.inspectFixedNativeJournalState(id)}
  catch{state='UNKNOWN'}
  const decision=recoveryDecision(state);
  if(decision==='RETAIN_COMMIT_AND_LEASE')
   fail('COMMITTED_NO_ROLLBACK_MANUAL_ARCHIVE_REVIEW');
  if(decision==='RETAIN_ROLLBACK_AND_LEASE')
   fail('ROLLED_BACK_NO_REPLAY_RETAIN_LEASE');
  if(decision==='REQUIRE_MANUAL_ROOT_RECOVERY')
   fail('UNKNOWN_OUTCOME_NO_REPLAY_MANUAL_ROOT_RECOVERY');
  try{
   const rolled=Reconcile.reconcileFixedRootJournal(id,'rollback');
   need(rolled.ok===true&&rolled.state==='ROLLED_BACK'&&
    rolled.lease_retained===true,'rollback_unverified');
   need(Inspector.inspectFixedNativeJournalState(id)==='ROLLED_BACK',
    'rollback_record_not_durable');
   const archived=Archive.archiveFixedRootTerminalJournal(id);
   need(archived.archived===true&&archived.lock_preserved===true,
    'rollback_archive_unverified');
  }catch{fail('ROLLBACK_UNVERIFIED_RETAIN_LEASE_MANUAL_RECOVERY')}
  fail('L4_CONSUMED_ROLLBACK_VERIFIED_NO_REPLAY');
 }
}
module.exports=Object.freeze({
 recoveryDecision,runFixedRootSignedInstaller,
 ROOT_ACTION_REGISTERED:false,TRUSTED_SEALED_LOADER_INSTALLED:false,
 INDEPENDENT_SECURITY_APPROVAL_COMPLETE:false,
 SIGNED_LINUX_E2E_ATTESTED:false,PRODUCTION_EXECUTION_AUTHORIZED:false
});
