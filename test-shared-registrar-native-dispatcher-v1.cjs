'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const d=require('./shared-registrar-native-dispatcher-v1.cjs');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const g=require('./prhm-action-registry-gateway-v1.cjs');

const uuid='44444444-4444-4444-8444-444444444444';
const args=()=>({action:g.ACTION,project:'pbcinema',
 source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),
 manifest_sha256:'c'.repeat(64)});
function issuer(input,time){
 return {
  schema_version:'prhm.approval-request.v2',request_id:uuid,
  status:'pending',action:g.ACTION,operation:g.OPERATION,
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',principal_id:'mohammad',role:'mcp-operator',
  level:4,risk:'critical',one_time_use:true,
  policy_version:g.POLICY_VERSION,policy_hash:'f'.repeat(64),
  arguments_sha256:g.approvalBindingSha(input),
  request_hash:g.approvalBindingSha(input),
  expires_at:new Date(time+90000).toISOString(),
  rollback_reference:bridge.typedApprovalRequest(input).rollback_reference
 };
}
const command=()=>({request_id:uuid,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'});
test('registered action is fixed, no standalone CLI/installer',()=>{
 assert.equal(d.ACTION,'prhm_action_registry_install_v1');
 assert.deepEqual(d.INPUT_FIELDS,
  ['action','project','source_commit','manifest_commit','manifest_sha256']);
 assert.deepEqual(d.EXEC_FIELDS,['request_id','second_confirmation']);
 assert.equal(Object.isFrozen(d),true);
 const res=cp.spawnSync(process.execPath,
  [path.join(__dirname,'shared-registrar-native-dispatcher-v1.cjs')],
  {encoding:'utf8'});
 assert.equal(res.status,64);
 assert.match(res.stderr,/NOT a standalone installer/);
});
test('existing legacy one-field request cannot be promoted to registrar request',()=>{
 const input=args();
 const request=d.prepareRequest(input);
 assert.equal(request.arguments_sha256,g.approvalBindingSha(input));
 assert.deepEqual(request.arguments,input);
 assert.equal(request.risk,'critical');
 assert.equal(request.ttl_seconds,180);
 for(const invalid of [
  {action:g.ACTION},
  {...input,command:'sh'},
  {...input,project:'../unknown'},
  {...input,source_commit:'HEAD'},
  {...input,manifest_sha256:'f'},
  {...input,approval_token:'caller-provided'}
 ])assert.throws(()=>d.prepareRequest(invalid),/registrar_dispatch_|registry_gateway_|typed_registry_/);
});
test('request issuer and native execute bind exact persistent Git tuple',()=>{
 const input=args(),now=Date.now();
 const stored=d.bindIssuedPending(input,issuer(input,now),now);
 assert.equal(stored.request_id,uuid);
 assert.equal(stored.source_commit,input.source_commit);
 assert.equal(stored.manifest_commit,input.manifest_commit);
 assert.equal(stored.manifest_sha256,input.manifest_sha256);
 assert.equal(stored.policy_version,g.POLICY_VERSION);
 assert.equal(stored.arguments_sha256,g.approvalBindingSha(input));
 assert.equal(Object.hasOwn(stored,'approval_token'),false);
 const execute=d.prepareExecute(stored,command(),now);
 assert.deepEqual(execute.arguments,input);
 assert.equal(execute.policy_hash,stored.policy_hash);
});
test('issuer cannot switch hashes, action, risk, version or expiry',()=>{
 const input=args(),now=Date.now(),correct=issuer(input,now);
 for(const change of [
  {arguments_sha256:'0'.repeat(64)},
  {request_hash:'0'.repeat(64)},
  {action:'unrelated_action'},
  {operation:'host_action.unrelated'},
  {level:3,risk:'high'},
  {status:'consumed'},
  {policy_version:'old-policy'},
  {one_time_use:false},
  {expires_at:new Date(now-100).toISOString()},
  {expires_at:new Date(now+300000).toISOString()}
 ])assert.throws(()=>d.bindIssuedPending(input,{...correct,...change},now),
  /typed_registry_/);
});
test('execute refuses caller-controlled arguments, replay, ID and confirmation drift',()=>{
 const input=args(),now=Date.now();
 const stored=d.bindIssuedPending(input,issuer(input,now),now);
 for(const bad of [
  {request_id:uuid},
  {...command(),action:g.ACTION},
  {...command(),source_commit:'a'.repeat(40)},
  {...command(),approval_token:'fabricated'},
  {...command(),second_confirmation:'CONFIRM_LEVEL_3_PRODUCTION'},
  {...command(),request_id:'55555555-5555-4555-8555-555555555555'}
 ])assert.throws(()=>d.prepareExecute(stored,bad,now),
  /registrar_dispatch_|typed_registry_/);
 for(const changed of [
  {...stored,status:'claimed'},
  {...stored,manifest_commit:'d'.repeat(40)},
  {...stored,policy_version:'old-policy'},
  {...stored,arguments_sha256:'e'.repeat(64)}
 ])assert.throws(()=>d.prepareExecute(changed,command(),now),
  /typed_registry_/);
 assert.throws(()=>d.prepareExecute(stored,command(),now+100000),
  /pending_execution_expired/);
});
test('root binding denies absent native trusted host capabilities',()=>{
 assert.throws(()=>d.createForExistingRootExecutor({}),
  /registrar_dispatch_(native_root_required|trusted_host_capabilities_missing)/);
 for(const key of ['issueApproval','sign','exec','shell','httpServer','bootstrap',
  'installStandalone','unrestrictedApply','approveSelf']){
  assert.equal(key in d,false);
 }
});
