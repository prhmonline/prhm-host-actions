'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const source=require('../ops/agent3-universal-backup/native-five-field-executor-v3-handlers.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const route=require('../ops/agent3-universal-backup/five-field-native-route-contract.cjs');

const requestId='f1234567-1234-4123-8123-123456789abc';
const input=Object.freeze({
 action:registration.REGISTRY_ACTION,
 project:registration.PROJECT,
 source_commit:registration.SOURCE_COMMIT,
 manifest_commit:'a'.repeat(40),
 manifest_sha256:'b'.repeat(64)
});
function issued(){
 const digest=route.prepareRequest(input).arguments_sha256;
 return {ok:true,request:{
  request_id:requestId,expires_at:new Date(Date.now()+60000).toISOString(),
  action:registration.REGISTRY_ACTION,arguments_sha256:digest,
  level:4,risk:'critical'
 },arguments_sha256:digest};
}
function prepared(){
 const r=issued();
 const body={...input,request_id:requestId,
  second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'};
 const persisted={...route.prepareRequest(input).storage_shape,
  request_id:requestId,status:'pending',expires_at:r.request.expires_at};
 return route.prepareApply({body,persistedRequest:persisted});
}
function receipt(){
 const p=prepared();
 return {ok:true,request_id:p.request_id,
  arguments_sha256:p.arguments_sha256,
  approval_token:'eyJhbGciOiJFZERTQSJ9.'+'a'.repeat(100)+'.'+'b'.repeat(88),
  consumed_by_approval_center:true,root_jws_verified:false};
}

test('fixed Executor routes do not alias legacy action-only API',()=>{
 assert.equal(source.REQUEST_PATH,'/v3/agent3-registry/request');
 assert.equal(source.EXECUTE_PATH,'/v3/agent3-registry/execute');
 assert.notEqual(source.REQUEST_PATH,source.EXECUTE_PATH);
 assert.notEqual(source.REQUEST_PATH,'/v2/host-actions/request');
});
test('valid Base issued identity is only a pending proposal',()=>{
 const r=source.assertIssueResponse({input,response:issued()});
 assert.equal(r.request_id,requestId);
 assert.equal(r.level,4);
 assert.equal(r.risk,'critical');
 assert.equal('approval_token' in r,false);
});
test('rejects altered issuer request ID, action, digest or risk',()=>{
 for(const change of [
  x=>{x.request.request_id='bad-id';},
  x=>{x.request.action='different_action';},
  x=>{x.arguments_sha256='0'.repeat(64);},
  x=>{x.request.arguments_sha256='0'.repeat(64);},
  x=>{x.request.risk='low';},
  x=>{x.request.level=3;},
  x=>{x.debug=true;}
 ]){
  const r=issued();change(r);
  assert.throws(()=>source.assertIssueResponse({input,response:r}));
 }
});
test('Base consumed receipt has NO independent root trust',()=>{
 const r=source.assertConsumedResponse({precheck:prepared(),response:receipt()});
 assert.equal(r.verified_by_root,false);
 assert.equal(r.ledger_verified_by_root,false);
 assert.match(r.token,/^eyJhbGci/);
});
test('rejects unbound or falsely privileged consumed receipts',()=>{
 const p=prepared();
 for(const change of [
  x=>{x.request_id='f1234567-1234-4123-8123-123456789abd';},
  x=>{x.arguments_sha256='f'.repeat(64);},
  x=>{x.root_jws_verified=true;},
  x=>{x.consumed_by_approval_center=false;},
  x=>{x.approval_token='a.b.c';},
  x=>{x.ok=false;},
  x=>{x.command='bash';}
 ]){
  const r=receipt();change(r);
  assert.throws(()=>source.assertConsumedResponse({precheck:p,response:r}));
 }
});
test('no native bindings means no privileged dispatch',()=>{
 assert.throws(()=>source.bindTrustedExecutor({}));
});
test('no standalone CLI root installer is exposed',()=>{
 const fs=require('node:fs');
 const p=require.resolve('../ops/agent3-universal-backup/native-five-field-executor-v3-handlers.cjs');
 const code=fs.readFileSync(p,'utf8');
 assert.match(code,/No standalone Executor v3 bootstrap/);
 assert.doesNotMatch(code,/\bexecSync\b|\bspawnSync\b|child_process/);
 assert.doesNotMatch(code,/https?:\/\//);
});
