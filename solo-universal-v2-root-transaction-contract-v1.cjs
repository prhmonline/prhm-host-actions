'use strict';
/*
 * SOURCE-ONLY A04 root transaction CONTRACT. No CLI or root entrypoint.
 * The actual fixed-target Root adapter / signed installer must be reviewed,
 * pinned and installed independently. NEVER interpret this module as a live
 * Host Actions operation, nor as a replacement for owner-signed Level 4.
 */
const binding=require('./solo-universal-v2-host-action-binding-candidate-v1.cjs');
const permit=require('./solo-universal-v2-owner-permit-v1.cjs');
const PIN=binding.PIN;
const fail=c=>{throw Error('solo_universal_v2_root_contract_'+c)};
const FIXED=Object.freeze({
  schema:'prhm.universal.solo-v2.owner-root-transaction.v1',
  operation:binding.OPERATION,
  action:binding.ACTION,
  target_host:PIN.host,
  project:PIN.project,
  environment:PIN.environment,
  source_commit:PIN.deploy_control_source_commit,
  solo_release_sha:PIN.release_sha,
  solo_unit:PIN.solo_unit,
  solo_loopback:PIN.loopback,
  source_universal_bundle_sha:PIN.universal_v1_before,
  target_universal_bundle_sha:PIN.universal_v2_candidate,
  target_profile_sha:PIN.profile_sha256,
  universal_root:'/usr/local/libexec/deploy-control/universal',
  registration_file:'/etc/deploy-control/projects/solo_company.production.json',
  expected_unmodified_v1_profiles:6,
  one_time_use:true,
  max_grant_seconds:180,
  requires_root_owned_journal:true,
  requires_durable_rollback:true,
  signed_activation_required:true,
  runtime_restart:false,
  runtime_reinstall:false,
  runtime_state_mutation:false,
  public_listener:false,
  universal_controls_solo_deploy:false,
  universal_controls_solo_rollback:false
});
function exact(actual,expected){
  if(typeof actual!==typeof expected)return false;
  if(expected!==null&&typeof expected==='object'){
    if(!actual||typeof actual!=='object'||Array.isArray(actual)!==Array.isArray(expected))
      return false;
    const a=Object.keys(actual).sort(),e=Object.keys(expected).sort();
    return a.length===e.length&&a.every((k,i)=>k===e[i]&&exact(actual[k],expected[k]));
  }
  return actual===expected;
}
function verifyPlan(plan){
  if(!exact(plan,FIXED))fail('plan_not_pinned');
  return Object.freeze({plan_valid:true,production_authorized:false,
    operation:FIXED.operation,profile_sha256:FIXED.target_profile_sha});
}
const EXPECT_BEFORE=Object.freeze({
  schema:'prhm.universal.solo-v2.preflight.v1',
  host:PIN.host,
  installed_bundle_sha:PIN.universal_v1_before,
  installed_manifest_sha:'b11c7f601307b702f3c7380485851ecf9a23e15fd91c93b7796373f817a2a2a3',
  installed_v1_profiles:6,
  solo_release_sha:PIN.release_sha,
  solo_unit:PIN.solo_unit,
  solo_active:true,
  solo_enabled:true,
  solo_healthy:true,
  solo_only_private_loopback:true,
  solo_idle:true,
  solo_state_persistent:true,
  new_profile_absent:true,
  unfinished_root_transaction:false,
  candidate_sha:PIN.universal_v2_candidate,
  candidate_profile_sha:PIN.profile_sha256,
  signed_root_driver_installed:true,
  root_principal_verified:true
});
const EXPECT_AFTER=Object.freeze({
  schema:'prhm.universal.solo-v2.postflight.v1',
  host:PIN.host,
  installed_bundle_sha:PIN.universal_v2_candidate,
  original_v1_profiles_untouched:true,
  installed_v1_profiles:6,
  solo_profile_sha:PIN.profile_sha256,
  solo_observation:'READ_ONLY_OBSERVATION_PASS_NOT_MANAGED',
  solo_release_sha:PIN.release_sha,
  solo_active:true,
  solo_healthy:true,
  solo_unit_unchanged:true,
  solo_state_unchanged:true,
  no_solo_restart:true,
  no_db_migration:true,
  no_public_listener:true,
  no_deployment_authority:true,
  receipt_consumed_once:true
});
function verifyEvidence(snapshot,expected,label){
  if(!exact(snapshot,expected))fail('evidence_not_pinned_'+label);
  return true;
}
const REQUIRED_ADAPTER=Object.freeze([
  'readPinnedOwnerPublicKey','lockExclusive','capturePreflight',
  'durablyConsumePermit','journalBeforeMutation','stagePinnedBundle',
  'activateObserveOnly','capturePostflight','commitJournal',
  'rollbackFromJournal','recordFailClosed'
]);
function trustedAdapter(adapter){
  if(!adapter||typeof adapter!=='object'||
     REQUIRED_ADAPTER.some(k=>typeof adapter[k]!=='function'))
    fail('independent_signed_root_adapter_missing');
  return adapter;
}
/*
 * Requires separately installed and SHA-pinned Root adapter. The adapter owns
 * the actual immutable filesystem paths, symlink protections, fsync, journal,
 * one-use ledger, auth and recovery, and is NOT supplied by this source PR.
 * The caller cannot choose a unit/path/revision/profile.
 */
async function applySignedOwnerTransaction({plan=FIXED,token,requestId,nowSeconds,adapter}={}){
  verifyPlan(plan);
  trustedAdapter(adapter);
  const unlock=await adapter.lockExclusive(FIXED);
  if(typeof unlock!=='function')fail('lock_not_acquired');
  let journal=null,consumed=false;
  try{
    const before=await adapter.capturePreflight(FIXED);
    verifyEvidence(before,EXPECT_BEFORE,'before');
    const publicKeyPem=await adapter.readPinnedOwnerPublicKey();
    const signed=permit.verifyOwnerPermit({
      token,requestId,nowSeconds,publicKeyPem});
    if(signed.operation!==FIXED.operation||signed.signature_verified!==true||
       signed.production_authorized!==false||signed.consumed!==false)
      fail('permit_not_accepted');
    // IMPORTANT: adapter must persist the same JTI in immutable root-owned
    // ledger using O_EXCL + fsync BEFORE any root profile/bundle mutation.
    const receipt=await adapter.durablyConsumePermit(FIXED,signed);
    if(!receipt||receipt.operation!==FIXED.operation||
       receipt.request_id!==signed.request_id||
       receipt.jti!==signed.jti||
       receipt.consumed!==true||
       receipt.persisted!==true)
      fail('durable_consumption_unverified');
    consumed=true;
    // Backups/journal must be fsync'd before entering mutating phase.
    journal=await adapter.journalBeforeMutation(FIXED,receipt,before);
    if(!journal||journal.status!=='PREPARED'||
       journal.operation!==FIXED.operation||
       journal.durable!==true)fail('root_journal_not_durable');
    await adapter.stagePinnedBundle(FIXED,journal);
    await adapter.activateObserveOnly(FIXED,journal);
    const after=await adapter.capturePostflight(FIXED,journal);
    verifyEvidence(after,EXPECT_AFTER,'after');
    const committed=await adapter.commitJournal(FIXED,journal,after);
    if(committed?.status!=='COMMITTED'||committed?.durable!==true)
      fail('journal_commit_invalid');
    return Object.freeze({status:'COMMITTED',operation:FIXED.operation,
      source_only_contract:true,owner_grant_consumed:consumed,
      production_acceptance:true,managed_by_universal:false,
      solo_restart:false,solo_state_mutation:false});
  }catch(error){
    if(journal){
      try{
        const result=await adapter.rollbackFromJournal(FIXED,journal);
        if(result?.status!=='ROLLED_BACK'||result?.durable!==true||
           result?.solo_state_unchanged!==true)
          fail('rollback_incomplete');
        await adapter.recordFailClosed(FIXED,'ROLLBACK_COMPLETE');
      }catch(recoveryError){
        // No automatic replay of consumed owner grant; require manual incident.
        throw new AggregateError([error,recoveryError],
          'ROOT_RECOVERY_REQUIRED; permit stays consumed');
      }
    }
    if(consumed)await adapter.recordFailClosed(FIXED,'GRANT_CONSUMED_NO_RETRY');
    throw error;
  }finally{await unlock();}
}
module.exports=Object.freeze({FIXED,EXPECT_BEFORE,EXPECT_AFTER,
  verifyPlan,verifyEvidence,applySignedOwnerTransaction,REQUIRED_ADAPTER});
if(require.main===module){
  process.stderr.write('SOURCE_ONLY_NO_ROOT_EXECUTOR: signed owner-governed installation required\n');
  process.exitCode=64;
}
