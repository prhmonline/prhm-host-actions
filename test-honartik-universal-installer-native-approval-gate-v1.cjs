'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const G=require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const C=G.ACTION;
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
const uid='11111111-2222-4333-8444-555555555555';
const aid='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const t=1793110000;
function fixture(change={}){
 const policy={
  schema_version:'prhm.approval-policy.v1',
  issuer:'prhm-company-approval',one_time_use:true,default_deny:true,
  version:'2026-10-27.1-honartik-universal-installer-exact-l4-review',
  levels:{'4':{human_approval:true,second_confirmation_required:true,
    max_ttl_seconds:180}},
  operations:{['host_action.'+C]:{
    level:4,risk:'critical',requires_second_confirmation:true,
    one_time_use:true,expires_seconds:180,
    policy_version:'2026-10-27.1-honartik-universal-installer-exact-l4-review',
    requested_approver:'mohammad',
    rollback_reference:'host-action-v2:honartik-universal-installer-upgrade-v1:locked-preimage-journal-rollback'
  }},
  typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',
    environment:'production',action:C,risk:'critical',operation:'host_action.'+C,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]
 };
 if(change.policy)change.policy(policy);
 const policyBytes=Buffer.from(JSON.stringify(policy));
 const pair=crypto.generateKeyPairSync('ed25519');
 const publicKey=pair.publicKey.export({format:'pem',type:'spki'});
 const kid=SHA(pair.publicKey.export({format:'der',type:'spki'})).slice(0,16);
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
 const claims={
  iss:'prhm-company-approval',request_id:uid,approval_id:aid,jti:aid,
  action:C,operation:'host_action.'+C,project:'control_plane',
  environment:'production',tool:'host_action_v2_apply',
  principal_id:'mohammad',role:'mcp-operator',level:4,risk:'critical',
  decision:'accept',one_time_use:true,
  policy_version:policy.version,policy_hash:SHA(policyBytes),
  arguments_sha256:G.ARGUMENTS_SHA,request_hash:G.ARGUMENTS_SHA,
  iat:t-10,nbf:t-9,exp:t+120
 };
 if(change.claims)change.claims(claims);
 const head=Buffer.from(JSON.stringify(header)).toString('base64url');
 const body=Buffer.from(JSON.stringify(claims)).toString('base64url');
 const signature=crypto.sign(null,Buffer.from(head+'.'+body),pair.privateKey);
 const token=head+'.'+body+'.'+signature.toString('base64url');
 const ledger={
  schema_version:'prhm.approval-consumption.v1',
  approval_id:aid,request_id:uid,work_order_id:uid,
  project_id:'control_plane',operation:'host_action.'+C,
  request_hash:G.ARGUMENTS_SHA,
  consumed_at:new Date((t-1)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',
  consumption_hash:null
 };
 if(change.ledger)change.ledger(ledger);
 ledger.consumption_hash=SHA(Buffer.from(JSON.stringify(ledger)));
 return {requestId:uid,token,publicKey,policyBytes,ledger,nowSec:t};
}
test('fixed name, scope and SHA256 argument binding',()=>{
 assert.equal(G.ACTION,'honartik_universal_installer_upgrade_v1');
 assert.equal(G.ARGUMENTS_SHA,
  SHA(Buffer.from(JSON.stringify({action:'honartik_universal_installer_upgrade_v1'}))));
});
test('valid synthetic Ed25519 JWS and server-side consumed ledger proof',()=>{
 const result=G.verifyFixedEvidence(fixture());
 assert.equal(result.signature_verified,true);
 assert.equal(result.consumed_ledger_verified,true);
 assert.equal(result.execution_fence_reserved,false);
 assert.equal(result.installer_upgraded,false);
});
test('tampered signature is denied',()=>{
 const f=fixture();
 f.token=f.token.slice(0,-1)+(f.token.endsWith('A')?'B':'A');
 assert.throws(()=>G.verifyFixedEvidence(f),/signature_invalid|token_shape/);
});
test('canonical Ed25519 signature with a different byte must fail',()=>{
 const f=fixture();
 const parts=f.token.split('.');
 const bytes=Buffer.from(parts[2],'base64url');
 bytes[0]^=1;
 parts[2]=bytes.toString('base64url');
 f.token=parts.join('.');
 assert.throws(()=>G.verifyFixedEvidence(f),/signature_invalid/);
});
test('different base64url pad bits may not alias a signed receipt',()=>{
 const f=fixture();
 const parts=f.token.split('.');
 const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 const last=parts[2].at(-1),idx=abc.indexOf(last);
 assert.equal(idx%16,0); // 64-byte Ed25519 -> 2 data bits in last character
 parts[2]=parts[2].slice(0,-1)+abc[idx+1];
 const originalBytes=Buffer.from(f.token.split('.')[2],'base64url');
 assert.deepEqual(Buffer.from(parts[2],'base64url'),originalBytes);
 f.token=parts.join('.');
 assert.throws(()=>G.verifyFixedEvidence(f),/token_shape/);
});
test('expired signed receipt is denied',()=>{
 assert.throws(()=>G.verifyFixedEvidence(fixture({claims:c=>c.exp=t-1})),
  /scope_policy_expiry_mismatch/);
});
test('signed request ID must match root verified identity',()=>{
 const f=fixture();f.requestId='99999999-2222-4333-8444-555555555555';
 assert.throws(()=>G.verifyFixedEvidence(f),/request_id_mismatch/);
});
test('changed policy bytes cannot reuse a signed receipt',()=>{
 const f=fixture();
 const v=JSON.parse(f.policyBytes.toString());
 v.protected_extra_field='changed';
 f.policyBytes=Buffer.from(JSON.stringify(v));
 assert.throws(()=>G.verifyFixedEvidence(f),/scope_policy_expiry_mismatch/);
});
test('unapproved or missing operation is denied',()=>{
 assert.throws(()=>G.verifyFixedEvidence(fixture({policy:p=>{
  delete p.operations['host_action.'+C];
 }})),/operation_scope_not_approved/);
});
test('typed scope principal cannot broaden',()=>{
 assert.throws(()=>G.verifyFixedEvidence(fixture({policy:p=>{
  p.typed_scopes[0].principals.push({principal_id:'any',roles:['root']});
 }})),/typed_scope_not_exact/);
});
test('ledger cannot be forged to mark unconsumed receipt',()=>{
 assert.throws(()=>G.verifyFixedEvidence(fixture({ledger:l=>{
   l.consumer='wrong-executor';
 }})),/consumed_ledger_untrusted/);
});
test('token cannot be used with wrong fixed action arguments',()=>{
 assert.throws(()=>G.verifyFixedEvidence(fixture({claims:c=>{
  c.arguments_sha256='f'.repeat(64);
 }})),/scope_policy_expiry_mismatch/);
});
test('no caller selected root, token issuance or executable install',()=>{
 assert.equal(G.LIVE_REGISTRATION_PRESENT,false);
 assert.equal(G.INSTALL_APPLY_EXPORTED,false);
 assert.equal(G.readNativeConsumedProof.length,2);
});
test('live reader refuses untrusted user before touching issuer state',()=>{
 if(typeof process.getuid==='function'&&process.getuid()!==0){
  assert.throws(()=>G.readNativeConsumedProof(uid,()=>''),/root_required/);
 }
});

test('root-only live admission pins the exact reviewed Policy SHA256',()=>{
 assert.equal(G.PINNED_POLICY_SHA,
  '981967b4ce770cd3aa89d27ae98552bbeb3ab31ed116d4e51aef91c0abf68358');
 assert.notEqual(G.PINNED_POLICY_SHA,
  '82334369202b31418e33b44c0ed53e1d4b3ea58acc7e37835b13b60c6ba239cb');
 const synthetic=fixture();
 // Semantic correctness and a matching synthetic signature are insufficient.
 assert.equal(G.parsePolicy(synthetic.policyBytes).version,
  '2026-10-27.1-honartik-universal-installer-exact-l4-review');
 assert.throws(()=>G.requirePinnedProductionPolicy(synthetic.policyBytes),
  /live_policy_preimage_unreconciled/);
});
test('root-only admission rejects arbitrary or empty policy byte streams',()=>{
 for(const raw of [Buffer.from(''),Buffer.from('{}'),null,
   Buffer.from('{"version":"2026-10-27.1-honartik-universal-installer-exact-l4-review"}')]){
  assert.throws(()=>G.requirePinnedProductionPolicy(raw),
   /live_policy_preimage_unreconciled/);
 }
});
