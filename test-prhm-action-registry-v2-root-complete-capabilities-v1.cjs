'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const gate=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const production=require('./prhm-action-registry-v2-root-complete-capabilities-v1.cjs');
const FILE=path.join(__dirname,'prhm-action-registry-v2-root-complete-capabilities-v1.cjs');
const input={...gate.REQUEST};
const id='12345678-1234-4234-8234-123456789abc';
function fixture(){
 const trace={claim:0,install:0,rollback:0,inspect:0};
 const proof={request_id:id,action:input.action,
  level:4,arguments_sha256:gate.ARGUMENTS_SHA};
 const target='honartik_config_center_readonly_enroll_v1';
 const frozenRelease={source_commit:input.source_commit,
  manifest_commit:input.manifest_commit,
  manifest_sha256:input.manifest_sha256};
 const stub={
  './prhm-action-registry-gateway-v1.cjs':{
   verifyLiveConsumedRegistrationApproval:({args})=>{
    assert.equal(args.source_commit,input.source_commit);return proof
   }
  },
  './prhm-action-registry-v2-five-field-approval-gate-v1.cjs':gate,
  './prhm-action-registry-host-actions-v2-bridge-v1.cjs':bridge,
  './prhm-action-registry-v2-root-runner-bindings-v1.cjs':{
   identity:args=>{assert.equal(args.manifest_sha256,input.manifest_sha256)},
   REQUIRED:bridge.attestExistingRoute(Object.fromEntries([
    'readPinnedGitManifest','readPinnedGitSource','readLiveOwner',
    'readStagedAsset','getInstaller','getRollback','claimOnce',
    'verifyOriginalState','restartService','checkServiceHealth',
    'getToolDiscovery','writeMetadataAudit'
   ].map(n=>[n,()=>true])))&&[
    'readPinnedGitManifest','readPinnedGitSource','readLiveOwner',
    'readStagedAsset','getInstaller','getRollback','claimOnce',
    'verifyOriginalState','restartService','checkServiceHealth',
    'getToolDiscovery','writeMetadataAudit'
   ],
   createBoundNine:()=>({
    readPinnedGitManifest:()=>true,readPinnedGitSource:()=>true,
    readLiveOwner:()=>true,readStagedAsset:()=>true,
    claimOnce:async()=>{trace.claim++;return {
     exclusive:true,durable:true,request_id:id}},
    verifyOriginalState:()=>true,restartService:()=>true,
    checkServiceHealth:()=>true,writeMetadataAudit:()=>true
   })
  },
  './honartik-config-center-atomic-registration-installer-v1.cjs':{
   executeAfterSharedRegistryApproval:async args=>{
    trace.install++;
    assert.equal(args.args.source_commit,input.source_commit);
    return {ok:true,rollback:'not_needed',installedAssets:5,updatedOwners:4};
   }
  },
  './prhm-action-registry-v2-root-recovery-io-v1.cjs':{
   createRecovery:args=>{
    trace.rollback++;
    assert.equal(args.requestId,id);
    assert.equal(args.approvalToken,'token');
    return {readonlyPreflight:async()=>({ok:true}),
     recover:async()=>({verified:true,restored:true,request_id:id,steps:1})};
   }
  },
  './prhm-action-registry-v2-root-live-mcp-v1.cjs':{
   createDiscovery:()=>({
    getToolDiscovery:async action=>{
     trace.inspect++;assert.equal(action,target);return true
    }
   })
  }
 };
 const ctx={module:{exports:{}},exports:{},Buffer,Object,Error,Array,
  require:key=>{assert.ok(Object.hasOwn(stub,key),'unreviewed require '+key);return stub[key]}};
 vm.runInNewContext(fs.readFileSync(FILE,'utf8'),ctx,{filename:FILE});
 return {fn:ctx.module.exports,trace,input,proof,frozenRelease,target};
}
test('complete source has exactly twelve reviewed functions and never executes standalone',()=>{
 const report=production.status();
 assert.equal(report.source_functions,12);
 assert.equal(report.required_functions,12);
 assert.equal(report.root_launcher_installed,false);
 assert.equal(report.can_run_standalone,false);
 assert.equal(report.authenticated_discovery_verified_on_host,false);
 assert.throws(()=>production.createBoundTwelve({
  input,approvalToken:'invalid'}),/signed_token_missing|root_required|independent_transient_runner_required|ENOENT/);
});
test('all three real extension callbacks are blocked until a durable claim',async()=>{
 const h=fixture(),cap=h.fn.createBoundTwelve({
  input:h.input,approvalToken:'token'
 });
 assert.equal(Object.keys(cap).length,12);
 bridge.attestExistingRoute(cap);
 const ins=cap.getInstaller(h.target);
 const rollback=cap.getRollback(h.target);
 assert.throws(()=>cap.getInstaller('other'),/reviewed_installer_unavailable/);
 await assert.rejects(()=>ins({args:h.input}),/durable_claim_required_before_host_action/);
 await assert.rejects(()=>rollback({
  release:h.frozenRelease,approval:h.proof
 }),/durable_claim_required_before_host_action/);
 await assert.rejects(()=>cap.getToolDiscovery(h.target),
  /durable_claim_required_before_host_action/);
 assert.deepEqual(h.trace,{claim:0,install:0,rollback:0,inspect:0});
 await cap.claimOnce({approval:h.proof,args:h.input});
 assert.equal(h.trace.claim,1);
 const result=await ins({args:h.input});
 assert.equal(result.ok,true);
 const restored=await rollback({
  release:h.frozenRelease,approval:h.proof
 });
 assert.equal(restored.verified,true);
 assert.equal(await cap.getToolDiscovery(h.target),true);
 assert.deepEqual(h.trace,{claim:1,install:1,rollback:1,inspect:1});
 await assert.rejects(()=>cap.claimOnce({approval:h.proof,args:h.input}),
  /duplicate_claim/);
});
test('rollback refuses caller approval and release drift, no cold recovery attempts',async()=>{
 const h=fixture(),cap=h.fn.createBoundTwelve({
  input:h.input,approvalToken:'token'
 });
 await cap.claimOnce({});
 const rollback=cap.getRollback(h.target);
 await assert.rejects(()=>rollback({
  approval:{request_id:id},release:{...h.frozenRelease,source_commit:'0'.repeat(40)}
 }),/rollback_release_or_approval_drift/);
 assert.equal(h.trace.rollback,0);
});
