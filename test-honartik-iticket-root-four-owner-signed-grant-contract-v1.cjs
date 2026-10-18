'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const g=require('./honartik-iticket-root-four-owner-signed-grant-contract-v1.cjs');
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const {privateKey:attackerPrivateKey,publicKey:attackerPublicKey}=crypto.generateKeyPairSync('ed25519');
const NOW=1799999910;
const valid=()=>({
  schema:g.SCHEMA,issuer:'prhm-company-approval',audience:g.AUDIENCE,
  operation:g.OPERATION,action:g.ACTION,level:4,risk:'critical',
  policy_version:'2026-10-18.1-honartik-worktree-level4-v1',
  requested_approver:'mohammad',second_confirmation:true,
  rollback_reference:g.ROLLBACK,
  owner_pre_sha256:{...g.PRE},owner_post_sha256:{...g.POST},
  issued_at:NOW-10,expires_at:NOW+170,
  jti:'e49ab4f9-e5f2-42ab-9da1-581c1533c479'
});
const sign=(p,key=privateKey)=>crypto.sign(null,
    Buffer.from(g.canonicalObject(p),'utf8'),key).toString('base64url');
const verify=(p,s,key=publicKey,now=NOW)=>g.verifyOffline({
  payload:p,signature:s,issuerPublicKey:key,now
});
test('synthetic Ed25519 exact 4-owner signed Level4 grant structurally verifies',()=>{
  const p=valid(),out=verify(p,sign(p));
  assert.equal(out.signature_valid_under_supplied_key,true);
  assert.equal(out.fixed_pre_and_post_shas,true);
  assert.equal(out.expires_in_seconds,170);
  assert.equal(out.live_trust_anchor_attested,false);
  assert.equal(out.replay_prevention_attested,false);
  assert.equal(out.effective_issuer_semantics_attested,false);
  assert.equal(out.install_authorized,false);
  assert.equal(out.production_mutation,false);
});
test('JSON property ordering does not change signed canonical bytes',()=>{
  const a=valid(),b=Object.fromEntries(Object.entries(a).reverse());
  b.owner_pre_sha256=Object.fromEntries(Object.entries(b.owner_pre_sha256).reverse());
  assert.equal(g.canonicalObject(a),g.canonicalObject(b));
  assert.doesNotThrow(()=>verify(b,sign(a)));
});
for(const [name,modify] of [
  ['wrong operation',p=>p.operation='host_action.host_action_v2_installer_v1'],
  ['wrong action',p=>p.action='host_action_v2_installer_v1'],
  ['wrong audience',p=>p.audience='unrelated-live-host'],
  ['wrong rollback',p=>p.rollback_reference='untrusted-path'],
  ['wrong issuer',p=>p.issuer='untrusted-issuer'],
  ['Level3 downgrade',p=>p.level=3],
  ['risk downgrade',p=>p.risk='high'],
  ['second confirmation false',p=>p.second_confirmation=false],
  ['different approver',p=>p.requested_approver='someone-else'],
  ['policy version drift',p=>p.policy_version='unsupported'],
  ['base preimage drift',p=>p.owner_pre_sha256.base='a'.repeat(64)],
  ['exec postimage drift',p=>p.owner_post_sha256.exec='b'.repeat(64)],
  ['policy postimage drift',p=>p.owner_post_sha256.policy='c'.repeat(64)],
  ['MCP preimage drift',p=>p.owner_pre_sha256.mcp='d'.repeat(64)],
  ['missing SHA',p=>delete p.owner_post_sha256.base],
  ['extra SHA',p=>p.owner_post_sha256.extra='f'.repeat(64)],
  ['invalid nonce',p=>p.jti='reused-invalid-format'],
  ['ttl more than 180',p=>p.expires_at=p.issued_at+181],
  ['expires before issued',p=>p.expires_at=p.issued_at],
  ['signed expired',p=>p.expires_at=NOW],
  ['signed not yet valid',p=>p.issued_at=NOW+1],
  ['extra field',p=>p.token='secret'],
  ['missing field',p=>delete p.issuer]
]){
  test('fail closed with even valid signature: '+name,()=>{
    const p=valid();modify(p);
    assert.throws(()=>verify(p,sign(p)),/signed_grant_contract_/);
  });
}
test('signature tampered in transit fails',()=>{
  const p=valid(),sig=Buffer.from(sign(p),'base64url');
  sig[1]^=0x80;
  assert.throws(()=>verify(p,sig.toString('base64url')),/signature_invalid/);
});
test('correct payload signed by a different key does not verify against pinned test key',()=>{
  const p=valid();
  assert.throws(()=>verify(p,sign(p,attackerPrivateKey)),/signature_invalid/);
  // A synthetic attacker-provided key is valid cryptographically but NOT a live trust root.
  const fake=verify(p,sign(p,attackerPrivateKey),attackerPublicKey);
  assert.equal(fake.live_trust_anchor_attested,false);
  assert.equal(fake.install_authorized,false);
});
test('invalid algorithm or private key rejected',()=>{
  const p=valid(),sig=sign(p);
  assert.throws(()=>verify(p,sig,privateKey),/public_ed25519_key_required/);
  const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).publicKey;
  assert.throws(()=>verify(p,sig,rsa),/public_ed25519_key_required/);
});
test('canonical Base64url signature must not be padded or truncated',()=>{
  const p=valid(),s=sign(p);
  assert.throws(()=>verify(p,s+'='),/base64url_invalid/);
  assert.throws(()=>verify(p,s.slice(0,-2)),/signature_length/);
});
test('replay and issuer binding are explicitly NOT verified',()=>{
  const p=valid(),sig=sign(p);
  const a=verify(p,sig),b=verify(p,sig);
  assert.equal(a.signature_valid_under_supplied_key,true);
  assert.equal(b.signature_valid_under_supplied_key,true);
  assert.equal(a.replay_prevention_attested,false);
  assert.equal(b.replay_prevention_attested,false);
  assert.equal(b.registration_authorized,false);
});
test('no file, network, process, signing private-key or installed code capability',()=>{
  const code=fs.readFileSync(require.resolve('./honartik-iticket-root-four-owner-signed-grant-contract-v1.cjs'),'utf8');
  for(const needle of ["require('node:fs')","require('node:child_process')","require('https')",
    'fs.writeFileSync(','crypto.sign(','systemctl','fetch(','process.env','process.argv',
    'approvalToken','privateKey'])
    assert.equal(code.includes(needle),false,'privileged term '+needle);
  assert.deepEqual(Object.keys(g).sort(),[
    'ACTION','OPERATION','AUDIENCE','ROLLBACK','SCHEMA','PRE','POST','canonicalObject','checkPayload','verifyOffline'
  ].sort());
});
