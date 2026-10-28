'use strict';

/**
 * Issue #221: NATIVE DISPATCH CORE CANDIDATE, NOT AN INSTALLED ENDPOINT.
 *
 * The existing root-owned Host Actions v2 executor must independently review
 * and attach this code through its existing authenticated fixed-action route.
 * There is NO HTTP server, CLI, signer, root bootstrap, path selector, or
 * arbitrary operation endpoint here. The existing Approval Center remains
 * the only signer/consumer and the native root adapter the only installer.
 *
 * Required host-owned capabilities must be installed in source by the
 * trusted owner; NEVER deserialize/accept them from MCP, HTTP or user input.
 */
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const native=require('./shared-registrar-native-root-adapter-v1.cjs');
const ACTION=gateway.ACTION;
const fail=x=>{throw Error('registrar_dispatch_'+x)};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exact(obj,keys) {
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||
  Object.keys(obj).sort().join('|')!==keys.slice().sort().join('|'))
  fail('schema');
}
const INPUT_FIELDS=Object.freeze([
 'action','project','source_commit','manifest_commit','manifest_sha256'
]);
const EXEC_FIELDS=Object.freeze(['request_id','second_confirmation']);

/** Source-only planning phase: five-field typed Approval Center input. */
function prepareRequest(input){
 exact(input,INPUT_FIELDS);
 bridge.strictRequest(input);
 return bridge.typedApprovalRequest(input);
}
/** Check response from the real installed issuer, do not trust UI booleans. */
function bindIssuedPending(input,issued,nowMs){
 prepareRequest(input);
 return bridge.bindPendingRequest(input,issued,nowMs);
}
/** Native execute request carries only request ID and critical confirmation.
 * Full immutable Git tuple is recovered from the HOST-OWNED pending record.
 */
function prepareExecute(stored,command,nowMs){
 exact(command,EXEC_FIELDS);
 if(!UUID.test(command.request_id||''))fail('request_id_invalid');
 return bridge.bindPendingExecute(stored,command,nowMs);
}
function assertConsumedRequestIdentity(expectedRequestId,proof){
 if(!UUID.test(expectedRequestId||'')||!proof||
   proof.action!==ACTION||proof.level!==4||proof.risk!=='critical'||
   proof.request_id!==expectedRequestId)
  fail('consumed_request_identity_mismatch');
 return true;
}
function rootOnly(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
  fail('native_root_required');
}
function hostCapabilities(h){
 const names=['requestTypedApproval','writePendingExclusive','readPending',
  'claimPendingAtomically','confirmAndConsumeBoundApproval',
  'nativeInstallerHooks','auditMetadata'];
 if(!h||typeof h!=='object'||names.some(n=>typeof h[n]!=='function'))
  fail('trusted_host_capabilities_missing');
 return h;
}
/**
 * Only the EXISTING trusted, privileged executor can invoke this factory.
 * Its host implementation MUST prove:
 *   - authentication and fixed action dispatch before this call;
 *   - pending record exclusive root-owned mode 0600, durable fsync;
 *   - compare-and-swap pending -> claimed BEFORE approval consumption;
 *   - fail-closed on crash/duplicate execution and attest recovery separately;
 *   - same exact five-field tuple at Approval Center request+confirm+consume.
 *
 * No endpoint or state directory is installed by this library.
 */
function createForExistingRootExecutor(host){
 rootOnly();
 const h=hostCapabilities(host);
 return Object.freeze({
  async request(input){
   rootOnly();
   const payload=prepareRequest(input);
   const response=await h.requestTypedApproval(payload);
   const issuerRequest=response?.request;
   const bound=bindIssuedPending(input,issuerRequest,Date.now());
   await h.writePendingExclusive(bound);
   await h.auditMetadata({event:'registrar_pending_created',
    request_id:bound.request_id,arguments_sha256:bound.arguments_sha256,
    policy_version:bound.policy_version,token_exposed:false});
   return Object.freeze({ok:true,request:bound});
  },
  async execute(command){
   rootOnly();
   exact(command,EXEC_FIELDS);
   if(!UUID.test(command.request_id||''))fail('request_id_invalid');
   const stored=await h.readPending(command.request_id);
   const bound=prepareExecute(stored,command,Date.now());
   // Strict CAS is mandatory before contacting Approval Center or installer.
   const claimed=await h.claimPendingAtomically(stored);
   if(claimed!==true)fail('pending_claim_failed');
   // No recoverable/retryable public apply after this point. A crash is
   // reconciled by trusted internal recovery, never by reusing the receipt.
   const issued=await h.confirmAndConsumeBoundApproval({
    request_id:bound.request_id,second_confirmation:command.second_confirmation,
    arguments:bound.arguments,arguments_sha256:bound.arguments_sha256,
    policy_hash:bound.policy_hash
   });
   const token=issued?.approval_token;
   if(typeof token!=='string'||token.length<120||token.length>16384)
    fail('consumed_approval_token_missing');
   // Verify identity of the persisted pending request, not merely the
   // five-field argument digest: two approvals for the same source tuple
   // MUST NOT be interchangeable.
   const proof=gateway.verifyLiveConsumedRegistrationApproval({
    token,args:bound.arguments
   });
   assertConsumedRequestIdentity(bound.request_id,proof);
   // The native adapter performs the whole verification AGAIN immediately
   // before attempting its root-owned atomic transaction.
   const result=await native.applyFromTrustedRootDispatcher({
    args:bound.arguments,approvalToken:token,hooks:h.nativeInstallerHooks()
   });
   await h.auditMetadata({event:'registrar_native_installed',
    request_id:bound.request_id,arguments_sha256:bound.arguments_sha256,
    policy_version:gateway.POLICY_VERSION,token_exposed:false});
   return Object.freeze({ok:true,request_id:bound.request_id,
    transaction:result.transaction,action:result.action});
  }
 });
}
module.exports=Object.freeze({
 ACTION,INPUT_FIELDS,EXEC_FIELDS,prepareRequest,bindIssuedPending,
 prepareExecute,assertConsumedRequestIdentity,createForExistingRootExecutor
});
if(require.main===module){
 process.stderr.write('Native dispatcher is NOT a standalone installer or Host Action.\\n');
 process.exitCode=64;
}
