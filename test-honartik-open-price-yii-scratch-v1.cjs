'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const {PINS,verifyPreflight,verifyApproval,verifyResult,makeCoordinator}=require('./honartik-open-price-yii-scratch-v1.cjs');
function preflight(){
 return {
  readOnly:true,sourceCommit:PINS.sourceSha,sourceBlobSha:PINS.sourceBlobSha,
  currentBackendHead:PINS.prodBackendHead,snapshotPath:PINS.snapshot,
  manifestPath:PINS.manifest,snapshotSha256Verified:true,snapshotRestorable:true,
  networkMode:'none',image:'mariadb:10.6',
  productionDbSocketMounted:false,productionDbCredentialsMounted:false,
  separateScratchDatadir:true,scrubbedScratchCredentials:true,
  liveDatabaseWritePermission:false,scratchSourceOnly:true,
  resourcePreflightPassed:true
 };
}
function approval(){
 return {consumedByTrustedControlPlane:true,oneTime:true,
  operation:PINS.approvalOperation,sourceSha:PINS.sourceSha,sourceBlobSha:PINS.sourceBlobSha,
  receiptId:'signed-receipt-123'};
}
function outcome(){
 return {
  ok:true,readOnlyProduction:true,executionSourceCommit:PINS.sourceSha,
  executionSourceBlobSha:PINS.sourceBlobSha,testedDatabase:'honartik_db',
  mariadbVersion:'10.6.21-MariaDB',networkMode:'none',snapshotManifestVerified:true,
  snapshotRestoredComplete:true,actualYiiClassesExecuted:true,
  yiiCapacityPassed:true,yiiFeaturesPassed:true,payingAmountBigintVerified:true,
  allEightFeatureColumnsVerified:true,financialCountAndSumsUnchanged:true,
  capacityRetryIdempotentBeforeFeatures:true,
  capacityPostFeaturesFailClosed:true,featureDuplicateFailClosed:true,
  productionDatabaseUntouched:true,productionApplicationUnchanged:true,
  rowCounts:{...PINS.expectedCounts}
 };
}
function harness(o={}){
 const trace=[];
 const ops={
  preflight:async()=>{trace.push('preflight');return {...preflight(),...(o.preflight||{})};},
  consumeApproval:async()=>{trace.push('approval');return {...approval(),...(o.approval||{})};},
  executeRestoredYiiRehearsal:async()=>{trace.push('run');if(o.throwRun)throw Error('run_failed');return {...outcome(),...(o.result||{})};},
  cleanup:async()=>{trace.push('cleanup');if(o.throwCleanup)throw Error('cleanup_failed');return o.cleanup||{
   scratchRemoved:true,disposableContainerRemoved:true,liveApplicationUnchanged:true,liveDatabaseUnchanged:true
  };},
  audit:async r=>{trace.push('audit');if(o.throwAudit)throw Error('audit_failed');assert.equal(r.action,PINS.action);}
 };
 return {ops,trace};
}
test('contract pins exact immutable feature code and October snapshot',()=>{
 assert.match(PINS.sourceSha,/^[a-f0-9]{40}$/);
 assert.match(PINS.sourceBlobSha,/^[a-f0-9]{40}$/);
 assert.equal(PINS.network,'none');assert.equal(PINS.dbImage,'mariadb:10.6');
 assert.equal(PINS.expectedCounts.finance_transactions,37156);
 assert.equal(PINS.expectedCounts.finance_wallet,50543);
 assert.equal(PINS.expectedCounts.reserve,36738);
});
test('direct CLI never runs a host operation',()=>{
 const r=cp.spawnSync(process.execPath,[path.join(__dirname,'honartik-open-price-yii-scratch-v1.cjs')],{encoding:'utf8'});
 assert.equal(r.status,2);const x=JSON.parse(r.stdout);
 assert.equal(x.productionChanged,false);
 assert.equal(x.reason,'typed_signed_host_action_registration_required');
});
test('valid ready-state evidence passes',()=>{assert.doesNotThrow(()=>verifyPreflight(preflight()));});
test('unverified snapshot, checksum, identity or source always blocks',()=>{
 for(const mutation of [
  {snapshotSha256Verified:false},{snapshotRestorable:false},
  {snapshotPath:'/tmp/arbitrary.sql.gz'}, {sourceCommit:'f'.repeat(40)},
  {sourceBlobSha:'f'.repeat(40)},{currentBackendHead:'f'.repeat(40)},
  {manifestPath:'/tmp/not-manifest'},{resourcePreflightPassed:false}
 ])assert.throws(()=>verifyPreflight({...preflight(),...mutation}));
});
test('no network, live socket, live credentials or writable production DB accepted',()=>{
 for(const mutation of [
  {networkMode:'bridge'},{image:'mariadb:latest'},
  {productionDbSocketMounted:true},{productionDbCredentialsMounted:true},
  {separateScratchDatadir:false},{scrubbedScratchCredentials:false},
  {liveDatabaseWritePermission:true},{liveDatabaseWritePermission:undefined},{scratchSourceOnly:false},{readOnly:false}
 ])assert.throws(()=>verifyPreflight({...preflight(),...mutation}));
});
test('approval must be one-time, trusted and bound to the exact SHA and action',()=>{
 assert.doesNotThrow(()=>verifyApproval(approval()));
 for(const mutation of [
  {consumedByTrustedControlPlane:false},{oneTime:false},
  {operation:'host_action.other'}, {sourceSha:'f'.repeat(40)},
  {sourceBlobSha:'a'.repeat(40)},{receiptId:'x'}
 ])assert.throws(()=>verifyApproval({...approval(),...mutation}));
});
test('real migrated backup evidence must be complete and exact',()=>{
 assert.doesNotThrow(()=>verifyResult(outcome()));
 for(const mutation of [
  {mariadbVersion:'11.8.6'}, {networkMode:'bridge'},
  {actualYiiClassesExecuted:false},{yiiFeaturesPassed:false},{yiiCapacityPassed:false},
  {snapshotRestoredComplete:false},{snapshotManifestVerified:false},{readOnlyProduction:false},{readOnlyProduction:undefined},
  {allEightFeatureColumnsVerified:false},{payingAmountBigintVerified:false},
  {financialCountAndSumsUnchanged:false},
  {capacityRetryIdempotentBeforeFeatures:false},
  {capacityPostFeaturesFailClosed:false},{featureDuplicateFailClosed:false},
  {productionDatabaseUntouched:false},{productionApplicationUnchanged:false},
  {testedDatabase:'production_live'}, {executionSourceBlobSha:'f'.repeat(40)},
  {rowCounts:{...PINS.expectedCounts,finance_transactions:10}}
 ])assert.throws(()=>verifyResult({...outcome(),...mutation}));
});
test('correct signed trusted flow and cleanup commits a pure evidence receipt',async()=>{
 const x=harness();const r=await makeCoordinator(x.ops).execute();
 assert.equal(r.ok,true);assert.equal(r.productionChanged,false);
 assert.deepEqual(x.trace,['preflight','approval','run','cleanup','audit']);
});
test('no approval means no migration operation',async()=>{
 const x=harness({approval:{oneTime:false}});
 await assert.rejects(makeCoordinator(x.ops).execute(),/one_time_signed_approval_missing/);
 assert.deepEqual(x.trace,['preflight','approval','cleanup','audit']);
});
test('preflight failure never asks for approval',async()=>{
 const x=harness({preflight:{networkMode:'host'}});
 await assert.rejects(makeCoordinator(x.ops).execute(),/isolated_preflight_not_proven/);
 assert.deepEqual(x.trace,['preflight','cleanup','audit']);
});
test('migration evidence mismatch returns failure and forces cleanup',async()=>{
 const x=harness({result:{financialCountAndSumsUnchanged:false}});
 await assert.rejects(makeCoordinator(x.ops).execute(),/actual_restored_yii_rehearsal_unproven/);
 assert.deepEqual(x.trace,['preflight','approval','run','cleanup','audit']);
});
test('native migration exception never skips cleanup',async()=>{
 const x=harness({throwRun:true});
 await assert.rejects(makeCoordinator(x.ops).execute(),/run_failed/);
 assert.deepEqual(x.trace,['preflight','approval','run','cleanup','audit']);
});
test('failed scratch cleanup cannot be reported as success',async()=>{
 const x=harness({cleanup:{scratchRemoved:false}});
 await assert.rejects(makeCoordinator(x.ops).execute(),/scratch_cleanup_unverified/);
 assert.equal(x.trace.at(-1),'audit');
});
test('failed durable audit cannot produce a success receipt',async()=>{
 const x=harness({throwAudit:true});
 await assert.rejects(makeCoordinator(x.ops).execute(),/durable_audit_unverified/);
 assert.equal(x.trace.includes('cleanup'),true);
});
test('coordinator cannot be reused for a second authorization',async()=>{
 const x=harness();const c=makeCoordinator(x.ops);
 await c.execute(); await assert.rejects(c.execute(),/coordinator_reuse_forbidden/);
 assert.equal(x.trace.filter(s=>s==='run').length,1);
});
test('untrusted/incomplete adapter fails before executing',()=>{
 assert.throws(()=>makeCoordinator({preflight(){}}),/trusted_native_adapter_incomplete/);
});
