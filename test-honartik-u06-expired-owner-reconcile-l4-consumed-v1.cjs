'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const L=require('./honartik-u06-expired-owner-reconcile-l4-consumed-v1.cjs');
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
const NOW=1800000000;
const A='11111111-1111-4111-8111-111111111111';
const R='22222222-2222-4222-8222-222222222222';
function policy(){
 return {schema_version:'prhm.approval-policy.v1',issuer:'prhm-company-approval',
  version:'2026-11-15-approval-policy',default_deny:true,scope_freeze:true,
  one_time_use:true,levels:{'4':{human_approval:true,
   second_confirmation_required:true,max_ttl_seconds:180}},
  operations:{
   [L.NATIVE_OPERATION]:{level:4,risk:'critical'},
   [L.OPERATION]:{level:4,risk:'critical',requires_second_confirmation:true,
    one_time_use:true,expires_seconds:180,policy_version:'2026-11-15-approval-policy',
    requested_approver:'mohammad',rollback_reference:L.ROLLBACK}
  },
  typed_scopes:[
   {tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:'honartik_u06_native_backup_register_v1',risk:'critical',
    operation:L.NATIVE_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]},
   {tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:L.ACTION,risk:'critical',operation:L.OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}
  ]
 };
}
function setup(){
 const p=policy(),bytes=Buffer.from(JSON.stringify(p,null,2)+'\n');
 const policyHash=SHA(bytes);
 const pair=crypto.generateKeyPairSync('ed25519');
 const publicKey=pair.publicKey.export({format:'pem',type:'spki'});
 const kid=SHA(pair.publicKey.export({format:'der',type:'spki'})).slice(0,16);
 const claims={
  approval_id:A,request_id:R,jti:A,iss:'prhm-company-approval',
  action:L.ACTION,operation:L.OPERATION,project:'control_plane',
  environment:'production',tool:'host_action_v2_apply',
  principal_id:'mohammad',role:'mcp-operator',level:4,risk:'critical',
  decision:'accept',one_time_use:true,policy_version:p.version,
  policy_hash:SHA(Buffer.from(JSON.stringify(p))),
  arguments_sha256:L.argDigest(),request_hash:L.argDigest(),
  iat:NOW-30,nbf:NOW-30,exp:NOW+100
 };
 const ledger={schema_version:'prhm.approval-consumption.v1',
  approval_id:A,request_id:R,work_order_id:'u06-reconciliation-only',
  project_id:'control_plane',operation:L.OPERATION,
  request_hash:L.argDigest(),consumed_at:new Date((NOW-15)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',consumption_hash:null};
 ledger.consumption_hash=SHA(Buffer.from(JSON.stringify(ledger)));
 function token(c=claims,privateKey=pair.privateKey){
  const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
  const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const input=b64(header)+'.'+b64(c);
  return input+'.'+crypto.sign(null,Buffer.from(input),privateKey).toString('base64url');
 }
 const args={token:token(),issuerPublicKey:publicKey,consumedLedger:ledger,
  policyBytes:bytes,reviewedPolicySha256:policyHash,nowSec:NOW};
 return {args,claims,ledger,policy:p,token,pair};
}
function expectFail(fn,re){assert.throws(fn,re)}
test('valid independent reconciliation-only Ed25519 and consumed ledger passes source crypto proof',()=>{
 const f=setup();
 const result=L.verifySignedConsumedReconciliation(f.args);
 assert.equal(result.operation,L.OPERATION);
 assert.equal(result.signature_verified,true);
 assert.equal(result.consumed_ledger_verified,true);
 assert.equal(result.root_lock_acquired,false);
 assert.equal(result.root_action_registered,false);
 assert.equal(result.production_mutation_authorized,false);
 assert.equal(L.ROOT_APPLY,false);
 assert.equal(L.LEVEL4_ISSUER,false);
 assert.equal(L.LIVE_PINNED_POLICY_SHA256,null);
});
test('validly SIGNED Native L4 can never authorize reconciliation',()=>{
 const f=setup();
 const c={...f.claims,action:'honartik_u06_native_backup_register_v1',
  operation:L.NATIVE_OPERATION};
 expectFail(()=>L.verifySignedConsumedReconciliation({...f.args,token:f.token(c)}),
  /signed_scope_policy_or_expiry_drift/);
});
test('wrong or unpinned policy bytes, missing typed scope, and policy downgrade denied',()=>{
 const f=setup();
 expectFail(()=>L.verifySignedConsumedReconciliation({...f.args,
  reviewedPolicySha256:'a'.repeat(64)}),/pinned_policy_sha_missing/);
 for(const change of [
  p=>p.default_deny=false,
  p=>p.levels['4'].second_confirmation_required=false,
  p=>p.operations[L.OPERATION].one_time_use=false,
  p=>p.typed_scopes.pop(),
  p=>p.operations[L.OPERATION].rollback_reference='unsafe-rollback',
  p=>delete p.operations[L.NATIVE_OPERATION]
 ]){
  const p=policy();change(p);
  const bytes=Buffer.from(JSON.stringify(p,null,2)+'\n');
  expectFail(()=>L.verifyFixedPolicy(bytes,SHA(bytes)),
   /critical_policy_guard_drift|reconciliation_operation_not_registered_or_downgraded|scope_cardinality|typed_reconciliation_scope_drift|native_scope_unexpectedly_missing/);
 }
});
test('validly signed wrong principal, wrong action, scope and approval freshness denied',()=>{
 const f=setup();
 for(const [key,value] of [
 ['principal_id','someone-else'],
 ['operation',L.NATIVE_OPERATION],
 ['level',3],['risk','low'],['one_time_use',false],
 ['policy_hash','f'.repeat(64)],
 ['arguments_sha256','f'.repeat(64)],
 ['decision','reject'],['exp',NOW-1],['nbf',NOW+1],
 ['iat',NOW-181]
 ]){
  const c={...f.claims,[key]:value};
  expectFail(()=>L.verifySignedConsumedReconciliation({...f.args,token:f.token(c)}),
   /signed_scope_policy_or_expiry_drift/,key);
 }
});
test('tampered Ed25519 signature and wrong public key denied',()=>{
 const f=setup();
 const parts=f.args.token.split('.');
 const sig=Buffer.from(parts[2],'base64url');sig[0]^=1;
 const corrupt=parts.slice(0,2).join('.')+'.'+sig.toString('base64url');
 expectFail(()=>L.verifySignedConsumedReconciliation({...f.args,token:corrupt}),
  /signature_invalid/);
 const other=crypto.generateKeyPairSync('ed25519');
 expectFail(()=>L.verifySignedConsumedReconciliation({...f.args,
  issuerPublicKey:other.publicKey.export({format:'pem',type:'spki'})}),/signature_invalid/);
});
test('replayed, mismatched and malformed consumed ledger denied',()=>{
 const f=setup();
 const faulty=[
  {...f.ledger,approval_id:R},
  {...f.ledger,operation:L.NATIVE_OPERATION},
  {...f.ledger,consumption_hash:'f'.repeat(64)},
  {...f.ledger,consumer:'another-agent'},
  {...f.ledger,consumed_at:new Date((NOW+60)*1000).toISOString()},
  {...f.ledger,new_field:'bad'}
 ];
 for(const consumedLedger of faulty){
  expectFail(()=>L.verifySignedConsumedReconciliation({...f.args,consumedLedger}),
   /consumed_ledger_shape|authoritative_consumption_mismatch/);
 }
});
test('the verifier does not export a privileged Root handler, approval issuer or CLI',()=>{
 const file=path.join(__dirname,'honartik-u06-expired-owner-reconcile-l4-consumed-v1.cjs');
 const r=spawnSync(process.execPath,[file],{encoding:'utf8'});
 assert.equal(r.status,64);
 assert.match(r.stderr,/source verifier only/);
 assert.equal(r.stdout,'');
 assert.equal(L.ROOT_REGISTRATION,false);
 assert.equal(L.ROOT_APPLY,false);
 assert.equal(L.LEVEL4_ISSUER,false);
 assert.equal(L.liveRootApply,undefined);
});
