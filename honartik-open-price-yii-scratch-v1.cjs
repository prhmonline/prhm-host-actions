'use strict';
/**
 * Source-only contract for a *registered*, typed, signed Host Actions v2 operation.
 * This module NEVER executes a command, reads secrets, spawns a shell, touches the
 * deployment worktrees, or changes the production database. A trusted native
 * adapter must be installed separately after normal control-plane review.
 */
const PINS=Object.freeze({
  action:'honartik_open_price_yii_scratch_v1',
  approvalOperation:'host_action.honartik_open_price_yii_scratch_v1',
  sourceRepository:'prhmonline/honar-back-new',
  sourceSha:'4853dd39c43ca678b4bb29f00777c1b89c559757',
  sourcePath:'scripts/open-price-yii-isolated-restore-check.sh',
  sourceBlobSha:'83d30253d244e57320b3c539a8cde5f37c890ce4',
  snapshot:'/var/backups/prhm-central/20261016T212759Z/db/prhm-mariadb/honartik_db.sql.gz',
  manifest:'/var/backups/prhm-central/20261016T212759Z/SHA256SUMS',
  expectedDatabase:'honartik_db',
  expectedCounts:Object.freeze({
    finance_transactions:37156,finance_wallet:50543,reserve:36738
  }),
  dbImage:'mariadb:10.6',
  network:'none',
  prodBackendHead:'502376d0360a338f9522e4a2be5f9dccc91408d7'
});
const sha=/^[a-f0-9]{40}$/;
class GateError extends Error {
  constructor(code){super(code);this.code=code;this.name='GateError';}
}
const deny=(code)=>{throw new GateError(code);};
function verifyPins(){
  for(const v of [PINS.sourceSha,PINS.sourceBlobSha,PINS.prodBackendHead])
    if(!sha.test(v))deny('invalid_fixed_source_sha');
  if(PINS.network!=='none'||PINS.dbImage!=='mariadb:10.6')deny('isolation_contract_invalid');
  return true;
}
function verifyPreflight(e) {
  verifyPins();
  if(!e || e.readOnly!==true || e.sourceCommit===undefined ||
    e.sourceCommit!==PINS.sourceSha || e.sourceBlobSha!==PINS.sourceBlobSha ||
    e.currentBackendHead!==PINS.prodBackendHead ||
    e.snapshotPath!==PINS.snapshot || e.manifestPath!==PINS.manifest ||
    e.snapshotSha256Verified!==true || e.snapshotRestorable!==true ||
    e.networkMode!=='none' || e.image!=='mariadb:10.6' ||
    e.productionDbSocketMounted!==false || e.productionDbCredentialsMounted!==false ||
    e.separateScratchDatadir!==true ||
    e.scrubbedScratchCredentials!==true || e.liveDatabaseWritePermission!==false ||
    e.scratchSourceOnly!==true ||
    e.resourcePreflightPassed!==true)
     deny('isolated_preflight_not_proven');
  return true;
}
function verifyApproval(a){
  if(!a || a.consumedByTrustedControlPlane!==true || a.oneTime!==true ||
    a.operation!==PINS.approvalOperation || a.sourceSha!==PINS.sourceSha ||
    a.sourceBlobSha!==PINS.sourceBlobSha || typeof a.receiptId!=='string' ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(a.receiptId))
    deny('one_time_signed_approval_missing');
  return true;
}
function verifyResult(r){
  if(!r || r.ok!==true || r.readOnlyProduction!==true ||
      r.executionSourceCommit!==PINS.sourceSha ||
      r.executionSourceBlobSha!==PINS.sourceBlobSha ||
      r.testedDatabase!==PINS.expectedDatabase ||
      !/^10\.6\.[0-9]+/.test(r.mariadbVersion||'') ||
      r.networkMode!=='none' ||
      r.snapshotManifestVerified!==true ||
      r.snapshotRestoredComplete!==true ||
      r.actualYiiClassesExecuted!==true ||
      r.yiiCapacityPassed!==true || r.yiiFeaturesPassed!==true ||
      r.payingAmountBigintVerified!==true ||
      r.allEightFeatureColumnsVerified!==true ||
      r.financialCountAndSumsUnchanged!==true ||
      r.capacityRetryIdempotentBeforeFeatures!==true ||
      r.capacityPostFeaturesFailClosed!==true ||
      r.featureDuplicateFailClosed!==true ||
      r.productionDatabaseUntouched!==true ||
      r.productionApplicationUnchanged!==true)
    deny('actual_restored_yii_rehearsal_unproven');
  for(const [table,expected] of Object.entries(PINS.expectedCounts)){
    if(!r.rowCounts || r.rowCounts[table]!==expected)deny('restored_snapshot_rowcount_mismatch');
  }
  return true;
}
function makeCoordinator(ops){
  const names=['preflight','consumeApproval','executeRestoredYiiRehearsal','cleanup','audit'];
  if(!ops||names.some(n=>typeof ops[n]!=='function'))deny('trusted_native_adapter_incomplete');
  let used=false;
  return Object.freeze({
    async execute(){
      if(used)deny('coordinator_reuse_forbidden');
      used=true;
      let success=false, cleanupOK=false, phase='starting', cause=null;
      try{
        verifyPreflight(await ops.preflight(PINS));
        phase='preflight_ok';
        verifyApproval(await ops.consumeApproval(PINS.approvalOperation,PINS));
        phase='signed_approved';
        const result=await ops.executeRestoredYiiRehearsal(PINS);
        verifyResult(result);
        phase='verified';
        success=true;
      }catch(e){
        cause=e;
      }finally{
        // Even when preflight or execution fails, a cleanup receipt is mandatory.
        try{
          const c=await ops.cleanup(PINS);
          cleanupOK=!!c && c.scratchRemoved===true && c.disposableContainerRemoved===true &&
            c.liveApplicationUnchanged===true && c.liveDatabaseUnchanged===true;
        }catch{}
        if(!cleanupOK){success=false;cause=new GateError('scratch_cleanup_unverified');}
        try{
          await ops.audit({action:PINS.action,sourceSha:PINS.sourceSha,
            phase:success?'verified':phase,success,cleanupOK,
            reason:success?null:(cause?.code||'trusted_operation_failed')});
        }catch{
          success=false;cause=new GateError('durable_audit_unverified');
        }
      }
      if(!success)throw cause||new GateError('isolated_migration_rehearsal_failed');
      return {ok:true,productionChanged:false,scope:'restored-backup-only',
        sourceSha:PINS.sourceSha,receipt:'trusted_audit_written'};
    }
  });
}
if(require.main===module){
  // No direct execution path; only registered/approved native Host Action calls.
  process.stdout.write(JSON.stringify({ok:false,action:PINS.action,
    reason:'typed_signed_host_action_registration_required',productionChanged:false})+'\n');
  process.exitCode=2;
}
module.exports={PINS,GateError,verifyPins,verifyPreflight,verifyApproval,verifyResult,makeCoordinator};
