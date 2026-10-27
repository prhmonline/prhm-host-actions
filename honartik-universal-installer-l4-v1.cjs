'use strict';
/**
 * Issue #217: source-only, fixed-scope contract for a FUTURE trusted Host Action.
 *
 * This is not an installed action, root adapter, approval issuer or CLI. Only
 * an independently reviewed, root-owned native adapter may supply capabilities.
 * In particular, a mock returning {signed:true} is NEVER authorization.
 */
const fail=(reason)=>{throw new Error('honartik_universal_l4_'+reason)};
const HEX=/^[a-f0-9]{64}$/;
const ACTION='honartik_universal_installer_upgrade_v1';
const CONTRACT=Object.freeze({
  schema:'prhm.honartik-universal-installer-upgrade.v1',
  action:ACTION,
  operation:'host_action.'+ACTION,
  risk:'critical',level:4,one_time:true,environment:'production',
  project:'honartik_back.production',site:'dashboard.honartik.ir',
  approval:'trusted_approval_center_ed25519_one_time',
  source_repository:'prhmonline/prhm-host-actions',
  installer_prefix:'/usr/local/libexec/deploy-control/universal',
  interpreter:'/opt/prhm/universal-python/bin/python3',
  existing_digest:'47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181',
  candidate_digest:'8680011e11ad8eae89707b74492e60354c4b7e56799b205d3da581e92806a552',
  target_backend_sha:'0cdfb3d03caf143f665b20b463971e3e4f9b51c9',
  registry_digest:'5090ad2dce3d41f4c7bbb8c5b4d9879554474fb2e39a158a3b55d0da749620f8',
  max_approval_age_seconds:180,
  installer_only:true,
  no_yii_migrations:true,
  no_application_deploy:true,
  no_live_apache_or_database_write:true,
});
const METHODS=Object.freeze([
  'acquireRootOwnedInstallerLock','attestInstalledPreimage',
  'attestImmutableCandidate','attestIndependentLinuxTests',
  'createDurableRecoveryJournal','attestJournalRecoverable',
  'consumeSignedOneTimeL4Approval','installFixedBundleTransaction',
  'attestInstalledPostimage','commitJournal','inspectDurableJournalState',
  'restoreExactJournal',
  'attestExactRollback','durableAudit','releaseInstallerLock'
]);
function trustedHost(host) {
  if(!host||typeof host!=='object'||Array.isArray(host)||
     METHODS.some(k=>typeof host[k]!=='function'))fail('trusted_host_adapter_missing');
  return host;
}
function exactKeys(obj,fields) {
  return obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join('|')===fields.slice().sort().join('|');
}
function isDigest(s){return typeof s==='string'&&HEX.test(s)}
function attestPreimage(p){
  const keys=['installed_digest','actual_bundle_digest','manifest_digest',
    'manifest_previous','manifest_entrypoint','registered_config_digest',
    'http_sha256','https_sha256','root_ownership_verified','no_symlinks',
    'other_registry_projects_valid'];
  if(!exactKeys(p,keys)||p.installed_digest!==CONTRACT.existing_digest||
     p.actual_bundle_digest!==CONTRACT.existing_digest||
     p.manifest_digest!==CONTRACT.existing_digest||
     p.manifest_entrypoint!==CONTRACT.installer_prefix+'/deploy-project'||
     p.registered_config_digest!==CONTRACT.registry_digest||
     !isDigest(p.http_sha256)||!isDigest(p.https_sha256)||
     p.root_ownership_verified!==true||p.no_symlinks!==true||
     p.other_registry_projects_valid!==true)
    fail('installed_preimage_drift');
  // previous can be the manifest's recorded predecessor; it cannot substitute
  // for the verified current digest.
  if(p.manifest_previous!==null&&!isDigest(p.manifest_previous))
    fail('manifest_previous_invalid');
  return p;
}
function attestCandidate(c){
  const keys=['bundle_digest','root_owned_read_only','no_symlinks',
    'python_ast_syntax_ok','source_closure_attested'];
  if(!exactKeys(c,keys)||c.bundle_digest!==CONTRACT.candidate_digest||
     c.root_owned_read_only!==true||c.no_symlinks!==true||
     c.python_ast_syntax_ok!==true||c.source_closure_attested!==true)
    fail('candidate_not_attested');
  return c;
}
function attestTests(t){
  const keys=['candidate_digest','trusted_linux_attestation','tests_total',
    'tests_passed','interrupted_rollback_verified','negative_tests_verified',
    'attestation_digest','production_mutated'];
  if(!exactKeys(t,keys)||t.candidate_digest!==CONTRACT.candidate_digest||
     t.trusted_linux_attestation!==true||t.tests_total<1||
     !Number.isInteger(t.tests_total)||t.tests_passed!==t.tests_total||
     t.interrupted_rollback_verified!==true||t.negative_tests_verified!==true||
     !isDigest(t.attestation_digest)||t.production_mutated!==false)
    fail('trusted_linux_evidence_missing');
  // The native root adapter MUST verify the signature and artifact provenance;
  // checking a boolean here is a defense in depth, not a trust boundary.
  return t;
}
function attestApproval(r){
  const keys=['action','operation','level','risk','candidate_digest',
    'existing_digest','backend_sha','approval_id','issuer_verified',
    'signature_verified','consumed_once','age_seconds'];
  if(!exactKeys(r,keys)||r.action!==ACTION||r.operation!==CONTRACT.operation||
     r.level!==4||r.risk!=='critical'||r.candidate_digest!==CONTRACT.candidate_digest||
     r.existing_digest!==CONTRACT.existing_digest||
     r.backend_sha!==CONTRACT.target_backend_sha||
     typeof r.approval_id!=='string'||r.approval_id.length<12||
     r.issuer_verified!==true||r.signature_verified!==true||
     r.consumed_once!==true||!Number.isFinite(r.age_seconds)||
     r.age_seconds<0||r.age_seconds>CONTRACT.max_approval_age_seconds)
    fail('signed_exact_l4_required');
  return r;
}
function attestPostimage(p,before){
  const keys=['installed_digest','actual_bundle_digest','previous_digest',
    'manifest_digest','registry_digest','cli_validation',
    'other_registry_projects_valid','http_sha256','https_sha256',
    'live_database_untouched','yii_migrations_executed',
    'application_deployed','journal_durable'];
  if(!exactKeys(p,keys)||p.installed_digest!==CONTRACT.candidate_digest||
     p.actual_bundle_digest!==CONTRACT.candidate_digest||
     p.manifest_digest!==CONTRACT.candidate_digest||
     p.previous_digest!==CONTRACT.existing_digest||
     p.registry_digest!==CONTRACT.registry_digest||
     p.cli_validation!==true||p.other_registry_projects_valid!==true||
     p.http_sha256!==before.http_sha256||p.https_sha256!==before.https_sha256||
     p.live_database_untouched!==true||p.yii_migrations_executed!==false||
     p.application_deployed!==false||p.journal_durable!==true)
    fail('installed_postimage_incomplete');
  return p;
}
function noRuntimeArguments(argv){
  if(!Array.isArray(argv)||argv.length!==0)fail('runtime_arguments_forbidden');
  return Object.freeze({action:ACTION,source_only:true,registered:false,may_install:false});
}
async function applyFixedInstallerUpgrade(host){
  // This coordinator has NO external command/path/digest/token parameters.
  // ONLY a root-owned Host Actions binding may call it with real capabilities.
  const h=trustedHost(host);
  let lease=null,journal=null,rollbackVerified=true,post=null;
  let commitAttempted=false;
  try{
    lease=await h.acquireRootOwnedInstallerLock(CONTRACT);
    if(!lease||typeof lease.id!=='string'||lease.id.length<8)
      fail('durable_exclusive_lock_missing');
    const before=attestPreimage(await h.attestInstalledPreimage(CONTRACT));
    attestCandidate(await h.attestImmutableCandidate(CONTRACT));
    attestTests(await h.attestIndependentLinuxTests(CONTRACT));
    journal=await h.createDurableRecoveryJournal(CONTRACT,lease,before);
    if(!journal||typeof journal.id!=='string'||journal.id.length<8||
       await h.attestJournalRecoverable(CONTRACT,journal)!==true)
      fail('prewrite_recovery_unproven');
    const receipt=attestApproval(await h.consumeSignedOneTimeL4Approval(CONTRACT,journal));
    await h.durableAudit({action:ACTION,event:'authorized',journal_id:journal.id,
      approval_id:receipt.approval_id});
    const installed=await h.installFixedBundleTransaction(CONTRACT,journal);
    if(installed!==true)fail('fixed_installer_transaction_failed');
    post=attestPostimage(await h.attestInstalledPostimage(CONTRACT,journal),before);
    // Audit while the rollback journal is still recoverable. A post-commit
    // audit failure must never attempt to restore a finalized journal.
    await h.durableAudit({action:ACTION,event:'precommit_verified',journal_id:journal.id,
      approval_id:receipt.approval_id,new_digest:CONTRACT.candidate_digest});
    // The trusted native adapter must atomically finalize the audit+commit
    // state and preserve recovery on any uncertain result.
    commitAttempted=true;
    if(await h.commitJournal(CONTRACT,journal)!==true)fail('durable_commit_failed');
    return Object.freeze({ok:true,installer_upgraded:true,
      backend_deployed:false,yii_migrations_executed:false,
      previous_digest:CONTRACT.existing_digest,
      installed_digest:CONTRACT.candidate_digest});
  }catch(error){
    if(journal&&commitAttempted){
      // A failed/absent commit response is NOT evidence the journal remains
      // PREPARED. A durable COMMITTED marker must never be rolled back.
      // Only the preinstalled root-owned journal inspector may authorize
      // rollback on a byte-verified, still-PREPARED transaction.
      let durableState='UNKNOWN';
      try{durableState=await h.inspectDurableJournalState(CONTRACT,journal)}
      catch{durableState='UNKNOWN'}
      if(durableState!=='PREPARED'){
        rollbackVerified=false; // preserve exclusive recovery fence
        fail('COMMIT_OUTCOME_UNCERTAIN_manual_reconciliation_required');
      }
    }
    if(journal){
      try {
        if(await h.restoreExactJournal(CONTRACT,journal)!==true||
           await h.attestExactRollback(CONTRACT,journal)!==true)
          rollbackVerified=false;
        else await h.durableAudit({action:ACTION,event:'rollback_verified',
          journal_id:journal.id,reason:String(error?.message||error).slice(0,120)});
      }catch{rollbackVerified=false}
    }
    if(!rollbackVerified)fail('ROLLBACK_UNVERIFIED_manual_recovery_required');
    fail('denied_or_rolled_back');
  }finally{
    // On unverified recovery the root executor MUST keep the lock/journal
    // owned by recovery service: never release a potentially unsafe cutover.
    if(lease&&rollbackVerified){
      if(await h.releaseInstallerLock(CONTRACT,lease)!==true)
        fail('release_lock_failed_manual_inspection_required');
    }
  }
}
module.exports=Object.freeze({ACTION,CONTRACT,METHODS,noRuntimeArguments,
  attestPreimage,attestCandidate,attestTests,attestApproval,attestPostimage,
  applyFixedInstallerUpgrade});
