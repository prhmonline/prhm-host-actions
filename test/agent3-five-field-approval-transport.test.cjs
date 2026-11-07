'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const frames=require('../ops/agent3-universal-backup/five-field-approval-transport.cjs');
const uuid='123e4567-e89b-42d3-a456-426614174000';
const args=()=>({action:gateway.ACTION,project:registration.PROJECT,
 source_commit:registration.SOURCE_COMMIT,
 manifest_commit:'f'.repeat(40),manifest_sha256:'a'.repeat(64)});
function fixture(){
 const input=args();
 const hash=gateway.approvalBindingSha(input);
 const expires_at=new Date(Date.now()+105000).toISOString();
 const issued={request:{request_id:uuid,action:gateway.ACTION,arguments_sha256:hash,
  level:4,risk:'critical',expires_at}};
 const persisted={request_id:uuid,status:'pending',expires_at,
  arguments:input,arguments_sha256:hash,request_hash:hash};
 const body={request_id:uuid,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',...input};
 const token='a'.repeat(130);
 const result={approval:{execution_authorized:true,request_id:uuid,
  action:gateway.ACTION,arguments_sha256:hash,request_hash:hash},
  approval_token:token};
 return {input,hash,issued,persisted,body,token,result};
}
test('five-field request frame is exact, immutable and not action-only',()=>{
 const f=fixture();
 const p=frames.requestFrame(f.input);
 assert.equal(p.method,'POST');
 assert.equal(p.path,'/v1/requests');
 assert.deepEqual(p.payload.arguments,f.input);
 assert.equal(p.payload.ttl_seconds,180);
 assert.equal(p.payload.arguments_sha256,f.hash);
 assert.equal(p.payload.operation,gateway.OPERATION);
 assert.equal(p.payload.rollback_reference,frames.ROLLBACK);
 assert.equal(frames.issuedResponse(f.input,f.issued).request_id,uuid);
 for(const wrong of [
  {action:gateway.ACTION},{...f.input,irrelevant:true},
  {...f.input,action:registration.INSTALL_ACTION},
  {...f.input,project:'honartik'},
  {...f.input,source_commit:'a'.repeat(40)}
 ])assert.throws(()=>frames.requestFrame(wrong));
});
test('issued request ID, type, risk, expiry and full five-field digest are bound',()=>{
 const f=fixture();
 const mods=[
  {request_id:'wrong'},
  {action:'harden_agent_api_v1'},
  {arguments_sha256:'e'.repeat(64)},
  {level:3},{risk:'high'},
  {expires_at:new Date(Date.now()-1000).toISOString()},
  {expires_at:new Date(Date.now()+600000).toISOString()}
 ];
 for(const m of mods){
  assert.throws(()=>frames.issuedResponse(f.input,{
   request:{...f.issued.request,...m}
  }),/issued_request_binding_invalid/);
 }
});
test('decision uses only fixed five-field digest and exact matching pending',()=>{
 const f=fixture();
 const d=frames.decisionFrame(f.body,f.persisted);
 assert.equal(d.path,'/v1/requests/'+uuid+'/decision');
 assert.equal(d.arguments_sha256,f.hash);
 assert.equal(d.payload.second_confirmation,'CONFIRM_LEVEL_4_CRITICAL');
 assert.equal(d.payload.rollback_reference,frames.ROLLBACK);
 assert.throws(()=>frames.decisionFrame({...f.body,note:'anything'},f.persisted));
 assert.throws(()=>frames.decisionFrame({...f.body,manifest_sha256:'b'.repeat(64)},f.persisted));
 assert.throws(()=>frames.decisionFrame({...f.body,second_confirmation:'CONFIRM_LEVEL_3_PRODUCTION'},f.persisted));
 assert.throws(()=>frames.decisionFrame({...f.body,request_id:'123e4567-e89b-42d3-a456-426614174999'},f.persisted));
 assert.throws(()=>frames.decisionFrame(f.body,{...f.persisted,status:'approved'}));
 assert.throws(()=>frames.decisionFrame(f.body,{...f.persisted,request_hash:'c'.repeat(64)}));
});
test('decision result cannot silently switch native request or hash',()=>{
 const f=fixture();
 const good=frames.decisionResponse(f.body,f.persisted,f.result);
 assert.equal(good.request_id,uuid);
 assert.equal(good.signed_approval_token,f.token);
 assert.equal(good.signed_receipt_verified,false);
 assert.equal(good.consumed,false);
 for(const a of [
  {request_id:'123e4567-e89b-42d3-a456-426614174999'},
  {arguments_sha256:'b'.repeat(64)},
  {request_hash:'b'.repeat(64)},
  {action:'other'},
  {execution_authorized:false}
 ])assert.throws(()=>frames.decisionResponse(f.body,f.persisted,{
  ...f.result,approval:{...f.result.approval,...a}
 }),/unbound_decision_or_missing_signed_token/);
 assert.throws(()=>frames.decisionResponse(f.body,f.persisted,{
  ...f.result,approval_token:'weak'
 }));
});
test('consume binding preserves five-field hash and never claims auth success',()=>{
 const f=fixture();
 const c=frames.consumptionFrame(f.body,f.persisted,f.token);
 assert.equal(c.validation.path,'/v1/validate');
 assert.equal(c.consumption.path,'/v1/consume');
 assert.equal(c.validation.payload.arguments_sha256,f.hash);
 assert.equal(c.validation.payload.operation,gateway.OPERATION);
 assert.equal(c.validation.payload.approval_token,f.token);
 assert.equal(c.consumption.payload.consumer,'prhm-agent-selfmaint-exec-host-actions-v2');
 assert.equal(c.signed_receipt_verified,false);
 assert.equal(c.ledger_verified,false);
 assert.equal(c.ready_to_dispatch,false);
 assert.throws(()=>frames.consumptionFrame(f.body,f.persisted,'not-signed'));
 assert.throws(()=>frames.consumptionFrame({...f.body,project:'shifa'},f.persisted,f.token));
});
test('cannot use transport as an independent approval or install CLI',()=>{
 const cmd=cp.spawnSync(process.execPath,[
  require('node:path').join(__dirname,'../ops/agent3-universal-backup/five-field-approval-transport.cjs'),'--apply'
 ],{encoding:'utf8',timeout:10000});
 assert.equal(cmd.status,78);
 assert.equal(cmd.stdout,'');
 assert.match(cmd.stderr,/no HTTP, request, consume or apply CLI/);
 for(const name of ['apply','install','execute','sign','submit','register','consume']){
  assert.equal(Object.prototype.hasOwnProperty.call(frames,name),false);
 }
});
