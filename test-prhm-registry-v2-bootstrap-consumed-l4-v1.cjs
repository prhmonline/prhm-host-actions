'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const V=require('./prhm-registry-v2-bootstrap-consumed-l4-v1.cjs');
const policyHash='a'.repeat(64);
const approvalId='12345678-1234-4234-8234-123456789abc';
const requestId='12345678-1234-4234-8234-123456789abd';
const issuedAt=1000,nowSec=1015;
const digest=V.digestArguments(V.bootstrapArguments());
function fixture() {
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const publicKeyBytes=Buffer.from(publicKey.export({type:'spki',format:'pem'}));
 const kid=crypto.createHash('sha256')
  .update(publicKey.export({type:'spki',format:'der'}))
  .digest('hex').slice(0,16);
 const claims={
  iss:V.ISSUER,approval_id:approvalId,jti:approvalId,request_id:requestId,
  action:V.bootstrapArguments().action,operation:V.OPERATION,
  project:'control_plane',project_id:'control_plane',environment:'production',tool:V.TOOL,
  rollback_reference_hash:crypto.createHash('sha256')
   .update(V.ROLLBACK_REFERENCE).digest('hex'),
  principal_id:'mohammad',role:'mcp-operator',level:4,risk:'critical',
  decision:'accept',approver:'mohammad',one_time_use:true,
  arguments_sha256:digest,request_hash:digest,
  policy_id:'operation:'+V.OPERATION,
  policy_version:V.POLICY_VERSION,policy_hash:policyHash,
  iat:issuedAt,nbf:issuedAt,exp:issuedAt+180
 };
 const ledger={
  schema_version:'prhm.approval-consumption.v1',
  approval_id:approvalId,request_id:requestId,work_order_id:null,
  project_id:'control_plane',operation:V.OPERATION,request_hash:digest,
  consumed_at:new Date((issuedAt+5)*1000).toISOString(),
  consumer:V.CONSUMER,consumption_hash:null
 };
 function sealLedger(){
  ledger.consumption_hash=crypto.createHash('sha256')
   .update(JSON.stringify({...ledger,consumption_hash:null})).digest('hex');
 }
 sealLedger();
 function signed() {
  const head={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
  const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const body=b64(head)+'.'+b64(claims);
  return body+'.'+crypto.sign(null,Buffer.from(body),privateKey).toString('base64url');
 }
 function verify(token=signed(),other={}) {
  return V.verifyConsumed({
   token,publicKey:publicKeyBytes,ledger,nowSec,policyHash,
   policyVersion:V.POLICY_VERSION,...other
  });
 }
 return {claims,ledger,sealLedger,signed,verify,publicKeyBytes};
}
test('actual Ed25519 signature plus Approval Center consumed receipt verified',()=>{
 const f=fixture(),result=f.verify();
 assert.equal(result.crypto_verified,true);
 assert.equal(result.consumed_ledger_verified,true);
 assert.equal(result.request_id,requestId);
 assert.equal(result.action,'prhm_shared_registry_root_bootstrap_v2');
 assert.equal(result.execution_claim_verified,false);
 assert.equal(result.bootstrap_installed,false);
 assert.throws(()=>V.productionProof(),/not_installed/);
});
test('wrong issuer, typed tool, action, project, approval level or scope is rejected',()=>{
 for(const mutate of [
  f=>{f.claims.action='prhm_action_registry_install_v1'},
  f=>{f.claims.tool='host_action_v2_apply'},
  f=>{f.claims.project='honartik'},
  f=>{f.claims.project_id='honartik'},
  f=>{f.claims.rollback_reference_hash='0'.repeat(64)},
  f=>{f.claims.operation='host_action.prhm_action_registry_install_v1'},
  f=>{f.claims.level=3},
  f=>{f.claims.iss='unknown'},
  f=>{f.claims.policy_version='unreviewed'},
  f=>{f.claims.approver='random'},
  f=>{f.claims.arguments_sha256='0'.repeat(64)}
 ]){const f=fixture();mutate(f);assert.throws(()=>f.verify());}
});
test('signed body tampering or untrusted signer is not accepted',()=>{
 const f=fixture();const signed=f.signed();const parts=signed.split('.');
 const altered=Buffer.from('{"sub":"not-approved"}').toString('base64url');
 assert.throws(()=>f.verify(parts[0]+'.'+altered+'.'+parts[2]));
 assert.throws(()=>f.verify('not.a.valid.jws'));
 const untrusted=fixture();
 assert.throws(()=>f.verify(untrusted.signed()));
});
test('missing, malformed and wrong consumed ledger cannot authorize root stage',()=>{
 for(const mutate of [
  f=>{f.ledger.consumer='prhm-agent-selfmaint-exec-host-actions-v2'},
  f=>{f.ledger.approval_id=requestId},
  f=>{f.ledger.request_id=approvalId},
  f=>{f.ledger.operation='host_action.prhm_action_registry_install_v1'},
  f=>{f.ledger.consumed_at=new Date((nowSec+100)*1000).toISOString()},
  f=>{f.ledger.consumption_hash='f'.repeat(64)},
  f=>{f.ledger.extra='unknown'},
  f=>{delete f.ledger.consumer}
 ]){const f=fixture();mutate(f);assert.throws(()=>f.verify());}
});
test('even recomputed forged JSON receipt cannot cross signed identity',()=>{
 const f=fixture();f.ledger.operation='host_action.prhm_action_registry_install_v1';
 f.sealLedger();assert.throws(()=>f.verify(),/receipt_mismatch/);
});
test('expiry, invalid policy pin, extended TTL and missing signed evidence rejected',()=>{
 let f=fixture();
 assert.throws(()=>f.verify(undefined,{nowSec:issuedAt+181}),/expiry_or_policy/);
 assert.throws(()=>f.verify(undefined,{policyHash:'0'.repeat(64)}),/expiry_or_policy/);
 assert.throws(()=>f.verify(undefined,{policyVersion:'other'}),/reviewed_policy_pin_required/);
 assert.throws(()=>f.verify(undefined,{policyHash:null}),/reviewed_policy_pin_required/);
 f.claims.exp=f.claims.iat+3600;
 assert.throws(()=>f.verify(),/expiry_or_policy/);
});
test('fixed SHA-bound bootstrap arguments and distinct action',()=>{
 const args=V.bootstrapArguments();
 assert.match(args.manifest_sha256,/^[a-f0-9]{64}$/);
 assert.equal(Object.keys(args).length,5);
 assert.equal(V.digestArguments(args),digest);
 for(const [key,bad] of [
  ['action','prhm_action_registry_install_v1'],
  ['project','honartik'],['source_commit','0'.repeat(40)],
  ['manifest_commit','0'.repeat(40)],['manifest_sha256','1'.repeat(64)]
 ]){
  assert.throws(()=>V.digestArguments({...args,[key]:bad}));
 }
});
