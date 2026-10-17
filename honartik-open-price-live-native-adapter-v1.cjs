'use strict';
/**
 * Source-only, non-executable bridge from a ROOT-OWNED trusted Host Action
 * registration to the separately reviewed exact live DDL coordinator.
 *
 * This module never opens a database, spawns a command, accesses the network,
 * reads a credential, issues a token or changes a machine. Trusted server
 * methods must be independently implemented by the installed control plane.
 * Never construct "trusted" from a user request or arbitrary JSON payload.
 */
const {ACTION,OPERATION,PINS,makeCoordinator,Denied} =
  require('./honartik-open-price-live-ddl-coordinator-v1.cjs');
const METHODS=Object.freeze([
  'readExactLiveSchema','freezeFixedHonartikWriters',
  'verifyFixedHonartikWriterFreeze','verifyNewestRestoredBackup',
  'issuerConsumeExactLevel4','holdFixedMaintenance',
  'recheckFixedLivePreimage','runFixedReviewedMigrationClass',
  'auditCapacityAgainstLiveDatabase','auditFinalAgainstLiveDatabase',
  'appendSignedDurableAudit','resumeHonartikWritersAfterVerifiedMigration'
]);
const BRIDGE_ACTION='honartik_open_price_live_migrations_v1';
const CAPABILITY_SOURCE='trusted-root-installed-native-action';
const reject=(why)=>{throw new Denied('native_adapter_'+why)};
function createNativeAdapter(trusted) {
  if(!trusted || trusted.registeredNativeAction!==ACTION ||
     trusted.registeredOperation!==OPERATION ||
     trusted.capabilitySource!==CAPABILITY_SOURCE ||
     trusted.trustedRootOwned!==true ||
     trusted.signedIssuerAlgorithm!=='Ed25519' ||
     trusted.oneTimeApprovalEnforced!==true ||
     trusted.criticalLevel4PolicyEnforced!==true ||
     trusted.durableAuditRequired!==true ||
     METHODS.some(k=>typeof trusted[k]!=='function'))
       reject('not_registered_or_trust_capabilities_missing');

  const p=PINS;
  const sameMigration=(candidate,index)=>
    candidate===p.migrations[index] ||
    (candidate?.version===p.migrations[index].version &&
      candidate?.gitBlob===p.migrations[index].gitBlob &&
      candidate?.path===p.migrations[index].path);

  let approvalId=null;
  let maintenanceHeld=false;
  const adapter={
    async readOnlyPreflight(){
      return trusted.readExactLiveSchema(p);
    },
    async freezeWriters(){
      return trusted.freezeFixedHonartikWriters(p);
    },
    async verifyQuiescence(){
      return trusted.verifyFixedHonartikWriterFreeze(p);
    },
    async verifyBackupRestore(){
      // The trusted root action selects the latest complete backup and proves
      // a new isolated restore; no operator-supplied snapshot or dump path.
      return trusted.verifyNewestRestoredBackup(p);
    },
    async consumeSignedLevel4(_pins,proof){
      if(!proof || proof.database!==p.database ||
          !/^[a-f0-9]{64}$/.test(proof.dumpSha256||'') ||
          !/^20[0-9]{6}T[0-9]{6}Z$/.test(proof.snapshotId||''))
        reject('unverified_backup_for_signing');
      const signed=await trusted.issuerConsumeExactLevel4(Object.freeze({
        action:ACTION,operation:OPERATION,level:4,risk:'critical',
        sourceHead:p.productionHead,
        database:p.database,
        snapshotId:proof.snapshotId,dumpSha256:proof.dumpSha256,
        migrationBlobs:p.migrations.map(m=>m.gitBlob)
      }));
      if(signed?.consumedByIssuer===true && signed?.checkedByTrustedIssuer===true)
        approvalId=signed.requestId;
      return signed;
    },
    async holdMaintenance(_pins,receiptId){
      if(!approvalId || approvalId!==receiptId)reject('approval_not_consumed');
      const result=await trusted.holdFixedMaintenance(p,receiptId);
      if(result?.held===true && result.ownerSignedRequest===receiptId)
        maintenanceHeld=true;
      return result;
    },
    async recheckPreDDL(_pins,proof,receiptId){
      if(!maintenanceHeld || approvalId!==receiptId)
        reject('maintenance_or_issuer_missing');
      return trusted.recheckFixedLivePreimage(p,proof,receiptId);
    },
    async executeExactCapacity(migration,receiptId){
      if(!maintenanceHeld || approvalId!==receiptId || !sameMigration(migration,0))
        reject('capacity_scope_or_maintenance_mismatch');
      // The trusted executor must run only this reviewed pinned PHP class,
      // insert this one exact history version once, and enforce DB identity.
      return trusted.runFixedReviewedMigrationClass(p,0,receiptId);
    },
    async verifyCapacityCheckpoint(_pins,result){
      return trusted.auditCapacityAgainstLiveDatabase(p,result);
    },
    async executeExactFeatures(migration,receiptId){
      if(!maintenanceHeld || approvalId!==receiptId || !sameMigration(migration,1))
        reject('features_scope_or_maintenance_mismatch');
      return trusted.runFixedReviewedMigrationClass(p,1,receiptId);
    },
    async verifyFinalCheckpoint(_pins,result){
      return trusted.auditFinalAgainstLiveDatabase(p,result);
    },
    async writeDurableAudit(record){
      // The registered root operator owns the append-only audit destination.
      // The caller cannot select a path or supply an approval token here.
      return trusted.appendSignedDurableAudit(ACTION,OPERATION,record);
    },
    async releaseMaintenanceOnSuccess(_pins,receiptId){
      if(!maintenanceHeld || receiptId!==approvalId)
        reject('unsafe_resume_scope');
      return trusted.resumeHonartikWritersAfterVerifiedMigration(p,receiptId);
    }
  };
  return Object.freeze(adapter);
}
function makeRegisteredCoordinator(trusted) {
  return makeCoordinator(createNativeAdapter(trusted));
}
if(require.main===module){
  process.stderr.write('No CLI: must be registered by the separate trusted Level-4 root installer.\n');
  process.exitCode=2;
}
module.exports=Object.freeze({
  BRIDGE_ACTION,CAPABILITY_SOURCE,METHODS,createNativeAdapter,
  makeRegisteredCoordinator
});
