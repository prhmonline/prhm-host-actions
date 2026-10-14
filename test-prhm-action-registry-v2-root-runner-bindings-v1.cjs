'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const mod=require('./prhm-action-registry-v2-root-runner-bindings-v1.cjs');
const gate=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const FILE=path.join(__dirname,'prhm-action-registry-v2-root-runner-bindings-v1.cjs');
const request={...gate.REQUEST};
const approve=()=>({
 request_id:'12345678-1234-4234-8234-123456789abc',
 action:gate.REQUEST.action,operation:'host_action.'+gate.REQUEST.action,
 level:4,arguments_sha256:gate.ARGUMENTS_SHA
});
test('seven of exactly twelve real root bridge functions are bound; missing five cannot be spoofed',()=>{
 const i=mod.inventory();
 assert.equal(i.complete,false);
 assert.equal(i.standalone_executable,false);
 assert.equal(i.production_installed,false);
 assert.equal(i.BOUND,undefined);
 assert.equal(i.source_capabilities.length,7);
 assert.equal(i.required_capabilities.length,12);
 assert.equal(i.missing_capabilities.length,5);
 assert.deepEqual(i.missing_capabilities,[
  'getInstaller','getRollback','verifyOriginalState',
  'getToolDiscovery','writeMetadataAudit'
 ]);
 assert.throws(()=>bridge.attestExistingRoute(Object.fromEntries(
  i.source_capabilities.map(x=>[x,()=>true]))),
  /trusted_capability_missing_getInstaller/);
});
test('immutable Honartik request identity checked before any privileged IO',()=>{
 assert.equal(mod.identity(request).arguments_sha256,gate.ARGUMENTS_SHA);
 assert.throws(()=>mod.identity({...request,project:'other'}),
  /release_pin_mismatch_project/);
 assert.throws(()=>mod.identity({...request,source_commit:'0'.repeat(40)}),
  /release_pin_mismatch_source_commit/);
 assert.throws(()=>mod.identity({...request,arbitrary_path:'/tmp'}),
  /request_schema/);
});
test('production factory cannot run under an unrelated current process',()=>{
 assert.throws(()=>mod.createBoundSeven({
  input:request,approvalToken:'a'.repeat(130)
 }),/independent_transient_runner_required|root_required|ENOENT/);
});
function harness(){
 const counts={verify:0,claim:0,restart:0,health:0,reads:0};
 const proof=approve();
 const fake={
  'node:fs':{
   readFileSync:p=>{
    assert.equal(p,'/proc/self/cgroup');
    return '0::/system.slice/prhm-shared-registry-bootstrap-v2-fixed.service\n'
   }
  },
  './prhm-action-registry-v2-root-pinned-readers-v1.cjs':{
   readers:()=>Object.fromEntries([
    'readPinnedGitManifest','readPinnedGitSource','readLiveOwner',
    'readStagedAsset'].map(name=>[name,()=>{
      counts.reads++;return Buffer.from(name)
    }]))
  },
  './prhm-action-registry-v2-fixed-systemd-bridge-v1.cjs':{
   cgroupAttestation:(raw,uid)=>{
    assert.equal(uid,0);
    assert.match(raw,/prhm-shared-registry-bootstrap-v2-fixed.service/);
    return 'prhm-shared-registry-bootstrap-v2-fixed.service';
   },
   createFixedSystemdBridge:()=>({
    restartService:name=>{assert.equal(name,'prhm-agent-mcp-blue.service');counts.restart++;return true},
    checkServiceHealth:name=>{assert.equal(name,'prhm-agent-mcp-blue.service');counts.health++;return true}
   })
  },
  './prhm-action-registry-one-time-fence-v1.cjs':{
   reserveFromVerifiedApproval:x=>{
    counts.claim++;
    assert.deepEqual(Object.keys(x).sort(),['approval','args']);
    assert.equal(x.approval.request_id,proof.request_id);
    return {durable:true,exclusive:true,request_id:proof.request_id,
     arguments_sha256:gate.ARGUMENTS_SHA};
   }
  },
  './prhm-action-registry-v2-five-field-approval-gate-v1.cjs':gate,
  './prhm-action-registry-gateway-v1.cjs':{
   verifyLiveConsumedRegistrationApproval:({token,args})=>{
    counts.verify++;
    assert.equal(token,'a.b.c'.repeat(44));
    assert.equal(args.source_commit,request.source_commit);
    return proof;
   }
  },
  './prhm-action-registry-host-actions-v2-bridge-v1.cjs':bridge
 };
 const context={
  module:{exports:{}},exports:{},
  require:key=>{
   assert.ok(Object.hasOwn(fake,key),'unapproved dependency '+key);
   return fake[key]
  },
  process:{getuid:()=>0},
  Buffer,Error,Object,Array,Number,String
 };
 vm.runInNewContext(fs.readFileSync(FILE,'utf8'),context,{filename:FILE});
 return {binding:context.module.exports,counts,proof};
}
test('verified consumed L4 cannot restart a service before durable O_EXCL claim',async()=>{
 const h=harness(),cap=h.binding.createBoundSeven({
  input:request,approvalToken:'a.b.c'.repeat(44)
 });
 assert.equal(Object.keys(cap).length,7);
 assert.equal(h.counts.verify,1);
 assert.equal(h.counts.claim,0);
 assert.throws(()=>cap.restartService('prhm-agent-mcp-blue.service'),
  /durable_one_time_claim_required_before_systemd/);
 assert.equal(h.counts.restart,0);
 const bound={approval:h.proof,args:request};
 const receipt=await cap.claimOnce(bound);
 assert.equal(receipt.exclusive,true);
 assert.equal(receipt.durable,true);
 assert.equal(h.counts.claim,1);
 assert.equal(cap.restartService('prhm-agent-mcp-blue.service'),true);
 assert.equal(cap.checkServiceHealth('prhm-agent-mcp-blue.service'),true);
 assert.equal(h.counts.restart,1);
 assert.equal(h.counts.health,1);
 assert.throws(()=>bridge.attestExistingRoute(cap),
  /trusted_capability_missing_getInstaller/);
 await assert.rejects(()=>cap.claimOnce(bound),/duplicate_same_process_claim/);
 assert.equal(h.counts.claim,1);
});
test('fake claim object rejected with zero durable reservation or service mutations',async()=>{
 const h=harness(),cap=h.binding.createBoundSeven({
  input:request,approvalToken:'a.b.c'.repeat(44)
 });
 await assert.rejects(()=>cap.claimOnce({approval:{approved:true},args:request}),
  /claim_approval_not_independently_verified/);
 assert.equal(h.counts.claim,0);
 assert.equal(h.counts.restart,0);
});
