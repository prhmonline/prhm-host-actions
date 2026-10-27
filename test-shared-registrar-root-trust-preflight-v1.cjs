'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./shared-registrar-root-trust-preflight-v1.cjs');

function baseline(){
 return {
  schema_version:'prhm.approval-policy.v1',
  version:'existing-live-policy',
  default_deny:true,scope_freeze:true,
  operations:{'host_action.existing_action_v1':{
   level:4,risk:'critical',one_time_use:true,secret:'unchanged-fixture'
  }},
  typed_scopes:[{
    action:'existing_action_v1',operation:'host_action.existing_action_v1',
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  }],
  unrelated_protected_live_field:{never:'discard',nested:{protected:true}}
 };
}
test('policy proposal adds exactly one L4 operation/scope without mutating live',()=>{
 const live=baseline(),pre=JSON.stringify(live);
 const output=m.buildPolicyCandidate(live);
 assert.equal(JSON.stringify(live),pre);
 assert.equal(output.installationAuthorized,false);
 assert.equal(output.mode,'SOURCE_ONLY_REVIEW');
 assert.equal(Object.keys(output.candidatePolicy.operations).length,
   Object.keys(live.operations).length+1);
 assert.equal(output.candidatePolicy.typed_scopes.length,live.typed_scopes.length+1);
 assert.deepEqual(output.candidatePolicy.typed_scopes[0],live.typed_scopes[0]);
 assert.deepEqual(output.candidatePolicy.unrelated_protected_live_field,
   live.unrelated_protected_live_field);
 const newAction=output.candidatePolicy.operations[m.OPERATION];
 assert.equal(newAction.level,4);
 assert.equal(newAction.risk,'critical');
 assert.equal(newAction.one_time_use,true);
 assert.equal(newAction.requires_second_confirmation,true);
 assert.equal(newAction.expires_seconds,180);
 assert.equal(output.requiresReviewedRootAdapter,true);
 assert.equal(output.requiresNativeSingleUseL4,true);
 assert.equal(output.requiresAtomicBackupRollback,true);
});
test('policy change fails closed when guard or registry has drifted',()=>{
 const altered=[
  x=>{x.scope_freeze=false},
  x=>{x.default_deny=false},
  x=>{x.operations[m.OPERATION]={level:3}},
  x=>{x.typed_scopes.push({action:m.ACTION})},
  x=>{x.schema_version='wrong'},
  x=>{x.typed_scopes={}}
 ];
 for(const mutate of altered){
  const b=baseline();mutate(b);
  assert.throws(()=>m.buildPolicyCandidate(b),/registrar_bootstrap_/);
 }
});
test('canonical five-field source+manifest binding is order independent',()=>{
 const a={
  action:m.ACTION,project:'pbcinema',
  source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),
  manifest_sha256:'c'.repeat(64)
 };
 const b={manifest_sha256:a.manifest_sha256,
  manifest_commit:a.manifest_commit,
  source_commit:a.source_commit,
  project:a.project,action:a.action};
 assert.equal(m.fiveFieldBinding(a),m.fiveFieldBinding(b));
 assert.notEqual(m.fiveFieldBinding(a),
  m.fiveFieldBinding({...a,project:'honartik'}));
 assert.notEqual(m.fiveFieldBinding(a),
  m.fiveFieldBinding({...a,manifest_commit:'d'.repeat(40)}));
 assert.throws(()=>m.fiveFieldBinding({...a,command:'id'}),/registry_gateway_/);
});
test('preflight cannot accept unverified operator-provided metadata',()=>{
 const empty={live:{},backups:{},services:{},
  sourceCommit:m.RELEASE_COMMIT};
 assert.throws(()=>m.checkPreflightRecords(empty),/registrar_bootstrap_/);
 assert.throws(()=>m.checkPreflightRecords({...empty,
  sourceCommit:'a'.repeat(40)}),/registrar_bootstrap_preflight_input/);
 const fakeLive=Object.fromEntries(Object.entries(m.OWNERS).map(
  ([id,rec])=>[id,{path:rec.path,regular:true,symlink:false,realpath:rec.path,
   uid:0,gid:0,mode:0o644,bytes:Buffer.from('fabricated')}]));
 const fakeBackup=Object.fromEntries(Object.keys(m.OWNERS).map(
  id=>[id,{path:m.BACKUP_DIR+'/'+id+'.bak',bytes:Buffer.from('fabricated')}]));
 const allActive=Object.fromEntries(m.SERVICES.map(name=>[name,'active']));
 assert.throws(()=>m.checkPreflightRecords({
  live:fakeLive,backups:fakeBackup,services:allActive,
  sourceCommit:m.RELEASE_COMMIT
 }),/registrar_bootstrap_live_sha_drift/);
});
test('no installer, signer or privileged mutation entrypoint exposed',()=>{
 assert.equal(Object.isFrozen(m),true);
 assert.equal(Object.isFrozen(m.OWNERS),true);
 for(const k of ['install','apply','sign','consumeApproval','writeFile',
                   'exec','shell','restart','rootBootstrap']){
  assert.equal(k in m,false);
 }
 assert.deepEqual(Object.keys(m.OWNERS).sort(),
  ['base','executor','mcp','policy']);
 assert.equal(m.BACKUP_DIR,
  '/var/backups/prhm-host-actions-registration/preinstall.EHclsBk3');
});
