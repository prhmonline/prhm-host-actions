'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('./prhm-action-registry-v2-trusted-base-capabilities-v1.cjs');
const A=require('./prhm-action-registry-v2-approval-http-adapter-v1.cjs');
const G=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const RELEASE=require('./manifests/honartik-config-center-registry-release-v2.json');

function mockedEvidence(){
 return {
  schema:'prhm.registry-v2.root-attestation.v1',
  project:'honartik',
  owner_shas:Object.fromEntries(Object.entries(RELEASE.registry_owners)
     .map(([k,v])=>[k,v.before_sha256])),
  staged_file_count:20,
  runtime_git_pins_verified:true,root_runner_source_attested:true,
  source_only:true,authorization:false,approval_route_installed:false
 };
}
test('provider interface matches exactly nine existing HTTP adapter capabilities',()=>{
 assert.deepEqual(C.CAPABILITIES,A.CAPABILITIES);
 assert.equal(C.CAPABILITIES.length,9);
 assert.deepEqual(Object.keys(C).sort(),
  ['CAPABILITIES','MISSING','readiness','incompletePreflight','createRootCapabilities'].sort());
 const r=C.readiness();
 assert.equal(r.operational,false);
 assert.equal(r.approval_enabled,false);
 assert.equal(r.can_register,false);
 assert.equal(r.production_installed,false);
 assert.equal(r.all_nine_http_functions_present,true);
 assert.equal(r.blockers.length,6);
 assert.ok(Object.isFrozen(r));
});
test('verified four-owner/root-blob evidence is insufficient to open approval',()=>{
 const state=C.incompletePreflight(mockedEvidence());
 assert.equal(state.ready,false);
 assert.equal(state.runtime_git_pins_verified,true);
 assert.equal(state.root_runner_attested,false);
 assert.equal(state.durable_recovery_verified,false);
 assert.equal(state.dual_worker_discovery_verified,false);
 assert.equal(state.signed_route_published,false);
 assert.deepEqual(Object.keys(state).sort(),
  ['ready','owner_shas','runtime_git_pins_verified','root_runner_attested',
   'durable_recovery_verified','dual_worker_discovery_verified',
   'signed_route_published','at_ms'].sort());
 assert.throws(()=>A.validatePreflight(state),/trusted_runtime_not_ready/);
});
test('missing/forged attestation cannot manufacture registered status',()=>{
 const e=mockedEvidence();
 for(const [key,value] of [
  ['project','other'],['staged_file_count',19],
  ['runtime_git_pins_verified',false],['root_runner_source_attested',false],
  ['authorization',true],['approval_route_installed',true],
  ['source_only',false]
 ]){
  const x={...e,[key]:value};
  assert.throws(()=>C.incompletePreflight(x),/root_attestation_result_invalid/,key);
 }
 const bad={...e,owner_shas:{base:'x'}};
 assert.throws(()=>C.incompletePreflight(bad),/owner_proof_incomplete/);
});
test('root process + separate root sidecar unit are required before any credentials or transport',()=>{
 assert.throws(()=>C.createRootCapabilities(),
  /root_uid_required|isolated_sidecar_unit_required/);
});
test('no request, decision, token sealing or token consumption occurs on incomplete preflight',async()=>{
 const callbacks=Object.fromEntries(A.CAPABILITIES.map(n=>[n,async()=>{throw Error('privileged_side_effect') }]));
 const used={calls:0};
 callbacks.verifyRootPreflight=async()=>{
  used.calls++;
  return C.incompletePreflight(mockedEvidence());
 };
 const h=A.createHandlers(callbacks);
 await assert.rejects(()=>h.dispatch('POST',A.URL.request,G.REQUEST),
   /trusted_runtime_not_ready/);
 assert.equal(used.calls,1);
 const requestCredentialAccess=callbacks.getApprovalCredentials;
 assert.equal(typeof requestCredentialAccess,'function');
});
