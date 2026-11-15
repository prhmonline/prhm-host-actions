'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const b=require('./shared-registrar-approval-center-bridge-v1.cjs');
const g=require('./prhm-action-registry-gateway-v1.cjs');
const typed=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const UUID='66666666-6666-4666-8666-666666666666';
const args=()=>({action:g.ACTION,project:'pbcinema',
 source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),
 manifest_sha256:'c'.repeat(64)});
const command=()=>({request_id:UUID,
 second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',
 arguments:args(),arguments_sha256:g.approvalBindingSha(args()),
 policy_hash:'f'.repeat(64)});
const receipt=()=>({
 request_id:UUID,action:g.ACTION,level:4,risk:'critical',
 arguments_sha256:g.approvalBindingSha(args()),
 execution_authorized:true,one_time_use:true,
 policy_version:g.POLICY_VERSION,policy_hash:'f'.repeat(64)
});
const consumed=()=>({consumed:true,consumption:{
 schema_version:'prhm.approval-consumption.v1',
 request_id:UUID,approval_id:'77777777-7777-4777-8777-777777777777',
 operation:g.OPERATION,request_hash:g.approvalBindingSha(args()),
 consumer:b.CONSUMER,consumption_hash:'a'.repeat(64)
}});
test('bridge is fixed and cannot be launched as a signer/installer',()=>{
 assert.equal(Object.isFrozen(b),true);
 assert.equal(b.ACTION,g.ACTION);
 assert.deepEqual(Object.keys(b).includes('sign'),false);
 assert.deepEqual(Object.keys(b).includes('createServer'),false);
 const p=cp.spawnSync(process.execPath,
  [path.join(__dirname,'shared-registrar-approval-center-bridge-v1.cjs')],
  {encoding:'utf8'});
 assert.equal(p.status,64);
 assert.match(p.stderr,/No standalone Approval Center bridge/);
});
test('typed Approval request must match exactly reviewed canonical five fields',()=>{
 const request=typed.typedApprovalRequest(args());
 assert.deepEqual(b.requestPayload(request),request);
 for(const invalid of [
  {...request,arguments:{action:g.ACTION}},
  {...request,ttl_seconds:600},
  {...request,rollback_reference:'fake'},
  {...request,arguments_sha256:'0'.repeat(64)},
  {...request,approval_token:'untrusted'},
  {...request,principal_id:'attacker'}
 ])assert.throws(()=>b.requestPayload(invalid),
  /registrar_approval_bridge_|registry_gateway_|typed_registry_/);
});
test('critical decision carries only signed request ID, fixed rollback and no user payload',()=>{
 const c=command();
 assert.deepEqual(b.decisionPayload(c),{
  decision:'accept',second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',
  rollback_reference:typed.typedApprovalRequest(args()).rollback_reference,
  note:'Reviewed fixed registrar transaction; critical L4'
 });
 const bind=b.consumptionBinding(c,'s'.repeat(120));
 assert.equal(bind.arguments_sha256,g.approvalBindingSha(args()));
 assert.equal(bind.consumer,undefined);
 assert.equal(bind.action,g.ACTION);
 for(const changed of [
  {...c,second_confirmation:'CONFIRM_LEVEL_3_PRODUCTION'},
  {...c,request_id:'not-uuid'},
  {...c,arguments_sha256:'0'.repeat(64)},
  {...c,arguments:{...args(),project:'honartik'}},
  {...c,command:'sh'},
  {...c,policy_hash:'foo'}
 ])assert.throws(()=>b.assertBoundCommand(changed),
  /registrar_approval_bridge_/);
});
test('no issued or consumed response can swap request/policy/argument identity',()=>{
 const c=command(),r=receipt();
 assert.equal(b.assertIssuedResponse(c,{approval:r,approval_token:'s'.repeat(120)}),
  's'.repeat(120));
 for(const changed of [
  {...r,request_id:'88888888-8888-4888-8888-888888888888'},
  {...r,policy_hash:'0'.repeat(64)},
  {...r,policy_version:'old'},
  {...r,level:3},
  {...r,arguments_sha256:'0'.repeat(64)},
  {...r,execution_authorized:false}
 ])assert.throws(()=>b.assertIssuedResponse(c,{
  approval:changed,approval_token:'s'.repeat(120)
 }),/registrar_approval_bridge_|typed_registry_/);
 assert.equal(b.assertConsumedResponse(c,consumed()),true);
 for(const changed of [
  {...consumed().consumption,request_id:'99999999-9999-4999-8999-999999999999'},
  {...consumed().consumption,request_hash:'0'.repeat(64)},
  {...consumed().consumption,consumer:'other'}
 ])assert.throws(()=>b.assertConsumedResponse(c,{
  consumed:true,consumption:changed
 }),/consumption_proof_mismatch/);
});
test('unsigned caller cannot instantiate privileged transport outside root',()=>{
 if(typeof process.getuid!=='function')return;
 if(process.getuid()!==0)
  assert.throws(()=>b.createForExistingTrustedHost({}),
   /root_required/);
 else
  assert.throws(()=>b.createForExistingTrustedHost({}),
   /trusted_host_transport_missing/);
});
test('root-only host adapter walks typed request decision validate consume in order',async t=>{
 if(process.getuid?.()!==0)return t.skip('requires isolated CI root process');
 const calls=[];
 const host={
  postTypedRequest:async payload=>{
   calls.push(['request',payload.arguments_sha256]);
   return {request:{action:g.ACTION,
    arguments_sha256:payload.arguments_sha256}};
  },
  postDecision:async(id,payload)=>{
   calls.push(['decision',id,payload.second_confirmation]);
   return {approval:receipt(),approval_token:'s'.repeat(120)};
  },
  postValidate:async payload=>{
   calls.push(['validate',payload.arguments_sha256]);
   return {valid:true};
  },
  postConsume:async payload=>{
   calls.push(['consume',payload.consumer]);
   return consumed();
  }
 };
 const adapter=b.createForExistingTrustedHost(host);
 const req=await adapter.requestTypedApproval(typed.typedApprovalRequest(args()));
 assert.equal(req.request.action,g.ACTION);
 const confirmation=await adapter.confirmAndConsumeBoundApproval(command());
 assert.equal(confirmation.approval_token,'s'.repeat(120));
 assert.deepEqual(calls.map(x=>x[0]),
  ['request','decision','validate','consume']);
 assert.equal(calls[1][1],UUID);
 assert.equal(calls[3][1],b.CONSUMER);
});
test('root-only denied validation never calls consume',async t=>{
 if(process.getuid?.()!==0)return t.skip('requires isolated CI root process');
 let consumes=0;
 const adapter=b.createForExistingTrustedHost({
  postTypedRequest:async()=>({}),
  postDecision:async()=>({approval:receipt(),approval_token:'s'.repeat(120)}),
  postValidate:async()=>({valid:false}),
  postConsume:async()=>{consumes++;return consumed()}
 });
 await assert.rejects(adapter.confirmAndConsumeBoundApproval(command()),
  /issuer_validation_denied/);
 assert.equal(consumes,0);
});
test('root-only wrong signed request ID does not validate or consume',async t=>{
 if(process.getuid?.()!==0)return t.skip('requires isolated CI root process');
 let validates=0,consumes=0;
 const adapter=b.createForExistingTrustedHost({
  postTypedRequest:async()=>({}),
  postDecision:async()=>({approval:{...receipt(),request_id:
   '99999999-9999-4999-8999-999999999999'},approval_token:'s'.repeat(120)}),
  postValidate:async()=>{validates++;return {valid:true}},
  postConsume:async()=>{consumes++;return consumed()}
 });
 await assert.rejects(adapter.confirmAndConsumeBoundApproval(command()),
  /issued_policy_or_request_mismatch/);
 assert.equal(validates,0);
 assert.equal(consumes,0);
});
