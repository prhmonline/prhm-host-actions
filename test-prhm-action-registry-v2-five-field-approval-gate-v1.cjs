'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const g=require('./prhm-action-registry-gateway-v1.cjs');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const P=require('./manifests/honartik-shared-registry-pinned-release-v2.json');
const REQ=F.REQUEST;
const ID='11111111-1111-4111-8111-111111111111';
const aid='22222222-2222-4222-8222-222222222222';
function record(extra={}){return {
 request_id:ID,action:g.ACTION,project:'control_plane',
 operation:g.OPERATION,environment:'production',
 arguments_sha256:F.ARGUMENTS_SHA,level:4,status:'pending',
 expires_at:new Date(Date.now()+60000).toISOString(),...extra
}}
function receipt(overrides={}){
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const pub=publicKey.export({type:'spki',format:'pem'});
 const kid=g.sha(publicKey.export({type:'spki',format:'der'})).slice(0,16);
 const now=Math.floor(Date.now()/1000);
 const claims={
  approval_id:aid,request_id:ID,jti:aid,iss:'prhm-company-approval',
  action:g.ACTION,operation:g.OPERATION,project:'control_plane',
  environment:'production',tool:'host_action_v2_apply',
  principal_id:'mohammad',role:'mcp-operator',level:4,risk:'critical',
  decision:'accept',one_time_use:true,policy_version:g.POLICY_VERSION,
  policy_hash:'f'.repeat(64),
  arguments_sha256:F.ARGUMENTS_SHA,request_hash:F.ARGUMENTS_SHA,
  nbf:now-10,iat:now-10,exp:now+120,...overrides
 };
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
 const encoded=[header,claims].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
 const sig=crypto.sign(null,Buffer.from(encoded),privateKey).toString('base64url');
 const ledger={schema_version:'prhm.approval-consumption.v1',
  approval_id:aid,request_id:ID,work_order_id:null,project_id:'control_plane',
  operation:g.OPERATION,request_hash:F.ARGUMENTS_SHA,
  consumed_at:new Date((now-5)*1000).toISOString(),
  consumer:F.CONSUMER,consumption_hash:null};
 ledger.consumption_hash=g.sha(Buffer.from(JSON.stringify(ledger)));
 return {token:encoded+'.'+sig,publicKey:pub,ledger,nowSec:now};
}
test('immutable five-field identity maps to the V2 Git release and canonical SHA',()=>{
 assert.deepEqual(Object.keys(REQ).sort(),F.KEYS.slice().sort());
 assert.equal(REQ.source_commit,P.source_commit);
 assert.equal(REQ.manifest_commit,P.manifest_commit);
 assert.equal(REQ.manifest_sha256,P.release_manifest_sha256);
 assert.equal(g.approvalBindingSha(REQ),F.ARGUMENTS_SHA);
 assert.equal(P.approval_arguments_sha256,F.ARGUMENTS_SHA);
 const body=F.requestEnvelope({...REQ});
 assert.equal(body.arguments_sha256,F.ARGUMENTS_SHA);
 assert.deepEqual(body.arguments,{...REQ});
 assert.equal(body.ttl_seconds,180);
 assert.equal(body.operation,'host_action.prhm_action_registry_install_v1');
 assert.equal(body.rollback_reference,
  'host-action-v2:prhm-action-registry-install-v1:verified-four-owner-restore');
});
test('action-only legacy API, extra fields or every changed immutable pin fail closed',()=>{
 for(const item of [
  {action:g.ACTION},{...REQ,project:'moeinshow'},
  {...REQ,source_commit:'1'.repeat(40)},
  {...REQ,manifest_commit:'2'.repeat(40)},
  {...REQ,manifest_sha256:'3'.repeat(64)},
  {...REQ,action:'other_action'},
  {...REQ,command:'rm -rf /'},Object.create(null)
 ])assert.throws(()=>F.requestEnvelope(item),/registry_v2_five_field_|typed_registry_/);
});
test('explicit second confirmation binds to a trusted pending unexpired request',()=>{
 const x=F.confirmEnvelope({...REQ,request_id:ID,second_confirmation:F.CONFIRM},record());
 assert.equal(x.request_id,ID);
 assert.equal(x.arguments_sha256,F.ARGUMENTS_SHA);
 assert.equal(x.decision.decision,'accept');
 assert.equal(x.decision.second_confirmation,F.CONFIRM);
 assert.equal(x.decision.rollback_reference.includes('verified-four-owner-restore'),true);
});
test('untrusted, mismatched, expired or already consumed request cannot be approved',()=>{
 const msg={...REQ,request_id:ID,second_confirmation:F.CONFIRM};
 for(const wrong of [
  {request_id:'33333333-3333-4333-8333-333333333333'},
  {action:'legacy_action'},{arguments_sha256:'a'.repeat(64)},
  {status:'approved'},{status:'consumed'},{level:3},
  {project:'other'}, {operation:'host_action.other'},
  {environment:'staging'},{expires_at:new Date(Date.now()-5000).toISOString()}
 ])assert.throws(()=>F.confirmEnvelope(msg,record(wrong)),
  /registry_v2_five_field_/);
 for(const invalid of [
  {...msg,second_confirmation:'YES'},
  {...msg,request_id:'not-a-uuid'},
  {...msg,manifest_sha256:'5'.repeat(64)},
  {...msg,note:'skip approval'}
 ])assert.throws(()=>F.confirmEnvelope(invalid,record()),
  /registry_v2_five_field_/);
});
test('validation and one-time consumption preserve exactly five-field SHA and consumer',()=>{
 const fixture=receipt();
 const data=F.authorizeConsumeEnvelope({...REQ,approval_token:fixture.token});
 assert.equal(data.validation.arguments_sha256,F.ARGUMENTS_SHA);
 assert.equal(data.consumption.arguments_sha256,F.ARGUMENTS_SHA);
 assert.equal(data.consumption.consumer,F.CONSUMER);
 assert.deepEqual(data.args,{...REQ});
 assert.deepEqual(Object.keys(data.consumption).sort(),
  [...Object.keys(data.validation),'consumer'].sort());
});
test('forged bearer strings, changed source pin, arbitrary fields cannot reach consumption',()=>{
 const token=receipt().token;
 for(const wrong of [
  {...REQ,approval_token:'approved'},
  {...REQ,approval_token:'a.b.c'},
  {...REQ,approval_token:token,project:'moeinshow'},
  {...REQ,approval_token:token,manifest_commit:'f'.repeat(40)},
  {...REQ,approval_token:token,request_id:ID},
  {...REQ,approval_token:token,command:'bash'}
 ])assert.throws(()=>F.authorizeConsumeEnvelope(wrong),
  /registry_v2_five_field_/);
});
test('real Ed25519 signature and persisted consumed-ledger SHA verify on exact V2',()=>{
 const f=receipt();
 const verified=F.verifyConsumedCryptographically(f);
 assert.equal(verified.request_id,ID);
 assert.equal(verified.arguments_sha256,F.ARGUMENTS_SHA);
 assert.equal(verified.level,4);
});
test('expired/fake/wrong-policy signed claims and unconsumed ledger fail closed',()=>{
 const valid=receipt();
 assert.throws(()=>F.verifyConsumedCryptographically({...valid,token:'approved'}),
  /registry_gateway_signed_token/);
 assert.throws(()=>F.verifyConsumedCryptographically({...valid,
  ledger:{...valid.ledger,consumption_hash:'0'.repeat(64)}}),
  /registry_gateway_consumption_ledger/);
 for(const changed of [
  {exp:Math.floor(Date.now()/1000)-5},
  {arguments_sha256:'f'.repeat(64)},
  {project:'moeinshow'},{policy_version:'old-policy'},
  {level:3},{one_time_use:false}
 ]){
  const f=receipt(changed);
  assert.throws(()=>F.verifyConsumedCryptographically(f),
   /registry_gateway_signed_l4_binding/);
 }
});
test('no execution, signer or network API is published by approval gate',()=>{
 for(const name of ['request','confirm','consume','apply','execute','sign',
  'rollback','install','startServer','listen','approve','readSecret','writeFile'])
  assert.equal(Object.hasOwn(F,name),false);
});
