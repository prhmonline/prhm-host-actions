'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs');
const c=require('./honartik-iticket-real-issuer-jws-readonly-contract-v1.cjs');
const pair=crypto.generateKeyPairSync('ed25519'),rogue=crypto.generateKeyPairSync('ed25519');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const keyFingerprint=sha(pair.publicKey.export({type:'spki',format:'der'}));
const policyHash='a'.repeat(64);
const NOW=1800000000;
const UUID0='e49ab4f9-e5f2-42ab-9da1-581c1533c479';
const UUID1='b1421a1a-c22c-4976-ac0f-52619308a517';
const UUID2='2a7c9a3b-6ed7-4d49-8a5c-15bbf52aab7b';
function claims(){return {
 iss:'prhm-company-approval',approval_id:UUID0,jti:UUID0,request_id:UUID1,
 work_order_id:null,requester:'mohammad-ceo-interface',
 principal_id:'mohammad',role:'mcp-operator',
 tool:'host_action_v2_apply',project:'control_plane',environment:'production',
 action:c.ACTION,project_id:'control_plane',operation:c.OPERATION,
 request_hash:c.boundArgumentsHash(),
 arguments_sha256:c.boundArgumentsHash(),
 level:4,risk:'critical',approver:'mohammad',decision:'accept',
 iat:NOW-5,nbf:NOW-5,exp:NOW+175,nonce:UUID2,
 policy_id:'operation:'+c.OPERATION,policy_version:c.POLICY_VERSION,
 policy_hash:policyHash,one_time_use:true,
 rollback_reference_hash:sha(Buffer.from(c.ROLLBACK))
}}
function sign(payload=claims(),privateKey=pair.privateKey,kid=keyFingerprint.slice(0,16)){
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const body=enc(header)+'.'+enc(payload);
 return body+'.'+crypto.sign(null,Buffer.from(body),privateKey).toString('base64url');
}
function context(more={}){return {
 issuerPublicKey:pair.publicKey,expected_key_fingerprint:keyFingerprint,
 expected_policy_hash:policyHash,now:NOW,...more
}}
function verify(payload=claims(),more={}){return c.verifyOffline(sign(payload),context(more));}

test('source-derived actual wire protocol: three segments, raw signing bytes, EdDSA and kid',()=>{
 const token=sign(),a=c.parseToken(token),out=c.verifyOffline(token,context());
 assert.equal(a.header.typ,'PRHM-COMPANY-APPROVAL');
 assert.equal(a.header.alg,'EdDSA');
 assert.equal(a.header.kid,keyFingerprint.slice(0,16));
 assert.equal(out.source_protocol_shape_attested,true);
 assert.equal(out.issuer_runtime_version_attested,false);
 assert.equal(out.one_time_use_consumption_verified,false);
 assert.equal(out.second_confirmation_verified,false);
 assert.equal(out.live_registration_authorized,false);
});
test('actual issuer computes arguments hash using recursive sorted JSON, not whole token',()=>{
 const args=c.fixedArgs(),reversed={...args,owner_pre_sha256:Object.fromEntries(Object.entries(args.owner_pre_sha256).reverse())};
 assert.equal(c.canon(args),c.canon(reversed));
 assert.equal(c.boundArgumentsHash(),sha(Buffer.from(c.canon(args))));
 const req=c.requestShape();
 assert.equal(req.arguments_sha256,c.boundArgumentsHash());
 assert.equal(req.ttl_seconds,180);
 assert.equal(req.risk,'critical');
 assert.equal(req.operation,c.OPERATION);
});
test('untrusted newly supplied issuer key cannot masquerade as pinned key',()=>{
 assert.throws(()=>c.verifyOffline(sign(claims(),rogue.privateKey,
    sha(rogue.publicKey.export({type:'spki',format:'der'})).slice(0,16)),
    context({issuerPublicKey:rogue.publicKey})),/independent_key_pin_required/);
});
test('wrong independent key fingerprint denied',()=>{
 assert.throws(()=>c.verifyOffline(sign(),context({expected_key_fingerprint:'f'.repeat(64)})),/independent_key_pin_required/);
});
test('altering already signed raw header/payload bytes is denied',()=>{
 const parts=sign().split('.');
 const altered=Buffer.from(JSON.stringify({...claims(),risk:'medium'})).toString('base64url');
 assert.throws(()=>c.verifyOffline([parts[0],altered,parts[2]].join('.'),context()),/signature_invalid/);
});
test('rogue private key with same kid cannot pass trusted public key',()=>{
 assert.throws(()=>c.verifyOffline(sign(claims(),rogue.privateKey),context()),/signature_invalid/);
});
for(const [label,mod] of [
 ['issuer',p=>p.iss='untrusted'],
 ['approval action',p=>p.action='host_action_v2_installer_v1'],
 ['operation',p=>p.operation='host_action.host_action_v2_installer_v1'],
 ['project',p=>p.project='other'],
 ['tool',p=>p.tool='file.patch_safe'],
 ['environment',p=>p.environment='staging'],
 ['level',p=>p.level=3],
 ['risk',p=>p.risk='high'],
 ['principal',p=>p.principal_id='attacker'],
 ['role',p=>p.role='viewer'],
 ['human approver',p=>p.approver='attacker'],
 ['decision',p=>p.decision='decline'],
 ['replay flag',p=>p.one_time_use=false],
 ['wrong argument hash',p=>p.arguments_sha256='b'.repeat(64)],
 ['request hash mismatch',p=>p.request_hash='c'.repeat(64)],
 ['rollback hash mismatch',p=>p.rollback_reference_hash='d'.repeat(64)],
 ['policy version',p=>p.policy_version='old'],
 ['policy hash',p=>p.policy_hash='e'.repeat(64)],
 ['policy id',p=>p.policy_id='operation:wrong'],
 ['jti mismatch',p=>p.jti=UUID1],
 ['approval UUID',p=>p.approval_id='invalid'],
 ['request UUID',p=>p.request_id='invalid'],
 ['nonce UUID',p=>p.nonce='invalid'],
 ['ttl 181 sec',p=>p.exp=p.iat+181],
 ['not before',p=>p.nbf=NOW+1],
 ['expired',p=>p.exp=NOW],
 ['iat negative',p=>p.iat=-1]
]){
 test('fail-closed source protocol: '+label,()=>{
  const p=claims();mod(p);
  assert.throws(()=>verify(p),/real_issuer_jws_contract_/);
 });
}
test('not JWT, or unsupported alg/typ/key-ID are denied',()=>{
 const p=claims();
 assert.throws(()=>c.parseToken('x.y'),/token_segment_count/);
 assert.throws(()=>c.verifyOffline(sign(p,pair.privateKey,'f'.repeat(16)),context()),/key_fingerprint_mismatch/);
 const h={alg:'none',typ:'PRHM-COMPANY-APPROVAL',kid:keyFingerprint.slice(0,16)};
 const e=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const input=e(h)+'.'+e(p);
 const bad=input+'.'+crypto.sign(null,Buffer.from(input),pair.privateKey).toString('base64url');
 assert.throws(()=>c.verifyOffline(bad,context()),/header_invalid/);
});
test('reject private key or RSA as public verifier',()=>{
 const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>c.verifyOffline(sign(),context({issuerPublicKey:pair.privateKey})),/ed25519_public_key_required/);
 assert.throws(()=>c.verifyOffline(sign(),context({issuerPublicKey:rsa.publicKey})),/ed25519_public_key_required/);
});
test('Ed25519 wire verification does not authorize replay consumption',()=>{
 const tok=sign(),a=c.verifyOffline(tok,context()),b=c.verifyOffline(tok,context());
 assert.equal(a.signed_under_supplied_key,true);
 assert.equal(b.signed_under_supplied_key,true);
 assert.equal(a.one_time_use_consumption_verified,false);
 assert.equal(b.issuer_record_verified,false);
 assert.equal(b.live_registration_authorized,false);
});
test('no private key, request, network, file mutation or execution in verifier',()=>{
 const s=fs.readFileSync(require.resolve('./honartik-iticket-real-issuer-jws-readonly-contract-v1.cjs'),'utf8');
 for(const x of ["crypto.sign(","require('node:fs')","require('node:child_process')",
  "process.env","process.argv","fetch(","writeFileSync(","renameSync(","systemctl "])
  assert.equal(s.includes(x),false,'found privileged operation '+x);
});
