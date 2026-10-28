'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const S=require('./honartik-universal-installer-native-bootstrap-authorization-v1.cjs');
const TX=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const uuid=()=>crypto.randomUUID();
const to64=b=>Buffer.from(b).toString('base64url');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'honartik217-provider-signed-fixture-'));
 fs.chmodSync(root,0o700);
 const workRoot=path.join(root,'journal');
 fs.mkdirSync(workRoot,{mode:0o700});
 const steps=TX.KEYS.map(key=>{
  const filename=path.join(root,key+'.js');
  const before=Buffer.from('original-fixture-owner-'+key+'\n');
  const nextBytes=Buffer.from('candidate-fixture-owner-'+key+'\n');
  fs.writeFileSync(filename,before,{mode:0o600});
  const meta=fs.statSync(filename);
  return {key,path:filename,beforeSha:sha(before),afterSha:sha(nextBytes),nextBytes,
   expectedUid:meta.uid,expectedGid:meta.gid,expectedMode:0o600};
 });
 const plan={schema:'prhm.registrar.native-transaction.v1',
  steps,assets:[],sourceCommit:S.SOURCE_SHA,manifestSha256:'b'.repeat(64)};
 const keypair=crypto.generateKeyPairSync('ed25519');
 const publicKey=keypair.publicKey.export({type:'spki',format:'pem'});
 const kid=sha(keypair.publicKey.export({type:'spki',format:'der'})).slice(0,16);
 const requestId=uuid(),approvalId=uuid();
 const now=Math.floor(Date.now()/1000);
 const claims=()=>({
  schema:S.SCHEMA,issuer:S.ISSUER,audience:S.AUDIENCE,
  operation:S.ACTION,project:'control_plane',environment:'isolated-vm',
  request_id:requestId,approval_id:approvalId,
  source_commit:S.SOURCE_SHA,manifest_sha256:plan.manifestSha256,
  iat:now-2,nbf:now-2,exp:now+100
 });
 const sign=payload=>{
  const head=to64(JSON.stringify({alg:'EdDSA',typ:'PRHM-PROVIDER-ROOT-BOOTSTRAP',kid}));
  const body=to64(JSON.stringify(payload));
  return head+'.'+body+'.'+to64(crypto.sign(null,Buffer.from(head+'.'+body),keypair.privateKey));
 };
 return {root,workRoot,plan,steps,publicKey,requestId,approvalId,now,claims,sign,
  verify:token=>S.verifyBootstrapReceipt({
   token,publicKey,plan,environment:'isolated-vm',requestId,nowSeconds:now}),
  original:()=>steps.forEach(s=>assert.equal(fs.readFileSync(s.path,'utf8'),
   'original-fixture-owner-'+s.key+'\n')),
  dispose:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('provider-specific Ed25519 receipt binds exact request, VM, source, manifest and TTL',()=>{
 const f=fixture();try{
  const v=f.verify(f.sign(f.claims()));
  assert.equal(v.verified,true);
  assert.equal(v.requestId,f.requestId);
  assert.equal(v.approvalId,f.approvalId);
  assert.equal(v.manifestSha256,f.plan.manifestSha256);
 }finally{f.dispose()}
});
test('invalid signatures, wrong signer and opaque noncanonical claims fail closed',()=>{
 const f=fixture();try{
  const ok=f.sign(f.claims());
  const flipped=ok.slice(0,-1)+(ok.endsWith('A')?'B':'A');
  assert.throws(()=>f.verify(flipped),/signature_invalid|token_canonical_encoding/);
  const another=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
  assert.throws(()=>S.verifyBootstrapReceipt({
   token:ok,publicKey:another,plan:f.plan,environment:'isolated-vm',
   requestId:f.requestId,nowSeconds:f.now}),/header_invalid/);
  const noncanonical={...f.claims(),injected_approval:true};
  assert.throws(()=>f.verify(f.sign(noncanonical)),/claims_shape_invalid/);
 }finally{f.dispose()}
});
test('replay across environments, requests or altered manifest is denied',()=>{
 const f=fixture();try{
  const token=f.sign(f.claims());
  assert.throws(()=>S.verifyBootstrapReceipt({token,publicKey:f.publicKey,
   plan:f.plan,environment:'production',requestId:f.requestId,nowSeconds:f.now}),
   /claims_binding_invalid/);
  assert.throws(()=>S.verifyBootstrapReceipt({token,publicKey:f.publicKey,
   plan:f.plan,environment:'isolated-vm',requestId:uuid(),nowSeconds:f.now}),
   /claims_binding_invalid/);
  f.plan.manifestSha256='c'.repeat(64);
  assert.throws(()=>f.verify(token),/claims_binding_invalid/);
 }finally{f.dispose()}
});
test('expiration and forged operation / issuer / source commit are denied',()=>{
 const f=fixture();try{
  for(const patch of [
   {exp:f.now-1},
   {exp:f.now+181},
   {operation:'host_action.honartik_universal_installer_upgrade_v1'},
   {issuer:'prhm-company-approval'},
   {source_commit:'a'.repeat(40)},
   {approval_id:'not-a-uuid'}
  ]){
   assert.throws(()=>f.verify(f.sign({...f.claims(),...patch})),
    /claims_binding_invalid/);
  }
 }finally{f.dispose()}
});
test('one-time durable approval lease cannot be reused, even after failure',()=>{
 const f=fixture();try{
  assert.equal(S.__test.reserveConsumedOnce(f.workRoot,f.approvalId),true);
  const lease=path.join(f.workRoot,'bootstrap-approval-leases',f.approvalId+'.lease');
  assert.equal(fs.existsSync(lease),true);
  assert.equal(fs.statSync(lease).mode&0o777,0o600);
  assert.throws(()=>S.__test.reserveConsumedOnce(f.workRoot,f.approvalId),/EEXIST/);
  assert.equal(fs.existsSync(lease),true);
  assert.throws(()=>S.__test.reserveConsumedOnce(f.workRoot,'../outside'),
   /lease_approval_id_invalid/);
 }finally{f.dispose()}
});
test('distinct bootstrap signer cannot write Production and unpinned owner plan stops',async()=>{
 const f=fixture();try{
  assert.equal(S.PINNED_PROVIDER_KEY_SHA256,null);
  assert.equal(S.PRODUCTION_AUTHORIZED,false);
  assert.equal(S.PROVIDER_DISPATCH_REGISTERED,false);
  assert.throws(()=>S.assertPinnedRegistrationPlan(f.plan),/root_owner_target_or_preimage_drift/);
  // Even root cannot claim production success without independently pinned Provider key.
  await assert.rejects(S.executeSignedRegistrationFromTrustedProvider({
   requestId:f.requestId,environment:'production',plan:f.plan,
   rootSealedTokenLoader:()=>f.sign(f.claims()),
   postInstall:async()=>true,postRollback:async()=>true
  }),/provider_key_not_provisioned|root_required/);
  f.original();
 }finally{f.dispose()}
});
test('signed fixture + durable lease + four-owner transaction and rollback',async()=>{
 const f=fixture();try{
  f.verify(f.sign(f.claims()));
  S.__test.reserveConsumedOnce(f.workRoot,f.approvalId);
  await assert.rejects(TX.executeCore(f.plan,{workRoot:f.workRoot,
   postInstall:async()=>false,postRollback:async()=>true}),/postinstall_health/);
  f.original();
  const journals=fs.readdirSync(f.workRoot).filter(x=>x.startsWith('txn-'));
  assert.equal(journals.length,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workRoot,journals[0],'journal.json'))).status,
   'ROLLED_BACK');
  assert.throws(()=>S.__test.reserveConsumedOnce(f.workRoot,f.approvalId),/EEXIST/);
 }finally{f.dispose()}
});
