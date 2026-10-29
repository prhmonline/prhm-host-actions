'use strict';
/*
 * Fixed, source-only contract for the EXISTING Universal Installer.
 * Importing this file is read-only. This is not an Approval Center issuer,
 * a registered Host Action or a callable privileged installer. Only a
 * root-owned, independently verified adapter may supply the operations.
 *
 * IMPORTANT: do not treat a JavaScript callback, signed=true or a mocked
 * result as an approval. The native executor must independently verify
 * JWS Ed25519, original request identity, authoritative consumed ledger,
 * policy/source hashes, and a single-use durable replay fence.
 */
const FIXED=Object.freeze({
 action:'universal_installer_backup_only_upgrade_v1',
 operation:'host_action.universal_installer_backup_only_upgrade_v1',
 level:4,
 risk:'critical',
 project:'universal_installer',
 installation_prefix:'/usr/local/libexec/deploy-control/universal',
 interpreter:'/opt/prhm/universal-python/bin/python3',
 installed_bundle:'47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181',
 candidate_bundle:'77c3615ef73faae847008665b683fe2cf63191faca215f46724097051b6b2c29',
 archive_sha256:'c3655739d104721ec8866a3e3762982fe43efacf4d3645dcd58b0bfbe8f0f5ec',
 installed_backup_sha256:'6e8b8f65eec3638900f70059ccf7c265fe45010fadd98e0de45f5cdf1e6dcdea',
 candidate_backup_sha256:'70726bada23bac86f2aff85f1b8abf416d5aa2119d5638829387200d587b162f',
 source_count:28,
 changed_file:'universal/backup.py',
 allowed_functions:Object.freeze(['tree_fingerprint','create_backup','verify_restore']),
 approval_max_seconds:180,
 accepts_runtime_paths:false,
 production_registered:false,
});
const fail=m=>{throw new Error('universal_backup_only_'+m)};
const hex=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
function need(t,s){if(!t)fail(s)}
function exactKeys(x,fields){
 return x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===fields.slice().sort().join('|');
}
function attestBefore(x){
 const fields=['installed_bundle','manifest_digest','backup_sha256','current_pointer_verified',
 'root_ownership_verified','registered_profiles_valid','manifest_preimage_sha256'];
 need(exactKeys(x,fields),'untrusted_preimage_shape');
 need(x.installed_bundle===FIXED.installed_bundle&&
  x.manifest_digest===FIXED.installed_bundle&&
  x.backup_sha256===FIXED.installed_backup_sha256&&
  x.current_pointer_verified===true&&x.root_ownership_verified===true&&
  x.registered_profiles_valid===true&&hex(x.manifest_preimage_sha256),'preimage_drift');
 return x;
}
function attestSource(x){
 const fields=['bundle_digest','archive_sha256','backup_sha256','source_count',
 'changed_files','changed_functions','root_owned_immutable_staging','linux_restore_proven'];
 need(exactKeys(x,fields),'source_shape_invalid');
 need(x.bundle_digest===FIXED.candidate_bundle&&
  x.archive_sha256===FIXED.archive_sha256&&
  x.backup_sha256===FIXED.candidate_backup_sha256&&
  x.source_count===FIXED.source_count&&
  Array.isArray(x.changed_files)&&x.changed_files.length===1&&
  x.changed_files[0]===FIXED.changed_file&&
  Array.isArray(x.changed_functions)&&
  x.changed_functions.length===FIXED.allowed_functions.length&&
  x.changed_functions.every((f,i)=>f===FIXED.allowed_functions[i])&&
  x.root_owned_immutable_staging===true&&x.linux_restore_proven===true,
  'candidate_source_not_admitted');
 return x;
}
function attestReceipt(x){
 const f=['action','installed_bundle','candidate_bundle','approval_id',
 'level','risk','signature_verified_by_native_root','consumed_ledger_verified_by_native_root',
 'one_use_replay_fence_written','request_id_bound_to_original','age_seconds'];
 need(exactKeys(x,f),'receipt_shape_invalid');
 need(x.action===FIXED.action&&x.installed_bundle===FIXED.installed_bundle&&
  x.candidate_bundle===FIXED.candidate_bundle&&x.level===4&&
  x.risk==='critical'&&typeof x.approval_id==='string'&&x.approval_id.length>=12&&
  x.signature_verified_by_native_root===true&&
  x.consumed_ledger_verified_by_native_root===true&&
  x.one_use_replay_fence_written===true&&
  x.request_id_bound_to_original===true&&
  Number.isInteger(x.age_seconds)&&x.age_seconds>=0&&
  x.age_seconds<=FIXED.approval_max_seconds,'native_signed_l4_receipt_missing');
 return x;
}
function attestAfter(x,previousManifestHash){
 const f=['installed_bundle','manifest_digest','previous_digest','registered_profiles_valid',
 'backup_sha256','other_project_runtime_unchanged','database_unchanged',
 'application_release_unchanged','journal_durable'];
 need(exactKeys(x,f),'postimage_shape_invalid');
 need(x.installed_bundle===FIXED.candidate_bundle&&
  x.manifest_digest===FIXED.candidate_bundle&&
  x.previous_digest===FIXED.installed_bundle&&
  x.registered_profiles_valid===true&&
  x.backup_sha256===FIXED.candidate_backup_sha256&&
  x.other_project_runtime_unchanged===true&&
  x.database_unchanged===true&&
  x.application_release_unchanged===true&&x.journal_durable===true&&
  hex(previousManifestHash),'postimage_not_verified');
 return x;
}
const REQUIRED=Object.freeze(['exclusiveLock','readExactInstalledPreimage',
 'attestTrustedStagedSource','attestSignedLinuxRestore',
 'prepareDurableRollbackJournal','inspectDurableJournal',
 'consumeNativeSignedLevel4','installThroughExistingUniversal',
 'readExactPostimage','durableAudit','commitDurableJournal',
 'restoreExactPreimage','verifyExactRollback']);

/*
 * The native root owner must implement every capability; it MUST verify
 * authorization cryptographically BEFORE calling installThroughExistingUniversal.
 * No ability to pass paths, commands, digests or approval tokens from MCP.
 * This coordinator NEVER creates or signs Level-4 approvals.
 */
async function executeTrustedFixedAction(native){
 need(native&&typeof native==='object'&&
  REQUIRED.every(k=>typeof native[k]==='function'),'trusted_native_adapter_missing');
 let journal=null,attemptedJournal=false,prepared=false,approval=null;
 await native.exclusiveLock(FIXED);
 try{
  const before=attestBefore(await native.readExactInstalledPreimage(FIXED));
  attestSource(await native.attestTrustedStagedSource(FIXED));
  need(await native.attestSignedLinuxRestore(FIXED)===true,
   'signed_linux_rollback_missing');
  attemptedJournal=true;
  journal=await native.prepareDurableRollbackJournal(FIXED,before);
  need(journal&&typeof journal.id==='string'&&journal.id.length>=12,
   'recovery_journal_unproven');
  prepared=true;
  need(await native.inspectDurableJournal(FIXED,journal)==='PREPARED',
   'prepared_state_unverified');
  approval=attestReceipt(await native.consumeNativeSignedLevel4(FIXED,journal));
  await native.durableAudit({action:FIXED.action,event:'approval_consumed',
   journal_id:journal.id,approval_id:approval.approval_id});
  need(await native.installThroughExistingUniversal(FIXED,journal)===true,
   'existing_installer_failed');
  attestAfter(await native.readExactPostimage(FIXED,journal),
   before.manifest_preimage_sha256);
  await native.durableAudit({action:FIXED.action,event:'postimage_verified',
   journal_id:journal.id,approval_id:approval.approval_id,
   installed_bundle:FIXED.candidate_bundle});
  const commitReturned=await native.commitDurableJournal(FIXED,journal);
  need(commitReturned===true,'commit_ack_unverified');
  need(await native.inspectDurableJournal(FIXED,journal)==='COMMITTED',
   'committed_state_unverified');
  return Object.freeze({ok:true,installer_upgraded:true,
   installed_bundle:FIXED.candidate_bundle,application_deployed:false,
   journal_id:journal.id,approval_reusable:false});
 }catch(err){
  if(attemptedJournal&&!journal)fail('journal_creation_uncertain_preserve_lock');
  if(prepared){
   let state='UNKNOWN';
   try{state=await native.inspectDurableJournal(FIXED,journal)}catch{}
   if(state==='COMMITTED')fail('committed_outcome_preserve_lock_no_rollback');
   if(state!=='PREPARED')fail('unknown_outcome_preserve_lock_no_replay');
   try{
    need(await native.restoreExactPreimage(FIXED,journal)===true,
     'rollback_failed');
    need(await native.verifyExactRollback(FIXED,journal)===true,
     'rollback_unverified');
   }catch{fail('rollback_unverified_preserve_lock')}
   fail('rollback_verified_l4_not_reusable');
  }
  throw err;
 }
}
module.exports=Object.freeze({FIXED,attestBefore,attestSource,attestReceipt,
 attestAfter,executeTrustedFixedAction,PRODUCTION_EXECUTOR_REGISTERED:false,
 TRUSTED_ROOT_OF_TRUST_BOUND:false,SIGNED_L4_ISSUED:false});
