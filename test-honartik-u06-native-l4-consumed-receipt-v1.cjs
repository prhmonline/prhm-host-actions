'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const v=require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const H=x=>crypto.createHash('sha256').update(x).digest('hex');
const AID='11111111-1111-4111-8111-111111111111';
const RID='22222222-2222-4222-8222-222222222222';
function fixture(){
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
 const key=publicKey.export({format:'pem',type:'spki'});
 const kid=H(publicKey.export({format:'der',type:'spki'})).slice(0,16);
 const now=1800000000,ver='2026-11-11.1-u06-native-root-reviewed';
 const policy={
  schema_version:'prhm.approval-policy.v1',default_deny:true,
  one_time_use:true,scope_freeze:true,issuer:'prhm-company-approval',
  version:ver,
  levels:{'4':{human_approval:true,second_confirmation_required:true,
    max_ttl_seconds:180}},
  operations:{[v.OPERATION]:{
   level:4,risk:'critical',requires_second_confirmation:true,
   one_time_use:true,expires_seconds:180,policy_version:ver,
   requested_approver:'mohammad',rollback_reference:v.EXPECTED.rollback
  }},
  typed_scopes:[{
   action:v.ACTION,operation:v.OPERATION,
   project:'control_plane',environment:'production',risk:'critical',
   tool:'host_action_v2_apply',
   principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  }]
 };
 const bytes=Buffer.from(JSON.stringify(policy));
 const sha=H(bytes);
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
 const claims={
  approval_id:AID,request_id:RID,jti:AID,iss:'prhm-company-approval',
  action:v.ACTION,operation:v.OPERATION,
  project:'control_plane',environment:'production',tool:'host_action_v2_apply',
  principal_id:'mohammad',role:'mcp-operator',level:4,risk:'critical',
  decision:'accept',one_time_use:true,
  policy_version:ver,policy_hash:sha,
  arguments_sha256:v.argDigest(),request_hash:v.argDigest(),
  iat:now-40,nbf:now-40,exp:now+80
 };
 const ledger={
  schema_version:'prhm.approval-consumption.v1',
  approval_id:AID,request_id:RID,work_order_id:null,
  project_id:'control_plane',operation:v.OPERATION,
  request_hash:v.argDigest(),consumed_at:new Date((now-5)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',
  consumption_hash:null
 };
 const seal=(row)=>({...row,consumption_hash:H(Buffer.from(JSON.stringify({
  ...row,consumption_hash:null
 })))});
 const sign=(c=claims,h=header,k=privateKey)=>{
  const body=[h,c].map(obj=>Buffer.from(JSON.stringify(obj)).toString('base64url')).join('.');
  return body+'.'+crypto.sign(null,Buffer.from(body),k).toString('base64url');
 };
 const args=()=>({token:sign(),issuerPublicKey:key,consumedLedger:seal(ledger),
  policyBytes:bytes,reviewedPolicySha256:sha,nowSec:now});
 return {args,sign,seal,claims,header,ledger,bytes,policy,sha,key,now};
}
test('real Ed25519 signed U06 receipt + exact consumed ledger validates, never authorizes Root',()=>{
 const f=fixture(),result=v.verifySignedConsumedL4(f.args());
 assert.equal(result.signature_verified,true);
 assert.equal(result.consumed_ledger_verified,true);
 assert.equal(result.level4_scope_exact,true);
 assert.equal(result.action,v.ACTION);
 assert.equal(result.reviewed_policy_sha256,f.sha);
 assert.equal(result.root_owned_sources_attested,false);
 assert.equal(result.native_root_binding_installed,false);
 assert.equal(result.replay_fence_reserved,false);
 assert.equal(result.production_backup_authorized,false);
 assert.equal(v.PRODUCTION_MUTATION_ALLOWED,false);
});
test('any action, identity, project, Level 3, replay hash, time or issuer drift rejects',()=>{
 const f=fixture();
 for(const change of [
  {action:'host_action_v2_installer_v1'},
  {operation:'host_action.host_action_v2_installer_v1'},
  {principal_id:'other'},{project:'honartik_back'},
  {level:3},{decision:'deny'},
  {arguments_sha256:'0'.repeat(64)},{request_hash:'f'.repeat(64)},
  {exp:f.now-1},{iat:f.now+2},{exp:f.now+500},
  {one_time_use:false},{jti:'other'}
 ]){
  const token=f.sign({...f.claims,...change});
  assert.throws(()=>v.verifySignedConsumedL4({...f.args(),token}),
    /prhm_u06_l4_/);
 }
});
test('a forged Ed25519 signature or wrong key is rejected',()=>{
 const f=fixture(),a=f.args();
 const p=a.token.split('.'),sig=Buffer.from(p[2],'base64url');sig[2]^=1;
 assert.throws(()=>v.verifySignedConsumedL4({...a,
   token:p[0]+'.'+p[1]+'.'+sig.toString('base64url')}),/signature_invalid/);
 const foreign=crypto.generateKeyPairSync('ed25519').publicKey
   .export({format:'pem',type:'spki'});
 assert.throws(()=>v.verifySignedConsumedL4({...a,issuerPublicKey:foreign}),
   /signature_invalid/);
});
test('unreviewed U06 policy, Level 3 downgrade or duplicate scopes are rejected',()=>{
 const f=fixture();
 assert.throws(()=>v.verifySignedConsumedL4({...f.args(),
  reviewedPolicySha256:'0'.repeat(64)}),/exact_reviewed_policy_sha_missing/);
 for(const bad of [
  {...f.policy,operations:{[v.OPERATION]:{
   ...f.policy.operations[v.OPERATION],level:3}}},
  {...f.policy,typed_scopes:[...f.policy.typed_scopes,
   {...f.policy.typed_scopes[0]}]},
  {...f.policy,default_deny:false},
  {...f.policy,typed_scopes:[]},
  {...f.policy,operations:{}}
 ]){
  const bytes=Buffer.from(JSON.stringify(bad));
  assert.throws(()=>v.verifySignedConsumedL4({...f.args(),
   policyBytes:bytes,reviewedPolicySha256:H(bytes)}),/prhm_u06_l4_/);
 }
});
test('consumed ledger identity, consumer, hash and timestamp cannot be faked',()=>{
 const f=fixture(),a=f.args();
 for(const change of [
  {operation:'host_action.other'},
  {consumer:'untrusted'},
  {request_hash:'x'.repeat(64)},
  {approval_id:RID},
  {request_id:AID},
  {consumption_hash:'0'.repeat(64)},
  {consumed_at:new Date((f.now+100)*1000).toISOString()}
 ]){
  const ledger={...a.consumedLedger,...change};
  assert.throws(()=>v.verifySignedConsumedL4({...a,consumedLedger:ledger}),
    /prhm_u06_l4_/);
 }
 assert.throws(()=>v.verifySignedConsumedL4({...a,consumedLedger:null}),
  /consumed_ledger_shape/);
});
test('reverified real L4 still fail-closed on installation until exact host policy is reviewed',()=>{
 assert.equal(v.TRUSTED_LIVE_POLICY_POSTIMAGE_SHA256,null);
 assert.throws(()=>v.verifyLiveRootU06(),/reviewed_live_policy_not_installed/);
 assert.equal(v.ROOT_INSTALL_ALLOWED,false);
 assert.equal(v.install,undefined);
 assert.equal(v.issueApproval,undefined);
 assert.equal(v.consumeApproval,undefined);
});
