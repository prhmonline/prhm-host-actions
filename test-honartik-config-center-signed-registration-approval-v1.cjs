'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const verify=require('./honartik-config-center-signed-registration-approval-v1.cjs');
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const ID='22cb80dd-8a4d-42a9-ad17-96120547ef6d';
const REQ='eb7689ad-f6eb-4be0-9539-5fd273836d25';
const MANIFEST='b'.repeat(64),SOURCE='a'.repeat(40),NOW=1791878400;
const POLICY='2026-10-13.2-honartik-config-center-registration-bootstrap-v1';
const hash=verify.expectedArgsSha256(MANIFEST,SOURCE);
const kid=crypto.createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex').slice(0,16);
function token(claimOverrides={},key=privateKey,headerOverrides={}){
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid,...headerOverrides};
 const claims={
  iss:'prhm-company-approval',approval_id:ID,jti:ID,request_id:REQ,
  action:verify.ACTION,operation:verify.OPERATION,tool:'host_action_v2_apply',
  project:'control_plane',environment:'production',level:4,risk:'critical',
  decision:'accept',one_time_use:true,policy_version:POLICY,policy_hash:'c'.repeat(64),
  arguments_sha256:hash,request_hash:hash,
  iat:NOW-30,nbf:NOW-30,exp:NOW+120,...claimOverrides
 };
 const input=Buffer.from(JSON.stringify(header)).toString('base64url')+'.'+
  Buffer.from(JSON.stringify(claims)).toString('base64url');
 return input+'.'+crypto.sign(null,Buffer.from(input),key).toString('base64url');
}
function ledger(patches={}){
 return {schema_version:'prhm.approval-consumption.v1',approval_id:ID,
  request_id:REQ,operation:verify.OPERATION,request_hash:hash,
  consumed_at:new Date((NOW-10)*1000).toISOString(),consumer:'typed-executor',
  consumption_hash:'e'.repeat(64),...patches};
}
function verifyCase(jwt=token(),l=ledger(),manifest=MANIFEST,source=SOURCE,now=NOW,policy=POLICY){
 return verify.validateConsumedReceipt({
  token:jwt,publicKey,ledger:l,manifestSha:manifest,commitSha:source,
  nowSec:now,expectedPolicyVersion:policy
 });
}
test('genuine Ed25519 signed and consumed Level 4 only returns bounded metadata',()=>{
 const approved=verifyCase();
 assert.deepEqual(approved,{
  action:verify.ACTION,risk:'critical',level:4,verified_by_trusted_mediator:true,
  one_time_token_consumed:true,second_confirmation_valid:true,
  request_id:REQ,manifest_sha256:MANIFEST,source_commit_sha:SOURCE
 });
 assert.equal(JSON.stringify(approved).includes('approval_token'),false);
});
test('forged signature, key rotation or modified header never authorizes',()=>{
 const other=crypto.generateKeyPairSync('ed25519');
 for(const jwt of [
  token({level:4},other.privateKey),
  token({},privateKey,{alg:'HS256'}),
  token({},privateKey,{kid:'0'.repeat(16)}),
  token().slice(0,-3)+'aaa'
 ])assert.throws(()=>verifyCase(jwt));
});
test('incorrect one-time consumed ledger or missing evidence never authorizes',()=>{
 for(const item of [
  null,ledger({approval_id:REQ}),ledger({request_id:ID}),
  ledger({request_hash:'0'.repeat(64)}),
  ledger({operation:'host_action.other'}),
  ledger({consumer:'untrusted'}),
  ledger({consumed_at:'no date'}),
  ledger({consumption_hash:'not-a-hash'}),
  ledger({schema_version:'v0'})
 ])assert.throws(()=>verifyCase(token(),item));
});
test('changed manifest, commit, policy or signing arguments always block',()=>{
 for(const [jwt,man,sha,policy] of [
  [token(), '0'.repeat(64),SOURCE,POLICY],
  [token(), MANIFEST,'f'.repeat(40),POLICY],
  [token(), MANIFEST,SOURCE,'2026-other-policy'],
  [token({arguments_sha256:'f'.repeat(64)}),MANIFEST,SOURCE,POLICY],
  [token({request_hash:'f'.repeat(64)}),MANIFEST,SOURCE,POLICY],
  [token({policy_hash:null}),MANIFEST,SOURCE,POLICY],
 ])assert.throws(()=>verifyCase(jwt,ledger(),man,sha,NOW,policy));
});
test('wrong action, elevated scope, non-production or level 3 are denied',()=>{
 for(const c of [
  {action:'honartik_other'},
  {operation:'host_action.imotion'},
  {tool:'other_tool'},{project:'moeinshow'},{environment:'staging'},
  {level:3},{risk:'high'},{decision:'decline'},{one_time_use:false}
 ])assert.throws(()=>verifyCase(token(c)));
});
test('expired, early, malformed timestamps or future-consumption are denied',()=>{
 for(const c of [{exp:NOW},{nbf:NOW+10},{iat:NOW+10},{exp:'future'}])
  assert.throws(()=>verifyCase(token(c)));
 assert.throws(()=>verifyCase(token(),ledger({consumed_at:new Date((NOW+1)*1000).toISOString()})));
});
test('bad manifest pin and unsafe approval token are refused',()=>{
 assert.throws(()=>verify.expectedArgsSha256('oops',SOURCE));
 assert.throws(()=>verifyCase('not-a-jws'));
});
