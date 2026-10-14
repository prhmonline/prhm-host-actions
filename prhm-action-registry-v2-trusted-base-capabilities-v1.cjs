'use strict';
/**
 * Narrow production-I/O binding for Honartik V2's independently rooted
 * AF_UNIX approval sidecar.
 *
 * This is NOT a registrar installer or an authorization provider. Existing
 * real root-bound Approval Center request/decision/validate/consume and
 * sealed JWS-vault functions are wired without caller-injected transports.
 *
 * CRITICAL: no trusted consumed-ledger adapter, durable recovery service,
 * signed SHA-pinned root launcher or authenticated dual-worker discovery
 * exists in the reviewed installation closure yet. They MUST NOT be
 * represented by injected callbacks or invented affirmative evidence.
 * Therefore the nine-function HTTP adapter surface is complete, but all
 * approval-creation requests FAIL CLOSED at preflight. Execution is impossible.
 *
 * Separate L4-signed bootstrap, exact staged Git blob closure, independent
 * root and service attestation, and cold-process recovery evidence are still
 * prerequisites; running this file never installs anything.
 */
const fs=require('node:fs');
const transport=require('./prhm-action-registry-v2-root-approval-transport-v1.cjs');
const vault=require('./prhm-action-registry-v2-root-sealed-token-vault-v1.cjs');
const attestation=require('./prhm-action-registry-v2-root-attestation-v1.cjs');
const adapter=require('./prhm-action-registry-v2-approval-http-adapter-v1.cjs');
const socket=require('./prhm-action-registry-v2-isolated-socket-v1.cjs');
const gate=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');

const CAPABILITIES=Object.freeze([
 'approvalHttp','approvalBridge','getTrustedRequest','getApprovalCredentials',
 'sealApprovedToken','loadSealedApprovedToken','verifyRootPreflight',
 'readConsumedEvidence','launchPinnedRootRunner'
]);
const MISSING=Object.freeze([
 'SIGNED_ROOT_STAGE_NOT_INSTALLED',
 'CONSUMED_LEDGER_TRUSTED_READER_NOT_INSTALLED',
 'INDEPENDENT_SIGNED_ROOT_LAUNCHER_NOT_INSTALLED',
 'DURABLE_COLD_RECOVERY_NOT_VERIFIED_ON_HOST',
 'AUTHENTICATED_BLUE_GREEN_DISCOVERY_NOT_VERIFIED',
 'FIVE_FIELD_SIGNED_ROUTE_NOT_PUBLISHED'
]);
function fail(code){throw Error('registry_v2_root_capabilities_'+code)}
function check(x,code){if(!x)fail(code)}
function assertSidecarProcess(){
 check(process.getuid?.()===0,'root_uid_required');
 const raw=fs.readFileSync('/proc/self/cgroup','utf8');
 check(typeof raw==='string'&&raw.length>0&&raw.length<=8192&&
   raw.split('\n').some(line=>line.split('/').includes(socket.UNIT)),
   'isolated_sidecar_unit_required');
 // No arguments, flags or environment-selected alternate privileged stage.
 check(process.argv.length===2,'sidecar_argv_not_allowed');
 return true;
}
function incompletePreflight(evidence){
 check(evidence?.schema==='prhm.registry-v2.root-attestation.v1'&&
  evidence.project==='honartik'&&
  evidence.runtime_git_pins_verified===true&&
  evidence.root_runner_source_attested===true&&
  evidence.source_only===true&&
  evidence.authorization===false&&evidence.approval_route_installed===false&&
  evidence.staged_file_count===20,
  'root_attestation_result_invalid');
 const pins=evidence.owner_shas;
 check(pins&&Object.keys(pins).sort().join('|')==='base|executor|mcp|policy',
   'owner_proof_incomplete');
 // Correct adapter schema, always NO-GO until independently verified root
 // launcher + signed route + cold recovery + fresh authenticated workers.
 return Object.freeze({
  ready:false,
  owner_shas:Object.freeze({...pins}),
  runtime_git_pins_verified:true,
  root_runner_attested:false,
  durable_recovery_verified:false,
  dual_worker_discovery_verified:false,
  signed_route_published:false,
  at_ms:Date.now()
 });
}
function createRootCapabilities(){
 assertSidecarProcess();
 check(CAPABILITIES.join('|')===adapter.CAPABILITIES.join('|'),
   'http_capability_schema_drift');
 check(gate.REQUEST.project==='honartik'&&
  gate.REQUEST.action==='prhm_action_registry_install_v1'&&
  gate.ARGUMENTS_SHA.length===64,'release_identity_untrusted');
 const t=transport.createTransport();
 const v=vault.createVault();
 const capabilities=Object.freeze({
  approvalHttp:t.approvalHttp,
  approvalBridge:t.approvalBridge,
  getTrustedRequest:t.getTrustedRequest,
  getApprovalCredentials:t.getApprovalCredentials,
  sealApprovedToken:v.sealApprovedToken,
  loadSealedApprovedToken:v.loadSealedApprovedToken,
  verifyRootPreflight:async()=>{
   assertSidecarProcess();
   // Calls the real guarded O_NOFOLLOW root-owned 20-file and 4-owner
   // attestation. A missing file/mode/SHA fails even before NO-GO evidence.
   const proof=attestation.inspect();
   return incompletePreflight(proof);
  },
  readConsumedEvidence:async()=>{
   fail('trusted_consumed_ledger_reader_missing_no_execution');
  },
  launchPinnedRootRunner:async()=>{
   fail('approved_root_launcher_missing_no_execution');
  }
 });
 check(Object.keys(capabilities).join('|')===CAPABILITIES.join('|')&&
  Object.values(capabilities).every(fn=>typeof fn==='function'),
  'capability_surface_changed');
 return capabilities;
}
function readiness(){
 return Object.freeze({
  project:'honartik',schema:'prhm.registry-v2.root-capability-readiness.v1',
  transport_implemented_in_source:true,
  sealed_token_vault_implemented_in_source:true,
  all_nine_http_functions_present:true,
  operational:false,approval_enabled:false,
  production_installed:false,can_register:false,
  blockers:MISSING
 });
}
module.exports=Object.freeze({CAPABILITIES,MISSING,readiness,
 incompletePreflight,createRootCapabilities});
