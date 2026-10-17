'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {spawnSync}=require('node:child_process');
const m=require('./honartik-open-price-live-ddl-coordinator-v1.cjs');
const {ACTION,OPERATION,PINS,Denied,makeCoordinator}=m;
function base(){
 return {
  readOnly:true,host:PINS.host,productionHead:PINS.productionHead,
  database:PINS.database,historyTable:PINS.historyTable,
  migrationLookupExact:true,noUnrelatedMigrationExecution:true,
  writerFreezeSupported:true,protectedLocalFilesIntact:true,
  noCustomerNotifications:true,
  moneyColumns:{...PINS.expectedPreimage.moneyColumns},
  featureColumnsPresent:0,targetHistoryCount:0,
  migrationBlobs:PINS.migrations.map(z=>z.gitBlob)
 };
}
function frozen(){
 return {writersFrozen:true,paymentCallbacksFrozen:true,
  maintenanceOwnerBound:true,newReservationsBlocked:true,
  activeWritesDrained:true,lockId:'held-migration-lock-123'};
}
function backup(){
 return {complete:true,manifestVerified:true,gzipVerified:true,
  actualRestorePassed:true,restoreIsolated:true,
  database:PINS.database,migrationClassesExecutedExactly:true,
  beforeAfterFinanceIdentical:true,sameWindowLiveFinanceComparable:true,
  ageSeconds:124,snapshotId:'20261017T212022Z',
  dumpSha256:'74777c7e559c55f8ed651bbbd53e93a4610a6c00804e006cbb40497b03e33fb6',
  rowCounts:{...PINS.minimumRestoreCounts},
  recoveryPlanIndependentlyVerified:true};
}
function approval(b){
 return {checkedByTrustedIssuer:true,consumedByIssuer:true,
  oneTime:true,level:4,risk:'critical',operation:OPERATION,action:ACTION,
  productionHead:PINS.productionHead,database:PINS.database,
  snapshotId:b.snapshotId,dumpSha256:b.dumpSha256,
  migrationBlobs:PINS.migrations.map(z=>z.gitBlob),
  requestId:'d432784a-a4cf-4672-9a73-a71825145f95',
  expiresAtEpoch:1792282200,consumedAtEpoch:1792282120};
}
function capacity(){
 return {success:true,version:PINS.migrations[0].version,
  gitBlob:PINS.migrations[0].gitBlob,
  moneyColumns:{'finance_transactions.amount':'bigint(20)',
    'finance_wallet.amount':'bigint(20)',
    'finance_transactions.paying_amount':'bigint(20)'},
  payingAmountNullable:true,historyRecordedExactlyOnce:true,
  featureColumnsPresent:0,financialInvariantUnchanged:true,
  writersRemainFrozen:true};
}
function complete(){
 return {success:true,version:PINS.migrations[1].version,
  gitBlob:PINS.migrations[1].gitBlob,targetHistoryCount:2,
  featureColumnsPresent:8,boolDefaultScheduleFalse:true,
  boolDefaultReserveFalse:true,allPublicOpenPriceFlagsOff:true,
  writersRemainFrozen:true,financialInvariantUnchanged:true,
  noUnrelatedMigrationExecuted:true,protectedLocalFilesIntact:true};
}
function fixture(overrides={}){
 const events=[];
 const adapter={
  readOnlyPreflight:async()=>{events.push('preflight');return base();},
  freezeWriters:async()=>{events.push('freeze');return frozen();},
  verifyQuiescence:async()=>{events.push('quiescent');return frozen();},
  verifyBackupRestore:async()=>{events.push('backup');return backup();},
  consumeSignedLevel4:async(_pins,b)=>{events.push('l4');return approval(b);},
  holdMaintenance:async()=>{events.push('maintenance');return {
    held:true,ownerSignedRequest:'d432784a-a4cf-4672-9a73-a71825145f95'};},
  recheckPreDDL:async()=>{events.push('recheck');return {
    preimage:base(),quiescence:frozen(),backup:backup(),
    signedRequestId:'d432784a-a4cf-4672-9a73-a71825145f95'};},
  executeExactCapacity:async()=>{events.push('ddl_capacity');return capacity();},
  verifyCapacityCheckpoint:async()=>{events.push('capacity_checkpoint');return capacity();},
  executeExactFeatures:async()=>{events.push('ddl_features');return complete();},
  verifyFinalCheckpoint:async()=>{events.push('final_checkpoint');return complete();},
  writeDurableAudit:async()=>{events.push('audit');return {persisted:true};},
  releaseMaintenanceOnSuccess:async()=>{events.push('resume');return {
    writersSafelyResumed:true,openPricePublicFlagOff:true};}
 };
 return {events,adapter:{...adapter,...overrides}};
}
test('strict immutable production scope',()=>{
 assert.equal(m.verifyStaticPins(),true);
 assert.equal(OPERATION,'host_action.honartik_open_price_live_migrations_v1');
 assert.equal(PINS.migrations.length,2);
 assert.deepEqual(PINS.migrations.map(x=>x.version),[
  'm261016_105000_open_price_money_capacity',
  'm261016_110000_open_price_schedules'
 ]);
});
test('preflight rejects drift and partially-applied schema',()=>{
 const a=base();assert.equal(m.verifyPreflight(a),true);
 assert.throws(()=>m.verifyPreflight({...a,productionHead:'0'.repeat(40)}),Denied);
 assert.throws(()=>m.verifyPreflight({...a,featureColumnsPresent:1}),Denied);
 assert.throws(()=>m.verifyPreflight({...a,targetHistoryCount:1}),Denied);
 assert.throws(()=>m.verifyPreflight({...a,migrationBlobs:['0'.repeat(40),PINS.migrations[1].gitBlob]}),Denied);
 assert.throws(()=>m.verifyPreflight({...a,protectedLocalFilesIntact:false}),Denied);
});
test('frozen writer and signed backup constraints',()=>{
 assert.equal(m.verifyFreeze(frozen()),true);
 assert.throws(()=>m.verifyFreeze({...frozen(),paymentCallbacksFrozen:false}),Denied);
 const b=backup();assert.equal(m.verifyBackup(b),true);
 for(const altered of [
  {ageSeconds:3601},{manifestVerified:false},
  {recoveryPlanIndependentlyVerified:false},
  {sameWindowLiveFinanceComparable:false},
  {rowCounts:{...b.rowCounts,finance_wallet:1}},
  {dumpSha256:'not_a_sha'},{restoreIsolated:false},
  {actualRestorePassed:false}
 ])assert.throws(()=>m.verifyBackup({...b,...altered}),Denied);
});
test('one-time critical L4 authorization must bind the exact backup and two class blobs',()=>{
 const b=backup(), a=approval(b);
 assert.equal(m.verifyApproval(a,b),true);
 for(const bad of [
  {level:3},{operation:'host_action.honartik_open_price_yii_scratch_v1'},
  {checkedByTrustedIssuer:false},{consumedByIssuer:false},
  {oneTime:false},{risk:'high'},{snapshotId:'20261016T212759Z'},
  {dumpSha256:'0'.repeat(64)},{migrationBlobs:['0'.repeat(40),a.migrationBlobs[1]]},
  {consumedAtEpoch:a.expiresAtEpoch+1}
 ])assert.throws(()=>m.verifyApproval({...a,...bad},b),Denied);
});
test('each exact financial and feature history checkpoint fails closed',()=>{
 assert.equal(m.verifyCapacity(capacity()),true);
 assert.equal(m.verifyFinal(complete()),true);
 assert.throws(()=>m.verifyCapacity({...capacity(),payingAmountNullable:false}),Denied);
 assert.throws(()=>m.verifyCapacity({...capacity(),historyRecordedExactlyOnce:false}),Denied);
 assert.throws(()=>m.verifyCapacity({...capacity(),financialInvariantUnchanged:false}),Denied);
 assert.throws(()=>m.verifyFinal({...complete(),targetHistoryCount:1}),Denied);
 assert.throws(()=>m.verifyFinal({...complete(),allPublicOpenPriceFlagsOff:false}),Denied);
 assert.throws(()=>m.verifyFinal({...complete(),boolDefaultReserveFalse:false}),Denied);
});
test('no adapter and CLI are never an execution path',()=>{
 assert.throws(()=>makeCoordinator({}),Denied);
 const cli=spawnSync(process.execPath,['honartik-open-price-live-ddl-coordinator-v1.cjs'],
  {encoding:'utf8',timeout:10000,cwd:__dirname});
 assert.equal(cli.status,2);assert.match(cli.stderr,/Not a CLI/);
});
test('trusted simulation exact order, one-time, writes only after signed consume',async()=>{
 const {events,adapter}=fixture();const c=makeCoordinator(adapter);
 const result=await c.execute();
 assert.equal(result.ok,true);
 assert.equal(result.productionDatabaseChanged,true);
 assert.equal(result.publicFreePriceEnabled,false);
 assert.equal(result.applicationDeployed,false);
 assert.deepEqual(events,[
  'preflight','freeze','quiescent','backup','l4','maintenance','recheck',
  'ddl_capacity','capacity_checkpoint','ddl_features','final_checkpoint','audit','resume'
 ]);
 await assert.rejects(c.execute(),/one_time_coordinator_reused/);
});
test('no L4 grant means no live DDL, audit denial and no resume',async()=>{
 const f=fixture({consumeSignedLevel4:async()=>({...approval(backup()),level:3})});
 await assert.rejects(makeCoordinator(f.adapter).execute(),/signed_scope_or_issuer_missing/);
 assert.equal(f.events.includes('ddl_capacity'),false);
 assert.equal(f.events.includes('resume'),false);
 assert.equal(f.events.at(-1),'audit');
});
test('capacity mismatch cannot execute feature DDL or resume writer',async()=>{
 const f=fixture({verifyCapacityCheckpoint:async()=>({...capacity(),financialInvariantUnchanged:false})});
 await assert.rejects(makeCoordinator(f.adapter).execute(),/capacity_checkpoint_failed/);
 assert.equal(f.events.includes('ddl_features'),false);
 assert.equal(f.events.includes('resume'),false);
 assert.equal(f.events.at(-1),'audit');
});
test('feature checkpoint failure preserves manual recovery boundary',async()=>{
 const f=fixture({verifyFinalCheckpoint:async()=>({...complete(),featureColumnsPresent:7})});
 await assert.rejects(makeCoordinator(f.adapter).execute(),/final_checkpoint_failed/);
 assert.equal(f.events.includes('resume'),false);
 assert.equal(f.events.at(-1),'audit');
});
test('missing durable audit blocks success and prevents automatic writer resume',async()=>{
 const f=fixture({writeDurableAudit:async()=>({persisted:false})});
 await assert.rejects(makeCoordinator(f.adapter).execute(),/durable_audit_failed_manual_stop/);
 assert.equal(f.events.includes('resume'),false);
});
test('cannot silently resume if public flag is enabled',async()=>{
 const f=fixture({releaseMaintenanceOnSuccess:async()=>({
   writersSafelyResumed:true,openPricePublicFlagOff:false})});
 await assert.rejects(makeCoordinator(f.adapter).execute(),/safe_resume_not_proven/);
});

test('final signed pre-DDL recheck blocks live schema drift before any financial DDL',async()=>{
 const f=fixture({recheckPreDDL:async()=>{
   return {preimage:{...base(),targetHistoryCount:1},
     quiescence:frozen(),backup:backup(),
     signedRequestId:'d432784a-a4cf-4672-9a73-a71825145f95'};
 }});
 await assert.rejects(makeCoordinator(f.adapter).execute(),/production_preimage_mismatch/);
 assert.equal(f.events.includes('ddl_capacity'),false);
 assert.equal(f.events.at(-1),'audit');
});
test('pre-DDL backup identity cannot diverge from the signed snapshot',async()=>{
 const f=fixture({recheckPreDDL:async()=>({
  preimage:base(),quiescence:frozen(),
  backup:{...backup(),snapshotId:'20261018T021500Z'},
  signedRequestId:'d432784a-a4cf-4672-9a73-a71825145f95'
 })});
 await assert.rejects(makeCoordinator(f.adapter).execute(),/immediate_pre_ddl_binding_drift/);
 assert.equal(f.events.includes('ddl_capacity'),false);
});
