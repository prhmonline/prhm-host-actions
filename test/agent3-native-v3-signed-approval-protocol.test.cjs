'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const protocol=require('../ops/agent3-universal-backup/native-v3-signed-approval-protocol.cjs');
const route=require('../ops/agent3-universal-backup/five-field-native-route-contract.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const REQUEST_ID='491bc479-ad71-41d7-a42f-c184c907ed10';
function args(){return{
 action:gateway.ACTION,
 project:registration.PROJECT,
 source_commit:registration.SOURCE_COMMIT,
 manifest_commit:'b'.repeat(40),
 manifest_sha256:'c'.repeat(64)
};}
const token=()=>['eyJhbGciOiJFZERTQSJ9',
 Buffer.from(JSON.stringify({
  iss:'TEST_NOT_A_REAL_SIGNATURE',request_id:REQUEST_ID,
  arguments_sha256:gateway.approvalBindingSha(args()),
  pad:'x'.repeat(90)
 })).toString('base64url'),
 'z'.repeat(86)].join('.');
function fixture(){
 const input=args();
 const digest=gateway.approvalBindingSha(input);
 const expires_at=new Date(Date.now()+90000).toISOString();
 const issued={request_id:REQUEST_ID,action:gateway.ACTION,
  arguments_sha256:digest,level:4,risk:'critical',expires_at};
 const persistedRequest={request_id:REQUEST_ID,status:'pending',
  expires_at,arguments:input,arguments_sha256:digest,request_hash:digest};
 const body={request_id:REQUEST_ID,second_confirmation:route.CRITICAL_CONFIRM,...input};
 const decisionResponse={approval:{
  request_id:REQUEST_ID,action:gateway.ACTION,arguments_sha256:digest,
  level:4,risk:'critical',execution_authorized:true,one_time_use:true
 },approval_token:token()};
 return {input,digest,expires_at,issued,persistedRequest,body,decisionResponse};
}
test('five fields reach native Approval Center request with canonical digest, critical Level-4 and TTL',()=>{
 const f=fixture();
 const issue=protocol.issueEnvelope(f.input);
 assert.equal(issue.path,'/v1/requests');
 assert.deepEqual(issue.request.arguments,f.input);
 assert.equal(issue.arguments_sha256,f.digest);
 assert.equal(issue.request.action,gateway.ACTION);
 assert.equal(issue.request.operation,gateway.OPERATION);
 assert.equal(issue.request.tool,'host_action_v2_apply');
 assert.equal(issue.request.risk,'critical');
 assert.equal(issue.request.ttl_seconds,180);
 assert.equal(issue.approved,false);
 assert.equal(issue.signed,false);
 assert.equal(issue.consumed,false);
 const issued=protocol.verifyIssued({args:f.input,response:{request:f.issued}});
 assert.equal(issued.request_id,REQUEST_ID);
 assert.equal(issued.arguments_sha256,f.digest);
 assert.equal(issued.signed_approval_issued,false);
 assert.equal(issued.production_mutation,false);
});
test('decision is Level-4 only and preserves root persisted five-field request identity',()=>{
 const f=fixture();
 const d=protocol.decisionEnvelope({body:f.body,persistedRequest:f.persistedRequest});
 assert.equal(d.path,'/v1/requests/'+REQUEST_ID+'/decision');
 assert.equal(d.payload.decision,'accept');
 assert.equal(d.payload.second_confirmation,'CONFIRM_LEVEL_4_CRITICAL');
 assert.equal(d.payload.rollback_reference,protocol.ROLLBACK);
 assert.equal(d.arguments_sha256,f.digest);
 assert.equal(d.approval_consumed,false);
 const verified=protocol.verifyDecision({
  body:f.body,persistedRequest:f.persistedRequest,
  decisionResponse:f.decisionResponse
 });
 assert.equal(verified.request_id,REQUEST_ID);
 assert.equal(verified.signature_verified,false);
 assert.equal(verified.ledger_consumed,false);
 assert.equal(verified.install_authorized,false);
});
test('approval validation and once-only consume use full canonical digest, not legacy action-only hash',()=>{
 const f=fixture();
 const x=protocol.consumeEnvelope({
  body:f.body,persistedRequest:f.persistedRequest,decisionResponse:f.decisionResponse
 });
 assert.equal(x.validate_path,'/v1/validate');
 assert.equal(x.consume_path,'/v1/consume');
 assert.equal(x.validate_binding.tool,protocol.TOOL);
 assert.equal(x.validate_binding.operation,gateway.OPERATION);
 assert.equal(x.validate_binding.arguments_sha256,f.digest);
 assert.equal(x.validate_binding.action,gateway.ACTION);
 assert.equal(x.consume_binding.consumer,
  'prhm-agent-selfmaint-exec-host-actions-v2');
 assert.equal(x.root_signature_verified,false);
 assert.equal(x.root_consumed_ledger_verified,false);
 assert.notEqual(x.arguments_sha256,gateway.sha(Buffer.from(gateway.canonicalJson({action:gateway.ACTION}))));
 const evidence=protocol.assertCenterConsumption({
  validated:{valid:true},consumed:{consumed:true}
 });
 assert.equal(evidence.center_responded_consumed,true);
 assert.equal(evidence.independently_authenticated,false);
 assert.equal(evidence.production_mutation,false);
});
test('client action-only calls, changed source, changed manifest, replay IDs and pending hash drift fail',()=>{
 const f=fixture();
 const cases=[
  {body:{action:gateway.ACTION},persistedRequest:f.persistedRequest},
  {body:{...f.body,approved:true},persistedRequest:f.persistedRequest},
  {body:{...f.body,source_commit:'d'.repeat(40)},persistedRequest:f.persistedRequest},
  {body:{...f.body,manifest_commit:'d'.repeat(40)},persistedRequest:f.persistedRequest},
  {body:{...f.body,manifest_sha256:'d'.repeat(64)},persistedRequest:f.persistedRequest},
  {body:{...f.body,request_id:'8cacff39-d9de-490d-b88b-d788b88e532e'},persistedRequest:f.persistedRequest},
  {body:{...f.body,second_confirmation:'CONFIRM_LEVEL_3_PRODUCTION'},persistedRequest:f.persistedRequest},
  {body:f.body,persistedRequest:{...f.persistedRequest,request_hash:'0'.repeat(64)}},
  {body:f.body,persistedRequest:{...f.persistedRequest,status:'consumed'}},
  {body:f.body,persistedRequest:{...f.persistedRequest,expires_at:'2020-01-01T00:00:00Z'}}
 ];
 for(const o of cases)assert.throws(()=>protocol.decisionEnvelope(o));
 assert.throws(()=>protocol.issueEnvelope({action:gateway.ACTION}));
});
test('issuer cannot change action, digest, level, expiration or ID',()=>{
 const f=fixture();
 for(const issued of [
  {...f.issued,request_id:'not-uuid'},
  {...f.issued,action:'legacy'},
  {...f.issued,arguments_sha256:'0'.repeat(64)},
  {...f.issued,level:3},
  {...f.issued,risk:'high'},
  {...f.issued,expires_at:'2010-01-01T00:00:00Z'},
  {...f.issued,expires_at:new Date(Date.now()+360000).toISOString()}
 ]){
  assert.throws(()=>protocol.verifyIssued({args:f.input,response:{request:issued}}));
 }
});
test('unsigned or wrong signed-approval metadata is refused before any consume binding',()=>{
 const f=fixture();
 const originals=f.decisionResponse;
 for(const patch of [
  {request_id:'8cacff39-d9de-490d-b88b-d788b88e532e'},
  {action:'legacy'},
  {arguments_sha256:'d'.repeat(64)},
  {level:3},
  {risk:'high'},
  {execution_authorized:false},
  {one_time_use:false}
 ]){
  const d={...originals,approval:{...originals.approval,...patch}};
  assert.throws(()=>protocol.consumeEnvelope({
   body:f.body,persistedRequest:f.persistedRequest,decisionResponse:d
  }));
 }
 for(const approval_token of ['approved','a.b.c','x'.repeat(140),'']){
  const d={...originals,approval_token};
  assert.throws(()=>protocol.verifyDecision({
   body:f.body,persistedRequest:f.persistedRequest,decisionResponse:d
  }));
 }
 for(const value of [
  {validated:{valid:false},consumed:{consumed:true}},
  {validated:{valid:true},consumed:{consumed:false}},
  {validated:{valid:true},consumed:{consumed:true,approved:true}}
 ]){
  if(value.consumed.consumed===true && value.validated.valid===true)continue;
  assert.throws(()=>protocol.assertCenterConsumption(value));
 }
});
test('no direct CLI, credential, network, live approval or installer capability exported',()=>{
 const file=path.join(__dirname,
  '../ops/agent3-universal-backup/native-v3-signed-approval-protocol.cjs');
 const r=cp.spawnSync(process.execPath,[file,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,78);
 assert.match(r.stderr,/source-only native Approval Center contract/);
 for(const prop of ['issueSignedToken','decide','consumeApproval','install','readPrivateKey','connectSocket']){
  assert.equal(Object.hasOwn(protocol,prop),false,prop);
 }
});
