import test from 'node:test';
import assert from 'node:assert/strict';
import {createRootScriptsStageMediator,FIXED_BINDING,ARGUMENTS_SHA256} from '../../candidates/control-plane/control-plane-root-scripts-stage-mediator-v1.js';
const UUID='123e4567-e89b-42d3-a456-426614174000';
function harness(overrides={}){
 const calls=[];
 const request={request_id:UUID,status:'pending',level:4,action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,project:'control_plane',environment:'production',risk:'critical',arguments_sha256:ARGUMENTS_SHA256,expires_at:'2099-01-01T00:00:00Z'};
 const deps={
  createApprovalRequest:async body=>{calls.push(['request',body]);return{request}},
  getApprovalRequest:async id=>{calls.push(['status',id]);return{request}},
  decideApprovalRequest:async(id,body)=>{calls.push(['decision',id,body]);return{approval:{execution_authorized:true,action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,arguments_sha256:ARGUMENTS_SHA256,request_id:id},approval_token:'x'.repeat(64)}},
  approvalBridge:async(path,body)=>{calls.push([path,body]);return path==='/v1/validate'?{valid:true}:{consumed:true}},
  ...overrides
 };
 return {m:createRootScriptsStageMediator(deps),calls,request};
}
test('createRequest binds exact Level-4 scope and returns no token',async()=>{const{m,calls}=harness();const r=await m.createRequest();assert.equal(r.request_id,UUID);assert.equal('approval_token'in r,false);const b=calls[0][1];assert.deepEqual(b.arguments,{action:FIXED_BINDING.action});assert.equal(b.arguments_sha256,ARGUMENTS_SHA256);assert.equal(b.operation,FIXED_BINDING.operation);assert.equal(b.level,undefined);assert.equal(b.ttl_seconds,180)});
test('getStatus returns bounded metadata only',async()=>{const{m}=harness();const r=await m.getStatus({request_id:UUID});assert.deepEqual(Object.keys(r).sort(),['action','arguments_sha256','environment','expires_at','level','operation','project','request_id','risk','status'].sort());assert.equal(JSON.stringify(r).includes('token'),false)});
test('wrong confirmation fails before decision or stage',async()=>{let staged=false;const{m,calls}=harness();await assert.rejects(()=>m.applyApprovedRequest({request_id:UUID,second_confirmation:'NO'},async()=>{staged=true}),/critical_second_confirmation_required/);assert.equal(staged,false);assert.equal(calls.some(x=>x[0]==='decision'),false)});
test('request binding mismatch fails closed before decision',async()=>{const{m,calls}=harness({getApprovalRequest:async()=>({request:{request_id:UUID,status:'pending',level:4,action:'wrong',arguments_sha256:ARGUMENTS_SHA256}})});await assert.rejects(()=>m.applyApprovedRequest({request_id:UUID,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'},async()=>({ok:true})),/request_binding_mismatch/);assert.equal(calls.some(x=>x[0]==='decision'),false)});
test('validation failure prevents consume and stage',async()=>{let staged=false;const{m,calls}=harness({approvalBridge:async(path,body)=>{calls.push([path,body]);return path==='/v1/validate'?{valid:false}:{consumed:true}}});await assert.rejects(()=>m.applyApprovedRequest({request_id:UUID,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'},async()=>{staged=true}),/approval_validation_failed/);assert.equal(staged,false);assert.equal(calls.some(x=>x[0]==='/v1/consume'),false)});
test('consume failure prevents stage',async()=>{let staged=false;const{m}=harness({approvalBridge:async path=>path==='/v1/validate'?{valid:true}:{consumed:false}});await assert.rejects(()=>m.applyApprovedRequest({request_id:UUID,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'},async()=>{staged=true}),/approval_consume_failed/);assert.equal(staged,false)});
test('success order is decision validate consume stage and token never escapes',async()=>{const order=[];const{m}=harness({decideApprovalRequest:async(id,body)=>{order.push('decision');return{approval:{execution_authorized:true,action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,arguments_sha256:ARGUMENTS_SHA256,request_id:id},approval_token:'s'.repeat(64)}},approvalBridge:async path=>{order.push(path);return path==='/v1/validate'?{valid:true}:{consumed:true}}});const r=await m.applyApprovedRequest({request_id:UUID,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'},async()=>{order.push('stage');return{ok:true,staged:true}});assert.deepEqual(order,['decision','/v1/validate','/v1/consume','stage']);assert.deepEqual(r,{ok:true,staged:true});assert.equal(JSON.stringify(r).includes('ssss'),false)});
test('invalid request id rejected',async()=>{const{m}=harness();await assert.rejects(()=>m.getStatus({request_id:'bad'}),/invalid_request_id/)});
