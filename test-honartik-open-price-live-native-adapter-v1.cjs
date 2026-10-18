'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const native=require('./honartik-open-price-live-native-adapter-v1.cjs');
const {ACTION,OPERATION,PINS}=require('./honartik-open-price-live-ddl-coordinator-v1.cjs');

function mockTrusted(overrides={}){
 const calls=[];
 const grant='d432784a-a4cf-4672-9a73-a71825145f95';
 const trusted={
   registeredNativeAction:ACTION,
   registeredOperation:OPERATION,
   capabilitySource:native.CAPABILITY_SOURCE,
   trustedRootOwned:true,signedIssuerAlgorithm:'Ed25519',
   oneTimeApprovalEnforced:true,criticalLevel4PolicyEnforced:true,
   durableAuditRequired:true,
   readExactLiveSchema:async()=>({readOnly:true}),
   freezeFixedHonartikWriters:async()=>({writersFrozen:true}),
   verifyFixedHonartikWriterFreeze:async()=>({writersFrozen:true}),
   verifyNewestRestoredBackup:async()=>({complete:true}),
   issuerConsumeExactLevel4:async()=>({
      checkedByTrustedIssuer:true,consumedByIssuer:true,requestId:grant
   }),
   holdFixedMaintenance:async()=>({held:true,ownerSignedRequest:grant}),
   recheckFixedLivePreimage:async()=>({}),
   runFixedReviewedMigrationClass:async(_,index,id)=>{
      calls.push({index,id});return {index};
   },
   auditCapacityAgainstLiveDatabase:async()=>({success:true}),
   auditFinalAgainstLiveDatabase:async()=>({success:true}),
   appendSignedDurableAudit:async()=>({persisted:true}),
   resumeHonartikWritersAfterVerifiedMigration:async()=>({
       writersSafelyResumed:true,openPricePublicFlagOff:true
   }),
   ...overrides
 };
 return {trusted,calls,grant};
}
test('native bridge is non-CLI and has exactly fixed Host Action name',()=>{
 const r=spawnSync(process.execPath,['honartik-open-price-live-native-adapter-v1.cjs'],
  {cwd:__dirname,encoding:'utf8',timeout:10000});
 assert.equal(r.status,2);assert.match(r.stderr,/No CLI/);
 assert.equal(native.BRIDGE_ACTION,ACTION);
});
test('unregistered or forged provenance rejects adapter creation',()=>{
 for(const override of [
   {registeredNativeAction:'other'},
   {registeredOperation:'host_action.other'},
   {capabilitySource:'request-json'},
   {trustedRootOwned:false},
   {signedIssuerAlgorithm:'HS256'},
   {oneTimeApprovalEnforced:false},
   {criticalLevel4PolicyEnforced:false},
   {durableAuditRequired:false},
   {issuerConsumeExactLevel4:null}
 ]){
   assert.throws(()=>native.createNativeAdapter(mockTrusted(override).trusted),
     /not_registered_or_trust_capabilities_missing/);
 }
 assert.throws(()=>native.createNativeAdapter({}),
   /not_registered_or_trust_capabilities_missing/);
});
test('no approval or maintenance means no execution of either reviewed migration',async()=>{
 const {trusted,calls,grant}=mockTrusted();
 const a=native.createNativeAdapter(trusted);
 await assert.rejects(a.executeExactCapacity(PINS.migrations[0],grant),
  /capacity_scope_or_maintenance_mismatch/);
 await assert.rejects(a.executeExactFeatures(PINS.migrations[1],grant),
  /features_scope_or_maintenance_mismatch/);
 assert.equal(calls.length,0);
});
test('requires valid backup identity before requesting signed L4 grant',async()=>{
 let count=0;
 const {trusted}=mockTrusted({
   issuerConsumeExactLevel4:async()=>{count++;return {}}
 });
 const a=native.createNativeAdapter(trusted);
 await assert.rejects(a.consumeSignedLevel4(PINS,{}),/unverified_backup_for_signing/);
 assert.equal(count,0);
});
test('missing issuer proof cannot unlock maintenance or DDL',async()=>{
 const {trusted,grant,calls}=mockTrusted({
   issuerConsumeExactLevel4:async()=>({requestId:grant})
 });
 const a=native.createNativeAdapter(trusted);
 await a.consumeSignedLevel4(PINS,{database:PINS.database,
   dumpSha256:'a'.repeat(64),snapshotId:'20261017T212022Z'});
 await assert.rejects(a.holdMaintenance(PINS,grant),/approval_not_consumed/);
 await assert.rejects(a.executeExactCapacity(PINS.migrations[0],grant),
  /capacity_scope_or_maintenance_mismatch/);
 assert.equal(calls.length,0);
});
test('signed approval binds maintenance and each exact migration index',async()=>{
 const {trusted,grant,calls}=mockTrusted();
 const a=native.createNativeAdapter(trusted);
 await a.consumeSignedLevel4(PINS,{database:PINS.database,
   dumpSha256:'a'.repeat(64),snapshotId:'20261017T212022Z'});
 await assert.rejects(a.holdMaintenance(PINS,'other'),/approval_not_consumed/);
 assert.equal((await a.holdMaintenance(PINS,grant)).held,true);
 await assert.rejects(a.executeExactCapacity(PINS.migrations[1],grant),
  /capacity_scope_or_maintenance_mismatch/);
 await assert.rejects(a.executeExactFeatures(PINS.migrations[0],grant),
  /features_scope_or_maintenance_mismatch/);
 await assert.rejects(a.executeExactCapacity(
   {...PINS.migrations[0],gitBlob:'0'.repeat(40)},grant),
   /capacity_scope_or_maintenance_mismatch/);
 await assert.rejects(a.executeExactFeatures(PINS.migrations[1],'other'),
  /features_scope_or_maintenance_mismatch/);
 await a.executeExactCapacity(PINS.migrations[0],grant);
 await a.executeExactFeatures(PINS.migrations[1],grant);
 assert.deepEqual(calls,[{index:0,id:grant},{index:1,id:grant}]);
});
