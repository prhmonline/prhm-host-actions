'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const route=require('../ops/agent3-universal-backup/five-field-native-route-contract.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');

const REQUEST_ID='7b45b09e-4ca2-46fa-9d3a-1c77c74dd055';
function input(){
 return {action:gateway.ACTION,project:registration.PROJECT,
  source_commit:registration.SOURCE_COMMIT,
  manifest_commit:'b'.repeat(40),manifest_sha256:'c'.repeat(64)};
}
function fixture(){
 const prepared=route.prepareRequest(input());
 const record={request_id:REQUEST_ID,status:'pending',
   expires_at:new Date(Date.now()+90000).toISOString(),...prepared.storage_shape};
 const body={request_id:REQUEST_ID,
  second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',...input()};
 return {prepared,record,body};
}
test('dedicated five-field request creates only a typed proposal, no approval',()=>{
 const q=route.prepareRequest(input());
 assert.equal(q.route,'prhm_action_registry_request_v1');
 assert.deepEqual(Object.keys(q.storage_shape).sort(),
  ['arguments','arguments_sha256','request_hash'].sort());
 assert.deepEqual(q.storage_shape.arguments,input());
 assert.equal(q.native_approval_proposal.arguments_sha256,gateway.approvalBindingSha(input()));
 assert.equal(q.native_approval_proposal.ttl_seconds,180);
 assert.equal(q.native_approval_proposal.operation,gateway.OPERATION);
 assert.equal(q.native_approval_proposal.project,'control_plane');
 assert.equal(q.native_approval_proposal.risk,'critical');
 assert.equal(q.request_created,false);
 assert.equal(q.approval_issued,false);
 assert.equal(q.approval_consumed,false);
 assert.equal(q.production_mutation,false);
});
test('native apply precheck requires pinned persisted request and Level-4 confirmation',()=>{
 const f=fixture();
 const q=route.prepareApply({body:f.body,persistedRequest:f.record});
 assert.equal(q.route,'prhm_action_registry_apply_v1');
 assert.equal(q.arguments_sha256,f.prepared.arguments_sha256);
 assert.deepEqual(q.arguments,input());
 assert.equal(q.ready_to_invoke_root_dispatch,false);
 assert.equal(q.signed_approval_verified,false);
 assert.equal(q.consumption_ledger_verified,false);
 assert.equal(q.production_mutation,false);
 assert.deepEqual(q.required_native_checks,[
  'READ_NATIVE_PERSISTED_PENDING_RECORD',
  'CHECK_NATIVE_CLOCK_EXPIRY',
  'VERIFY_AND_CONSUME_SIGNED_ONCE_ONLY_LEVEL4_APPROVAL',
  'DISPATCH_WITH_ROOT_CAPABILITIES_AND_FIXED_JOURNAL'
 ]);
});
test('action-only, extra fields and fake approval flags never produce trusted request',()=>{
 for(const bad of [
  {action:gateway.ACTION},
  {...input(),approved:true},
  {...input(),approval_token:'x'.repeat(120)},
  {...input(),project:'control_plane'},
  {...input(),source_commit:'a'.repeat(40)},
  {...input(),manifest_commit:'short'},
  {...input(),manifest_sha256:'x'.repeat(64)}
 ])assert.throws(()=>route.prepareRequest(bad));
});
test('apply rejects missing or altered five fields, bad status or false confirmation',()=>{
 const f=fixture();
 const negatives=[
  {body:{...f.body,second_confirmation:'CONFIRM_LEVEL_3_PRODUCTION'},record:f.record},
  {body:{...f.body,second_confirmation:'approved'},record:f.record},
  {body:{...f.body,manifest_commit:'d'.repeat(40)},record:f.record},
  {body:{...f.body,manifest_sha256:'d'.repeat(64)},record:f.record},
  {body:{...f.body,approved:true},record:f.record},
  {body:{...f.body,request_id:'bad'},record:f.record},
  {body:f.body,record:{...f.record,status:'used'}},
  {body:f.body,record:{...f.record,request_id:'91e70a47-f3b2-4926-a1e2-2d61011be383'}},
  {body:f.body,record:{...f.record,arguments_sha256:'0'.repeat(64)}},
  {body:f.body,record:{...f.record,request_hash:'0'.repeat(64)}},
  {body:f.body,record:{...f.record,approved:true}},
  {body:f.body,record:{...f.record,expires_at:'bad'}},
  {body:f.body,record:{...f.record,expires_at:'2020-01-01T00:00:00Z'}},
  {body:f.body,record:{...f.record,expires_at:new Date(Date.now()+360000).toISOString()}}
 ];
 for(const t of negatives)
  assert.throws(()=>route.prepareApply({body:t.body,persistedRequest:t.record}),
    undefined,JSON.stringify(t).slice(0,140));
});
test('native apply refuses fabricated local prechecks, caller-selected claim and fake JWS',async()=>{
 const f=fixture();
 const q=route.prepareApply({body:f.body,persistedRequest:f.record});
 await assert.rejects(
  route.applyFromTrustedNativeExecutor({precheck:{...q,ready_to_invoke_root_dispatch:true},
   approvalToken:'x'.repeat(120),rootCapabilities:{}}),
  /invalid_native_precheck/);
 await assert.rejects(
  route.applyFromTrustedNativeExecutor({precheck:q,
   approvalToken:'approved',rootCapabilities:{}}),
  /trusted_native_approval_and_capabilities_required/);
 await assert.rejects(
  route.applyFromTrustedNativeExecutor({precheck:q,
   approvalToken:'x'.repeat(140),
   rootCapabilities:{claimExecutionOnce:()=>({claimed:true})}}),
  /untrusted_execution_claim_override/);
 await assert.rejects(
  route.applyFromTrustedNativeExecutor({precheck:q,
   approvalToken:'x'.repeat(140),rootCapabilities:{}}),
  /trusted_capability_missing|typed_registry_/);
});
test('native module cannot register, install, mint approval or run as a CLI',()=>{
 const filename=path.join(__dirname,
  '../ops/agent3-universal-backup/five-field-native-route-contract.cjs');
 const res=cp.spawnSync(process.execPath,[filename,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(res.status,78);
 assert.match(res.stderr,/no standalone request/);
 assert.equal(typeof route.issueSignedApproval,'undefined');
 assert.equal(typeof route.createRegistryRoute,'undefined');
 assert.equal(typeof route.writeProductionFiles,'undefined');
});
