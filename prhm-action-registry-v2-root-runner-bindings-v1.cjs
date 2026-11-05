'use strict';
/**
 * Actual nine-capability slice of the Honartik V2 independent root runner.
 *
 * Only a process in its own fixed transient root systemd cgroup with the
 * exact pinned five-field request and a REAL consumed Ed25519 L4 JWS may
 * instantiate this binding. No CLI or arbitrary adapter injection.
 *
 * Root filesystem reads are the existing SHA-pinned O_NOFOLLOW readers.
 * The first side effect (claimOnce) is a durable root O_EXCL/fdatasync
 * reservation of the already verified, consumed request. Systemd controls
 * are wrapped behind that successful claim and the same live L4 proof.
 *
 * This module deliberately exposes ONLY 9 of the 12 required bridge
 * functions. It cannot be passed as a successful complete runner bridge.
 * The remaining installer, independently verified rollback and
 * authenticated blue+green discovery must be attached
 * through a separately SHA-approved and reviewed root bootstrap.
 */
const fs=require('node:fs');
const pinned=require('./prhm-action-registry-v2-root-pinned-readers-v1.cjs');
const systemd=require('./prhm-action-registry-v2-fixed-systemd-bridge-v1.cjs');
const oneTime=require('./prhm-action-registry-one-time-fence-v1.cjs');
const accountable=require('./prhm-action-registry-v2-root-accountability-v1.cjs');
const gate=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const REQUIRED=Object.freeze([
 'readPinnedGitManifest','readPinnedGitSource','readLiveOwner','readStagedAsset',
 'getInstaller','getRollback','claimOnce','verifyOriginalState',
 'restartService','checkServiceHealth','getToolDiscovery','writeMetadataAudit'
]);
const BOUND=Object.freeze([
 'readPinnedGitManifest','readPinnedGitSource','readLiveOwner','readStagedAsset',
 'claimOnce','verifyOriginalState','restartService','checkServiceHealth',
 'writeMetadataAudit'
]);
const MISSING=Object.freeze(REQUIRED.filter(k=>!BOUND.includes(k)));
function fail(x){throw Error('registry_v2_root_runner_bindings_'+x)}
function check(v,why){if(!v)fail(why)}
function assertIndependent(){
 const raw=fs.readFileSync('/proc/self/cgroup','utf8');
 return systemd.cgroupAttestation(raw,()=>process.getuid?.());
}
function identity(args){
 gate.assertPinned(args);
 const bound=bridge.strictRequest(args);
 check(bound.arguments_sha256===gate.ARGUMENTS_SHA,
  'five_field_argument_binding_drift');
 return bound;
}
function inventory(){
 return Object.freeze({
  schema:'prhm.registry-v2.root-runner-capability-inventory.v1',
  project:'honartik',
  source_capabilities:BOUND,
  required_capabilities:REQUIRED,
  missing_capabilities:MISSING,
  complete:false,
  standalone_executable:false,
  authorization_issued:false,
  production_installed:false
 });
}
function createBoundNine({input,approvalToken}={}){
 assertIndependent();
 identity(input);
 check(typeof approvalToken==='string'&&approvalToken.length>=120&&
   approvalToken.length<=16384,'sealed_jws_missing');
 // Verified by existing real live Approval Center public key and consumed
 // journal under fixed paths: NO fake "approved" structure accepted.
 const proof=gateway.verifyLiveConsumedRegistrationApproval({
  token:approvalToken,args:input
 });
 check(proof.action===gate.REQUEST.action&&proof.level===4&&
  proof.arguments_sha256===gate.ARGUMENTS_SHA,
  'independently_consumed_l4_mismatch');
 const readers=pinned.readers();
 const svc=systemd.createFixedSystemdBridge();
 let exclusive=false;
 function freshProof(){
  assertIndependent();
  const latest=gateway.verifyLiveConsumedRegistrationApproval({
   token:approvalToken,args:input
  });
  check(latest.request_id===proof.request_id&&
   latest.arguments_sha256===proof.arguments_sha256,
   'live_consumption_changed');
  return latest;
 }
 function ensureClaim(){
  freshProof();
  check(exclusive,'durable_one_time_claim_required_before_systemd');
 }
 async function claimOnce(bound){
  freshProof();
  check(!exclusive,'duplicate_same_process_claim');
  check(bound&&Object.keys(bound).sort().join('|')==='approval|args',
   'one_time_claim_schema');
  identity(bound.args);
  for(const k of gate.KEYS)
   check(bound.args[k]===input[k],'claim_release_changed');
  const provided=bound.approval;
  check(provided&&Object.keys(proof).every(k=>provided[k]===proof[k])&&
   Object.keys(provided).sort().join('|')===Object.keys(proof).sort().join('|'),
   'claim_approval_not_independently_verified');
  // Durable O_EXCL reservation, never auto-unlink and never retry.
  const receipt=oneTime.reserveFromVerifiedApproval({
   approval:proof,args:input
  });
  check(receipt.durable===true&&receipt.exclusive===true&&
   receipt.request_id===proof.request_id&&
   receipt.arguments_sha256===gate.ARGUMENTS_SHA,
   'claim_postcondition_invalid');
  exclusive=true;
  return receipt;
 }
 const result=Object.freeze({
  readPinnedGitManifest:readers.readPinnedGitManifest,
  readPinnedGitSource:readers.readPinnedGitSource,
  readLiveOwner:readers.readLiveOwner,
  readStagedAsset:readers.readStagedAsset,
  claimOnce,
  verifyOriginalState:release=>{
   ensureClaim();
   return accountable.strictOriginalState(release,{
    readLiveOwner:readers.readLiveOwner
   });
  },
  restartService:name=>{ensureClaim();return svc.restartService(name)},
  checkServiceHealth:name=>{ensureClaim();return svc.checkServiceHealth(name)},
  writeMetadataAudit:async record=>{
   ensureClaim();
   const receipt=accountable.appendBoundAudit(record,{
    requestId:proof.request_id
   });
   check(receipt?.durable===true&&receipt?.written===true&&
    receipt.request_id===proof.request_id,
    'audit_not_durable');
   return receipt;
  }
 });
 check(Object.keys(result).sort().join('|')===BOUND.slice().sort().join('|'),
  'nine_capabilities_shape_drift');
 return result;
}
module.exports=Object.freeze({
 REQUIRED,BOUND,MISSING,inventory,identity,createBoundNine
});
