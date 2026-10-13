'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const g=require('./prhm-action-registry-gateway-v1.cjs');
function env(kind='success'){
 const state={installed:false,install:0,rollback:0,verified:0,audit:[],discover:0};
 const release={normalized:{project:'honartik',action:'honartik_config_center_readonly_enroll_v1',
   assets:[{path:'/opt/prhm-agent-selfmaint-exec/actions/fixture.cjs'}]},
   source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),
   manifest_sha256:'1'.repeat(64)};
 const approval={level:4,risk:'critical',request_id:'11111111-1111-4111-8111-111111111111'};
 const callbacks={
  release,approval,
  trustedInstaller:async()=>{
    state.install++;state.installed=true;
    if(kind==='installer')throw Error('installer_error');
    return {ok:true,rollback:'not_needed',installedAssets:1,updatedOwners:4};
  },
  trustedRollback:async()=>{
    state.rollback++;
    if(kind==='rollback')throw Error('rollback_error');
    state.installed=false;return {verified:true};
  },
  verifyOriginalState:async()=>{state.verified++;return !state.installed;},
  readInstalledTool:async()=>{
    state.discover++;return kind!=='discovery';
  },
  audit:async x=>{
    state.audit.push(x);
    if(kind==='audit'&&x.result==='registered')throw Error('audit_error');
  }
 };
 return {state,callbacks};
}
test('success: one installer, discovery and durable metadata audit; no rollback',async()=>{
 const {state,callbacks}=env();
 const r=await g.finalizeVerifiedInstall(callbacks);
 assert.equal(r.ok,true);assert.equal(r.registry_visible,true);
 assert.equal(state.install,1);assert.equal(state.rollback,0);
 assert.equal(state.audit.length,1);
 assert.equal(state.audit[0].result,'registered');
});
for(const phase of ['discovery','audit']){
 test(phase+' failure restores exact initial state and logs verified rollback',async()=>{
  const {state,callbacks}=env(phase);
  await assert.rejects(g.finalizeVerifiedInstall(callbacks),/failed_rollback_verified/);
  assert.equal(state.install,1);assert.equal(state.rollback,1);
  assert.equal(state.installed,false);
  assert.equal(state.verified,2);
  assert.equal(state.audit.at(-1).rollback,'verified');
 });
}
test('install exception cannot masquerade as success; original state restored',async()=>{
 const {state,callbacks}=env('installer');
 await assert.rejects(g.finalizeVerifiedInstall(callbacks),/failed_rollback_verified/);
 assert.equal(state.install,1);assert.equal(state.rollback,1);
 assert.equal(state.installed,false);
});
test('rollback failure is a hard stop, never a claim of safe restoration',async()=>{
 const {state,callbacks}=env('rollback');
 const f={...callbacks,readInstalledTool:async()=>false};
 await assert.rejects(g.finalizeVerifiedInstall(f),/rollback_unverified/);
 assert.equal(state.install,1);assert.equal(state.rollback,1);
 assert.equal(state.installed,true);
 assert.equal(state.audit.length,0);
});
test('refuse any missing rollback callback before invoking installer',async()=>{
 const {state,callbacks}=env();
 await assert.rejects(g.finalizeVerifiedInstall({...callbacks,trustedRollback:null}),
  /trusted_rollback_capabilities_missing/);
 assert.equal(state.install,0);
});
test('direct entry rejects absent rollback capability before token verification',async()=>{
 const {state,callbacks}=env();
 const args={action:g.ACTION,project:callbacks.release.normalized.project,
  source_commit:callbacks.release.source_commit,
  manifest_commit:callbacks.release.manifest_commit,
  manifest_sha256:callbacks.release.manifest_sha256};
 await assert.rejects(g.executeAfterTrustedAuthorization({
  release:callbacks.release,args,signedApprovalToken:'fake',
  trustedInstaller:callbacks.trustedInstaller,readInstalledTool:callbacks.readInstalledTool,
  audit:callbacks.audit
 }),/trusted_rollback_capabilities_missing/);
 assert.equal(state.install,0);
});
