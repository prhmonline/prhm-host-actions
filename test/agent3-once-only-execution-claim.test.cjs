'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const bridge=require('../prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const contract=require('../ops/agent3-universal-backup/registration-contract.cjs');
const adapter=require('../ops/agent3-universal-backup/trusted-shared-registrar-dispatch.cjs');
function fixture({failInstall=false,claimMode='exclusive'}={}){
 const input=Object.freeze({action:gateway.ACTION,project:'agent3',
  source_commit:contract.SOURCE_COMMIT,
  manifest_commit:'b'.repeat(40),manifest_sha256:'c'.repeat(64)});
 const digest=gateway.approvalBindingSha(input);
 const release=Object.freeze({
  normalized:{project:'agent3',action:contract.INSTALL_ACTION},
  source_commit:input.source_commit,manifest_commit:input.manifest_commit,
  manifest_sha256:input.manifest_sha256
 });
 const approval=Object.freeze({level:4,risk:'critical',operation:gateway.OPERATION,
  request_id:'11111111-1111-4111-8111-111111111111',
  arguments_sha256:digest,source_commit:input.source_commit,
  manifest_sha256:input.manifest_sha256});
 const state={installs:0,claims:0,requests:[],used:new Set()};
 const root={
  readPinnedGitManifest:()=>{throw Error('not needed for claim isolation')},
  readPinnedGitSource:()=>{throw Error('not needed for claim isolation')},
  readLiveOwner:()=>{throw Error('not needed for claim isolation')},
  readStagedAsset:()=>{throw Error('not needed for claim isolation')},
  getInstaller(a){
   assert.equal(a,contract.INSTALL_ACTION);
   return async()=>{state.installs++;if(failInstall)throw Error('installer_halted');return {ok:true};};
  },
  getRollback:()=>async()=>({verified:true}),
  verifyOriginalState:async()=>true,
  getToolDiscovery:async()=>true,
  writeMetadataAudit:async()=>{},
  async claimExecutionOnce(request){
   state.claims++;state.requests.push(request);
   const key=request.request_id+'|'+request.arguments_sha256;
   let claimed=false;
   if(!state.used.has(key)){state.used.add(key);claimed=true;}
   const result={claimed,durable:true,exclusive:true,
    request_id:request.request_id,arguments_sha256:request.arguments_sha256};
   if(claimMode==='no_durable')result.durable=false;
   if(claimMode==='wrong_digest')result.arguments_sha256='0'.repeat(64);
   if(claimMode==='malformed')result.extra='unsafe';
   if(claimMode==='always_false')result.claimed=false;
   return result;
  }
 };
 const capabilities=adapter.boundRootCapabilities(input,root);
 return {input,release,approval,state,root,capabilities,
  installer:capabilities.getInstaller(contract.INSTALL_ACTION)};
}
test('Agent 3 requires a root-provided exclusive durable claim; absent capability denies',()=>{
 const f=fixture();
 const {claimExecutionOnce,...missing}=f.root;
 assert.throws(()=>adapter.boundRootCapabilities(f.input,missing),
  /root_exclusive_claim_required/);
 assert.deepEqual(Object.keys(f.capabilities).sort(),[
  'readPinnedGitManifest','readPinnedGitSource','readLiveOwner','readStagedAsset',
  'getInstaller','getRollback','verifyOriginalState',
  'getToolDiscovery','writeMetadataAudit'].sort());
 assert.equal(typeof bridge.attestExistingRoute(f.capabilities).getInstaller,'function');
});
test('first verified request may execute exactly once; a replay cannot invoke installer',async()=>{
 const f=fixture();
 assert.deepEqual(await f.installer({approval:f.approval,release:f.release}),{ok:true});
 await assert.rejects(f.installer({approval:f.approval,release:f.release}),
  /durable_exclusive_execution_claim_denied/);
 assert.equal(f.state.installs,1);
 assert.equal(f.state.claims,2);
 assert.equal(f.state.requests[0].target_action,contract.INSTALL_ACTION);
 assert.equal(f.state.requests[0].action,gateway.ACTION);
 assert.equal(f.state.requests[0].source_commit,contract.SOURCE_COMMIT);
 assert.equal(Object.hasOwn(f.state.requests[0],'token'),false);
});
test('two concurrent calls with the same request claim permit at most one installer execution',async()=>{
 const f=fixture();
 const outcomes=await Promise.allSettled([
  f.installer({approval:f.approval,release:f.release}),
  f.installer({approval:f.approval,release:f.release})
 ]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 assert.equal(f.state.installs,1);
});
test('failed installer retains consumed claim; restart/retry requires new signed request',async()=>{
 const f=fixture({failInstall:true});
 await assert.rejects(f.installer({approval:f.approval,release:f.release}),/installer_halted/);
 await assert.rejects(f.installer({approval:f.approval,release:f.release}),
  /durable_exclusive_execution_claim_denied/);
 assert.equal(f.state.installs,1);
});
test('unverified context cannot reach claim or installer',async()=>{
 for(const edit of [
  x=>{x.approval={...x.approval,arguments_sha256:'0'.repeat(64)};},
  x=>{x.approval={...x.approval,level:3};},
  x=>{x.approval={...x.approval,operation:'host_action.other'};},
  x=>{x.approval={...x.approval,request_id:'not-a-uuid'};},
  x=>{x.release={...x.release,manifest_commit:'a'.repeat(40)};},
  x=>{x.release={...x.release,normalized:{...x.release.normalized,project:'honartik'}};}
 ]){
  const f=fixture();edit(f);
  await assert.rejects(f.installer({approval:f.approval,release:f.release}),
   /unbound_verified_approval_context/);
  assert.equal(f.state.claims,0);
  assert.equal(f.state.installs,0);
 }
});
test('boolean, extra-key, non-durable or digest-swapped claim receipts fail closed',async()=>{
 for(const claimMode of ['no_durable','wrong_digest','malformed','always_false']){
  const f=fixture({claimMode});
  await assert.rejects(f.installer({approval:f.approval,release:f.release}),
   /durable_exclusive_execution_claim_denied/);
  assert.equal(f.state.installs,0);
 }
});
