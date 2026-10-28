'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const auth=require('./honartik-universal-installer-l4-approval-verify-v1.cjs');
const {CONTRACT,ACTION}=require('./honartik-universal-installer-l4-v1.cjs');
const HASH=x=>crypto.createHash('sha256').update(x).digest('hex');
const AID='11111111-1111-4111-8111-111111111111';
const RID='22222222-2222-4222-8222-222222222222';
function fixture(){
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
 const pem=publicKey.export({format:'pem',type:'spki'});
 const kid=HASH(publicKey.export({format:'der',type:'spki'})).slice(0,16);
 const nowSec=1700000100,policyVersion='test-reviewed-policy-v1';
 const policyHash='a'.repeat(64),binding='b'.repeat(64);
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
 const claim={
  approval_id:AID,request_id:RID,jti:AID,iss:'prhm-company-approval',
  action:ACTION,operation:CONTRACT.operation,project:'control_plane',
  environment:'production',tool:'host_action_v2_apply',
  principal_id:'mohammad',role:'mcp-operator',
  level:4,risk:'critical',decision:'accept',one_time_use:true,
  policy_version:policyVersion,policy_hash:policyHash,
  arguments_sha256:binding,request_hash:binding,
  nbf:nowSec-2,iat:nowSec-2,exp:nowSec+80
 };
 const ledger={
  schema_version:'prhm.approval-consumption.v1',
  approval_id:AID,request_id:RID,work_order_id:null,
  project_id:'control_plane',operation:CONTRACT.operation,
  request_hash:binding,consumed_at:new Date((nowSec-1)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',
  consumption_hash:null
 };
 const seal=l=>({...l,consumption_hash:HASH(Buffer.from(JSON.stringify({...l,consumption_hash:null})))});
 const sign=(claims=claim,head=header,privateSigningKey=privateKey)=>{
  const body=[head,claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return body+'.'+crypto.sign(null,Buffer.from(body),privateSigningKey).toString('base64url');
 };
 const args=()=>({token:sign(),issuerPublicKey:pem,ledger:seal(ledger),
  nowSec,trustedPolicyVersion:policyVersion,trustedPolicyHash:policyHash,
  trustedArgumentsSha256:binding});
 return {args,sign,seal,claim,header,ledger,nowSec,policyVersion,policyHash,binding,
  pem,privateKey};
}
test('real Ed25519 JWS + exact consumed ledger succeed with fixture trust',()=>{
 const f=fixture();const proof=auth.verifyConsumedExactL4(f.args());
 assert.equal(proof.ok,true);assert.equal(proof.signature_verified,true);
 assert.equal(proof.consumed_ledger_verified,true);
 assert.equal(proof.approval_id,AID);assert.equal(proof.operation,CONTRACT.operation);
 assert.ok(!Object.hasOwn(proof,'token'));
});
test('changed JWS signature and unrelated Ed25519 key are denied',()=>{
 const f=fixture();const a=f.args();const parts=a.token.split('.');
 const sig=Buffer.from(parts[2],'base64url');sig[3]^=1;
 assert.throws(()=>auth.verifyConsumedExactL4({...a,token:parts.slice(0,2).join('.')+'.'+sig.toString('base64url')}),/signature_invalid/);
 const foreign=crypto.generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'});
 assert.throws(()=>auth.verifyConsumedExactL4({...a,issuerPublicKey:foreign}),/signature_invalid/);
});
test('wrong action, project, level, claim binding, expiry and duplicated approval denied',()=>{
 const f=fixture();
 for(const change of [{action:'other'},{project:'honartik'},{level:3},
  {arguments_sha256:'f'.repeat(64)},{decision:'deny'},
  {exp:f.nowSec-1},{iat:f.nowSec+10},{exp:f.nowSec+181},
  {approval_id:RID},{one_time_use:false}]){
  const token=f.sign({...f.claim,...change});
  assert.throws(()=>auth.verifyConsumedExactL4({...f.args(),token}),/scope_policy_expiry_mismatch|consumed_ledger_untrusted/);
 }
});
test('issuer context cannot be derived from claimed JSON; drift rejects',()=>{
 const f=fixture(),a=f.args();
 for(const bad of [{trustedPolicyHash:'e'.repeat(64)},
  {trustedPolicyVersion:'untrusted-policy-v2'},
  {trustedArgumentsSha256:'e'.repeat(64)},
  {nowSec:f.nowSec+1000}]){
  assert.throws(()=>auth.verifyConsumedExactL4({...a,...bad}),/scope_policy_expiry_mismatch/);
 }
 assert.throws(()=>auth.verifyConsumedExactL4({...a,trustedArgumentsSha256:'anything'}),/trusted_context_missing/);
});
test('tampered consumed ledger hash, request, consumer and absent consume proof reject',()=>{
 const f=fixture(),a=f.args();
 for(const bad of [{consumption_hash:'0'.repeat(64)},
  {request_id:AID},{consumer:'other'},
  {operation:'different'},{request_hash:'0'.repeat(64)}]){
  assert.throws(()=>auth.verifyConsumedExactL4({...a,ledger:{...a.ledger,...bad}}),
    /consumed_ledger_untrusted/);
 }
 assert.throws(()=>auth.verifyConsumedExactL4({...a,ledger:null}),/consumed_ledger_schema/);
});
test('no token issuer, approval consumption, root execution or CLI exported',()=>{
 assert.deepEqual(Object.keys(auth).sort(),['decodeJws','verifyConsumedExactL4']);
 assert.equal(auth.createApprovalRequest,undefined);
 assert.equal(auth.issueSignedToken,undefined);
 assert.equal(auth.consumeApproval,undefined);
 assert.equal(auth.install,undefined);
});
