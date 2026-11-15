'use strict';
/**
 * Bounded U06 owner-approved transaction coordinator.
 *
 * NO CLI, no built-in DB/SSH/fs writes other than the separate one-use
 * evidence fence, no privileged service entrypoint, no universal deploy.
 *
 * This coordinator is NOT an installed Root executor. A real native adapter
 * must be independently approved, pinned, installed and host-bound before any
 * production operation; mock adapters in tests have ZERO authority.
 */
const owner=require('./honartik-u06-owner-oidc-identity-gate-v1.cjs');
const fence=require('./honartik-u06-owner-oidc-once-fence-v1.cjs');
const F=Object.freeze({
  operation:owner.INTENT.operation,
  host:owner.INTENT.host,
  project:owner.INTENT.project,
  database:'honartik_db',
  account:'honartik_universal_backup',
  account_host:'127.0.0.1',
  grants:Object.freeze(['SELECT','SHOW VIEW','TRIGGER','EVENT']),
  adapter_sha256:owner.INTENT.adapter_sha256,
  profile_sha256_before:owner.INTENT.profile_sha256,
  // Owner-confirmed LIVE read-only candidate from 2026-11-11; this MUST
  // match the installed Root-reviewed policy after separate authorization.
  // Source pinning is not evidence of installation or signature consumption.
  reviewed_l4_policy_sha256:'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934',
  require_offsite:true,
  auto_deploy:false,
  yii_migrations:false,
  apache_cutover:false
});
const REQUIRED=Object.freeze([
  'exclusiveU06Lock',
  'readExactPreimage',
  'verifyIndependentNode1Recovery',
  'prepareDurableRollbackJournal',
  'assertRollbackJournalDurable',
  // Separate trusted Root operations. The verifier MUST independently read
  // the official Ed25519 issuer key + consumed ledger + SHA-pinned live
  // Level-4 policy, and the replay fence MUST be fsynced before MySQL writes.
  'verifyNativeConsumedSignedLevel4',
  'reserveNativeLevel4ReplayFence',
  'provisionBackupOnlyIdentityAndPrivateCredential',
  'runInstalledUniversalNativeBackup',
  'verifyIsolatedRestoreAndFinancialIntegrity',
  'enableRequiredOffsiteWithRollback',
  'verifyExactPostflight',
  'commitDurableJournal',
  'rollbackExactPreimage',
  'verifyExactRollback',
  'releaseU06Lock'
]);
const fail=m=>{throw new Error('prhm_u06_native_owner_'+m)};
const need=(x,m)=>{if(!x)fail(m)};
function checkPreimage(v){
  need(v&&Object.keys(v).sort().join('|')===
    ['host','project','adapter_sha256','profile_sha256','native_credential_absent',
      'offsite_required_before','database','provider_dependency_removed'].sort().join('|'),
    'untrusted_preimage_shape');
  need(v.host===F.host&&v.project===F.project&&v.database===F.database&&
    v.adapter_sha256===F.adapter_sha256&&
    v.profile_sha256===F.profile_sha256_before&&
    v.native_credential_absent===true&&
    v.offsite_required_before===false&&
    v.provider_dependency_removed===true,
    'production_preimage_drift');
  return v;
}
function checkPostflight(v){
  need(v&&Object.keys(v).sort().join('|')===
    ['native_backup_sha256','actual_native_functions_executed',
     'restored_tables','restored_fk_count','finance_counts_and_amounts_unchanged',
     'wallet_and_reserve_integrity_verified','full_mysqlcheck_pass',
     'offsite_required_true','offsite_remote_evidence_fresh',
     'credential_file_private','root_journal_durable',
     'production_application_unchanged','yii_migrations_unchanged'].sort().join('|'),
    'untrusted_postflight_shape');
  need(typeof v.native_backup_sha256==='string'&&/^[0-9a-f]{64}$/.test(v.native_backup_sha256)&&
    v.actual_native_functions_executed===true&&
    Number.isInteger(v.restored_tables)&&v.restored_tables>=69&&
    Number.isInteger(v.restored_fk_count)&&v.restored_fk_count>=49&&
    v.finance_counts_and_amounts_unchanged===true&&
    v.wallet_and_reserve_integrity_verified===true&&
    v.full_mysqlcheck_pass===true&&
    v.offsite_required_true===true&&v.offsite_remote_evidence_fresh===true&&
    v.credential_file_private===true&&v.root_journal_durable===true&&
    v.production_application_unchanged===true&&v.yii_migrations_unchanged===true,
    'native_backup_postflight_not_proven');
  return v;
}
async function coordinateOwnerU06(native,proof,{ledgerDir=fence.LEDGER,ledgerOwnerUid=0,sharedBinding=null}={}){
  need(owner.proofVerifiedInCurrentProcess(proof),'owner_identity_not_cryptographically_verified');
  need(proof.intent_digest===owner.intentDigest()&&
    proof.backend_deploy_authorized===false&&
    proof.approval_to_modify_production===false,'owner_proof_scope_invalid');
  need(native&&typeof native==='object'&&
    REQUIRED.every(k=>typeof native[k]==='function'),
    'trusted_fixed_native_adapter_not_supplied');
  let locked=false,journal=null,mutationAttempted=false,committed=false,post=null;
  let journalPrepareStarted=false,journalDurable=false,commitAttempted=false,retainRecoveryLease=false;
  try{
    await native.exclusiveU06Lock(F);locked=true;
    const pre=checkPreimage(await native.readExactPreimage(F));
    need(await native.verifyIndependentNode1Recovery(F,pre)===true,
      'remote_offsite_recovery_not_verified');
    // From this point, a failed/partial write may exist even if the call
    // throws before returning a journal ID. Never silently free the lease.
    journalPrepareStarted=true;
    journal=await native.prepareDurableRollbackJournal(F,pre);
    need(journal&&typeof journal.id==='string'&&
      /^[a-z0-9_-]{12,100}$/i.test(journal.id),'journal_not_created');
    need(await native.assertRollbackJournalDurable(F,journal)===true,
      'journal_not_durable');
    journalDurable=true;
    // Source-level coordinator cannot authenticate callback provenance.
    // The only future eligible live binding is a trusted exact-source Root
    // adapter which independently verifies the signed Level-4 receipt and
    // authoritative consumed ledger, then persists the no-replay fence.
    // GitHub OIDC identity alone MUST NEVER authorize production mutation.
    const approval=await native.verifyNativeConsumedSignedLevel4(F,journal);
    const expectedL4Operation='host_action.honartik_u06_native_backup_register_v1';
    need(approval&&Object.keys(approval).sort().join('|')===
      ['operation','level','signature_verified','consumed_ledger_verified',
       'policy_sha256','request_id','approval_id'].sort().join('|')&&
      approval.operation===expectedL4Operation&&approval.level===4&&
      approval.signature_verified===true&&
      approval.consumed_ledger_verified===true&&
      approval.policy_sha256===F.reviewed_l4_policy_sha256&&
      /^[0-9a-f-]{36}$/i.test(approval.approval_id)&&
      /^[0-9a-f-]{36}$/i.test(approval.request_id),
      'native_l4_receipt_missing_or_invalid');
    need(await native.reserveNativeLevel4ReplayFence(F,journal,approval)===true,
      'native_l4_replay_fence_not_durable');
    // Both independent L4 and owner OIDC one-use proofs MUST be burned
    // before the first MySQL/account/credential operation. Failure burns
    // whichever proof was already consumed, never silently refunds it.
    fence.consumeVerifiedOwnerEvidence(proof,{
      directory:ledgerDir,trustedUid:ledgerOwnerUid,sharedBinding
    });
    mutationAttempted=true;
    await native.provisionBackupOnlyIdentityAndPrivateCredential(F,journal);
    await native.runInstalledUniversalNativeBackup(F,journal);
    await native.verifyIsolatedRestoreAndFinancialIntegrity(F,journal);
    await native.enableRequiredOffsiteWithRollback(F,journal);
    post=checkPostflight(await native.verifyExactPostflight(F,journal));
    // Commit might have reached disk before the function throws or falsely
    // returns. Rollback on an ambiguous commit could corrupt a good backup.
    commitAttempted=true;
    need(await native.commitDurableJournal(F,journal,post)===true,
      'journal_commit_unverified');
    committed=true;
  }catch(error){
    if(commitAttempted||journalPrepareStarted&&!journalDurable){
      // A commit could already be durable, or a journal write could be
      // incomplete; neither may be safely rolled back from a guess.
      retainRecoveryLease=true;
      const reason=commitAttempted?
        'CRITICAL_COMMIT_OUTCOME_UNKNOWN_LEASE_RETAINED':
        'CRITICAL_PREPARE_OUTCOME_UNKNOWN_LEASE_RETAINED';
      const err=new Error('prhm_u06_native_owner_'+reason);
      err.cause=error;
      throw err;
    }
    if(journal&&journalDurable&&!committed){
      // Even if approval consumption failed/replayed, close the durable
      // prepared journal via verified exact rollback before unlocking.
      try{
        await native.rollbackExactPreimage(F,journal);
        need(await native.verifyExactRollback(F,journal)===true,
          'rollback_not_verified');
      }catch(rollbackFailure){
        retainRecoveryLease=true;
        const err=new Error('prhm_u06_native_owner_CRITICAL_RECOVERY_JOURNAL_RETAINED');
        err.cause=rollbackFailure;throw err;
      }
    }
    throw error;
  }finally{
    // Release is safe after verified commit, verified rollback or a
    // pre-journal rejection ONLY. A failed rollback retains the file lease.
    if(locked&&!retainRecoveryLease)await native.releaseU06Lock(F);
  }
  // This return value is a coordinator-level proof only; a local *test* can
  // simulate native callbacks. Real release admission requires independent
  // installed Root binding plus verified host receipts outside this library.
  return Object.freeze({
    operation:F.operation,
    coordinator_completed:true,
    source_only_callback_contract:true,
    installed_root_binding_proven:false,
    backend_deployment_authorized:false,
    verified_native_postflight:post
  });
}
module.exports=Object.freeze({
  F,REQUIRED,checkPreimage,checkPostflight,coordinateOwnerU06,
  INSTALLED_ROOT_BINDING:false,AUTO_DEPLOY:false
});
