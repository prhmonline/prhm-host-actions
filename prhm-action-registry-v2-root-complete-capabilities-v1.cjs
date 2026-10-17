'use strict';
/**
 * Full-shape Honartik V2 trusted runner provider: 12 real function bindings.
 * Source is NOT an installed root launcher. No standalone CLI or direct
 * approval. Only the existing independently authenticated sealed systemd
 * credential entrypoint may invoke the provider after reviewed stage SHA
 * attestation. Runtime results require real live Ed25519 consumed receipt,
 * durable O_EXCL one-time claim, immutable installer source, and live
 * authenticated blue+green MCP discovery.
 */
const G=require('./prhm-action-registry-gateway-v1.cjs');
const gate=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const B=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const partial=require('./prhm-action-registry-v2-root-runner-bindings-v1.cjs');
const installer=require('./honartik-config-center-atomic-registration-installer-v1.cjs');
const cold=require('./prhm-action-registry-v2-root-recovery-io-v1.cjs');
const live=require('./prhm-action-registry-v2-root-live-mcp-v1.cjs');
const TARGET='honartik_config_center_readonly_enroll_v1';
function fail(x){throw Error('registry_v2_complete_runner_'+x)}
function check(v,x){if(!v)fail(x)}
function identity(input,approvalToken){
 partial.identity(input);
 check(typeof approvalToken==='string'&&approvalToken.length>=120,
  'signed_token_missing');
 const p=G.verifyLiveConsumedRegistrationApproval({token:approvalToken,args:input});
 check(p.request_id&&p.action===gate.REQUEST.action&&
  p.arguments_sha256===gate.ARGUMENTS_SHA&&p.level===4,
  'consumed_l4_binding_invalid');
 return p;
}
function createBoundTwelve({input,approvalToken}={}){
 const proof=identity(input,approvalToken);
 // Independent root UID/cgroup, pinned file readers and trusted root fence
 // are all attested again by the existing nine-function implementation.
 const nine=partial.createBoundNine({input,approvalToken});
 let claimed=false;
 function verify(){
  partial.identity(input);
  const again=G.verifyLiveConsumedRegistrationApproval({
   token:approvalToken,args:input
  });
  check(again.request_id===proof.request_id&&
   again.arguments_sha256===proof.arguments_sha256,
   'signed_request_changed');
  return again;
 }
 function ensureClaim(){
  verify();
  check(claimed,'durable_claim_required_before_host_action');
 }
 const result=Object.freeze({
  ...nine,
  claimOnce:async binding=>{
   check(!claimed,'duplicate_claim');
   verify();
   const receipt=await nine.claimOnce(binding);
   check(receipt.durable===true&&receipt.exclusive===true&&
    receipt.request_id===proof.request_id,
    'claim_postcondition_invalid');
   claimed=true;return receipt;
  },
  getInstaller:action=>{
   verify();
   check(action===TARGET&&typeof installer.executeAfterSharedRegistryApproval==='function',
    'reviewed_installer_unavailable');
   return async opts=>{
    ensureClaim();
    check(opts?.args?.source_commit===input.source_commit&&
     opts?.args?.manifest_commit===input.manifest_commit&&
     opts?.args?.manifest_sha256===input.manifest_sha256,
     'installer_release_drift');
    return installer.executeAfterSharedRegistryApproval(opts);
   };
  },
  getRollback:action=>{
   verify();
   check(action===TARGET,'rollback_action_untrusted');
   return async bound=>{
    ensureClaim();
    const r=bound?.release;
    check(r?.source_commit===input.source_commit&&
     r?.manifest_commit===input.manifest_commit&&
     r?.manifest_sha256===input.manifest_sha256&&
     bound?.approval?.request_id===proof.request_id,
     'rollback_release_or_approval_drift');
    // No second approval, never replay the installer. Cold recovery requires
    // the REAL signed consumed ledger, root O_EXCL reservation, journal, all
    // SHA-matched backups, exclusive lock and two absent MCP workers.
    const recovery=cold.createRecovery({
     release:r,requestId:proof.request_id,approvalToken
    });
    await recovery.readonlyPreflight();
    const report=await recovery.recover();
    check(report?.verified===true&&report?.restored===true&&
     report.request_id===proof.request_id,'rollback_not_verified');
    return Object.freeze({verified:true,
     request_id:report.request_id,steps:report.steps});
   };
  },
  getToolDiscovery:async action=>{
   ensureClaim();
   check(action===TARGET,'discovery_action_untrusted');
   return live.createDiscovery().getToolDiscovery(action);
  }
 });
 B.attestExistingRoute(result);
 check(Object.keys(result).sort().join('|')===
  partial.REQUIRED.slice().sort().join('|'),
  'twelve_function_contract_invalid');
 return result;
}
function status(){
 return Object.freeze({
  source_functions:12,required_functions:12,
  root_launcher_installed:false,credential_transport_attested_on_host:false,
  authenticated_discovery_verified_on_host:false,
  production_authorized:false,level4_consumed_by_this_module:false,
  can_run_standalone:false
 });
}
module.exports=Object.freeze({TARGET,identity,status,createBoundTwelve});
