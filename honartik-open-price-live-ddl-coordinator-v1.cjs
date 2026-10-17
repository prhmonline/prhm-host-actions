'use strict';
/**
 * SOURCE-ONLY contract for a NEW trusted, Level-4 production DDL Host Action.
 *
 * No filesystem, SQL, shell, network, credential, signing or MCP APIs exist
 * here. It is never a direct production operator or permission grant.
 * Only a separately reviewed and installed root-owned adapter may supply
 * the fixed methods defined below (never from a caller's JSON).
 */
const ACTION='honartik_open_price_live_migrations_v1';
const OPERATION='host_action.honartik_open_price_live_migrations_v1';
const PINS=Object.freeze({
  action:ACTION,
  operation:OPERATION,
  risk:'critical',
  approvalLevel:4,
  host:'prhm-production',
  database:'honartik_db',
  historyTable:'system_db_migration',
  productionRoot:'/home/honartik/domains/dashboard.honartik.ir/public_html',
  productionHead:'502376d0360a338f9522e4a2be5f9dccc91408d7',
  sourceRepository:'prhmonline/honar-back-new',
  migrations:Object.freeze([
    Object.freeze({version:'m261016_105000_open_price_money_capacity',
      path:'app/migrations/db/m261016_105000_open_price_money_capacity.php',
      gitBlob:'453a4272d543cb622e041aa0248b7e3609d8650a'}),
    Object.freeze({version:'m261016_110000_open_price_schedules',
      path:'app/migrations/db/m261016_110000_open_price_schedules.php',
      gitBlob:'4601b591f18d99f7b1711ca089d9a6c24e780025'})
  ]),
  expectedPreimage:Object.freeze({
    moneyColumns:Object.freeze({
      'finance_transactions.amount':'int(11)',
      'finance_wallet.amount':'int(11)',
      'finance_transactions.paying_amount':'MISSING'
    }),
    featureColumnsPresent:0,
    targetHistoryCount:0
  }),
  maxBackupAgeSeconds:3600,
  minimumRestoreCounts:Object.freeze({
    finance_transactions:37195,
    finance_wallet:50603,
    reserve:36777
  }),
  protectedLocalPaths:Object.freeze([
    'app/views/admin-reserve/_form.php',
    'honartik-28000-refresh-905d3af8f914b0e4.xlsx'
  ]),
  publicFlagMustBeOff:true
});
const REQUIRED=Object.freeze([
  'readOnlyPreflight','freezeWriters','verifyQuiescence','verifyBackupRestore',
  'consumeSignedLevel4','holdMaintenance','executeExactCapacity',
  'verifyCapacityCheckpoint','executeExactFeatures','verifyFinalCheckpoint',
  'writeDurableAudit','releaseMaintenanceOnSuccess'
]);
class Denied extends Error {
  constructor(code){super('open_price_live_ddl_'+code);this.name='Denied';this.code=code;}
}
function deny(code){throw new Denied(code)}
function exact(o,keys){
  return !!o && Object.getPrototypeOf(o)===Object.prototype &&
    Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
}
function verifyStaticPins(){
  if(PINS.migrations.length!==2)deny('migration_count');
  if(PINS.productionHead.length!==40 || !/^[a-f0-9]{40}$/.test(PINS.productionHead))
    deny('invalid_production_preimage');
  if(PINS.migrations.some(x=>!/^[a-f0-9]{40}$/.test(x.gitBlob)))
    deny('unpinned_migration');
  if(PINS.operation!=='host_action.'+PINS.action || PINS.approvalLevel!==4)
    deny('incorrect_l4_scope');
  return true;
}
function verifyPreflight(p) {
  verifyStaticPins();
  if(!p || p.readOnly!==true || p.host!==PINS.host ||
    p.productionHead!==PINS.productionHead || p.database!==PINS.database ||
    p.historyTable!==PINS.historyTable ||
    p.migrationLookupExact!==true || p.noUnrelatedMigrationExecution!==true ||
    p.writerFreezeSupported!==true || p.protectedLocalFilesIntact!==true ||
    p.noCustomerNotifications!==true ||
    !exact(p.moneyColumns,Object.keys(PINS.expectedPreimage.moneyColumns)) ||
    Object.keys(PINS.expectedPreimage.moneyColumns).some(k=>
      p.moneyColumns[k]!==PINS.expectedPreimage.moneyColumns[k]) ||
    p.featureColumnsPresent!==0 || p.targetHistoryCount!==0 ||
    !Array.isArray(p.migrationBlobs) || p.migrationBlobs.length!==2 ||
    p.migrationBlobs.some((v,i)=>v!==PINS.migrations[i].gitBlob))
      deny('production_preimage_mismatch');
  return true;
}
function verifyFreeze(f) {
  if(!f || f.writersFrozen!==true || f.paymentCallbacksFrozen!==true ||
    f.maintenanceOwnerBound!==true || f.newReservationsBlocked!==true ||
    f.activeWritesDrained!==true || typeof f.lockId!=='string' ||
    !/^[a-zA-Z0-9._:-]{12,128}$/.test(f.lockId))
      deny('writers_not_quiescent');
  return true;
}
function verifyBackup(b) {
  if(!b || b.complete!==true || b.manifestVerified!==true ||
    b.gzipVerified!==true || b.actualRestorePassed!==true ||
    b.restoreIsolated===false || b.database!==PINS.database ||
    b.migrationClassesExecutedExactly===false ||
    b.beforeAfterFinanceIdentical!==true ||
    b.sameWindowLiveFinanceComparable!==true ||
    typeof b.ageSeconds!=='number' || !Number.isSafeInteger(b.ageSeconds) ||
    b.ageSeconds<0 || b.ageSeconds>PINS.maxBackupAgeSeconds ||
    typeof b.dumpSha256!=='string' || !/^[a-f0-9]{64}$/.test(b.dumpSha256) ||
    typeof b.snapshotId!=='string' || !/^20[0-9]{6}T[0-9]{6}Z$/.test(b.snapshotId) ||
    !b.rowCounts || Object.keys(PINS.minimumRestoreCounts).some(k=>
      !Number.isSafeInteger(b.rowCounts[k]) || b.rowCounts[k]<PINS.minimumRestoreCounts[k]) ||
    b.recoveryPlanIndependentlyVerified!==true)
      deny('backup_or_recovery_unverified');
  return true;
}
function verifyApproval(a,proof) {
  if(!a || a.checkedByTrustedIssuer!==true || a.consumedByIssuer===undefined ||
    a.consumedByIssuer!==true || a.oneTime!==true ||
    a.level!==4 || a.risk!=='critical' || a.operation!==OPERATION ||
    a.action!==ACTION || a.productionHead!==PINS.productionHead ||
    a.database!==PINS.database || a.snapshotId!==proof.snapshotId ||
    a.dumpSha256!==proof.dumpSha256 ||
    !Array.isArray(a.migrationBlobs) || a.migrationBlobs.length!==2 ||
    a.migrationBlobs.some((s,i)=>s!==PINS.migrations[i].gitBlob) ||
    typeof a.requestId!=='string' || !/^[0-9a-f-]{32,40}$/.test(a.requestId) ||
    a.expiresAtEpoch===undefined || !Number.isSafeInteger(a.expiresAtEpoch) ||
    a.consumedAtEpoch===undefined || !Number.isSafeInteger(a.consumedAtEpoch) ||
    a.consumedAtEpoch>a.expiresAtEpoch)
      deny('signed_scope_or_issuer_missing');
  return true;
}
function verifyCapacity(c){
  if(!c || c.success!==true ||
    c.version!==PINS.migrations[0].version ||
    c.gitBlob!==PINS.migrations[0].gitBlob ||
    c.moneyColumns?.['finance_transactions.amount']!=='bigint(20)' ||
    c.moneyColumns?.['finance_wallet.amount']!=='bigint(20)' ||
    c.moneyColumns?.['finance_transactions.paying_amount']!=='bigint(20)' ||
    c.payingAmountNullable!==true || c.historyRecordedExactlyOnce!==true ||
    c.featureColumnsPresent!==0 || c.financialInvariantUnchanged!==true ||
    c.writersRemainFrozen!==true)
      deny('capacity_checkpoint_failed');
  return true;
}
function verifyFinal(f) {
  if(!f || f.success!==true ||
    f.version!==PINS.migrations[1].version ||
    f.gitBlob!==PINS.migrations[1].gitBlob ||
    f.targetHistoryCount!==2 || f.featureColumnsPresent!==8 ||
    f.boolDefaultScheduleFalse!==true ||
    f.boolDefaultReserveFalse!==true ||
    f.allPublicOpenPriceFlagsOff!==true ||
    f.writersRemainFrozen!==true ||
    f.financialInvariantUnchanged!==true ||
    f.noUnrelatedMigrationExecuted!==true ||
    f.protectedLocalFilesIntact!==true)
       deny('final_checkpoint_failed');
  return true;
}
function makeCoordinator(trusted){
  if(!trusted || REQUIRED.some(n=>typeof trusted[n]!=='function'))
    deny('trusted_adapter_unavailable');
  let consumed=false;
  return Object.freeze({
    async execute(){
      if(consumed)deny('one_time_coordinator_reused');
      consumed=true;
      let phase='initial', receiptId=null, maintenanceHeld=false;
      let ddlStarted=false, success=false, outcome=null;
      try{
        const preflight=await trusted.readOnlyPreflight(PINS);
        verifyPreflight(preflight);
        phase='preimage_verified';
        verifyFreeze(await trusted.freezeWriters(PINS));
        verifyFreeze(await trusted.verifyQuiescence(PINS));
        phase='writers_quiescent';
        const proof=await trusted.verifyBackupRestore(PINS);
        verifyBackup(proof);
        phase='backup_restored_verified';
        const signed=await trusted.consumeSignedLevel4(PINS,proof);
        verifyApproval(signed,proof);
        receiptId=signed.requestId;
        phase='level4_consumed';
        const maintenance=await trusted.holdMaintenance(PINS,receiptId);
        if(!maintenance || maintenance.held!==true ||
          maintenance.ownerSignedRequest!==receiptId)
           deny('maintenance_hold_unproven');
        maintenanceHeld=true;
        phase='maintenance_held';
        // Critical: each mutation is an exact, non-generalized *trusted*
        // adapter method, never an arbitrary command or caller-selected SQL.
        ddlStarted=true;
        const capacity=await trusted.executeExactCapacity(PINS.migrations[0],receiptId);
        verifyCapacity(await trusted.verifyCapacityCheckpoint(PINS,capacity));
        phase='capacity_committed';
        const features=await trusted.executeExactFeatures(PINS.migrations[1],receiptId);
        verifyFinal(await trusted.verifyFinalCheckpoint(PINS,features));
        phase='features_committed';
        outcome={ok:true,action:ACTION,phase:'verified',
          requestId:receiptId,productionDatabaseChanged:true,
          publicFreePriceEnabled:false,applicationDeployed:false};
        success=true;
      }catch(e){
        outcome={ok:false,action:ACTION,phase,
          code:e?.code || 'trusted_adapter_exception',
          productionDatabaseMayBeModified:ddlStarted,
          maintenanceMustRemainHeld:ddlStarted || maintenanceHeld,
          manualFinancialRecoveryRequired:ddlStarted,
          applicationDeployed:false};
      }
      // This audit is mandatory even if a checkpoint failed. In particular,
      // NEVER automatically down-migrate/restore live financial history.
      try{
        const a=await trusted.writeDurableAudit(Object.freeze({
          action:ACTION,operation:OPERATION,requestId:receiptId,
          result:outcome,productionDDLStarted:ddlStarted}));
        if(!a || a.persisted!==true)
          deny('durable_audit_missing');
      }catch{
        throw new Denied('durable_audit_failed_manual_stop');
      }
      if(!success)throw new Denied(outcome.code || 'production_migration_held');
      // Migration verified. Releasing maintenance is a separate trust decision
      // and must not silently enable the public feature.
      const released=await trusted.releaseMaintenanceOnSuccess(PINS,receiptId);
      if(!released || released.writersSafelyResumed!==true ||
        released.openPricePublicFlagOff!==true)
        deny('safe_resume_not_proven');
      return Object.freeze(outcome);
    }
  });
}
if(require.main===module){
  process.stderr.write('Not a CLI. This source-only module cannot migrate Production or mint Level-4 approvals.\n');
  process.exitCode=2;
}
module.exports=Object.freeze({ACTION,OPERATION,PINS,REQUIRED,Denied,
  verifyStaticPins,verifyPreflight,verifyFreeze,verifyBackup,
  verifyApproval,verifyCapacity,verifyFinal,makeCoordinator});
