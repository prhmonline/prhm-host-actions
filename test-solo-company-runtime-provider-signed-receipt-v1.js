'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const verifier=require('./solo-company-runtime-provider-signed-receipt-v1.js');
const tx=require('./solo-company-runtime-signed-registration-transaction-v1.js');
const reg=require('./solo-company-runtime-l4-registration-candidate-v1.js');

const requestId='33333333-3333-4333-8333-333333333333';
const jti='44444444-4444-4444-8444-444444444444';
const issuedAt=1800000000;
function plan(){
  return {
    schema:'prhm.solo-runtime.registration-plan.v1',action:tx.ACTION,operation:tx.OPERATION,
    release_sha:reg.RELEASE_SHA,source_commits:tx.SOURCE_COMMITS,
    root_helper_sha:tx.PINS.worker_sha,
    steps:tx.ORDER.map(kind=>{
      const bytes=Buffer.from('synthetic-'+kind);
      return {kind,path:tx.TARGETS[kind],bytes,after_sha256:tx.hash(bytes),
        before_sha256:kind==='worker'?null:kind==='core'?tx.PINS.core_before:reg.EXPECTED[kind],
        uid:0,gid:0,mode:0o600};
    })
  };
}
function signer(p=plan()){
  // Synthetic ephemeral test key: NEVER a production Provider identity.
  const pair=crypto.generateKeyPairSync('ed25519');
  const der=pair.publicKey.export({type:'spki',format:'der'});
  const pin=tx.hash(der);
  const header={alg:'EdDSA',typ:verifier.TYPE,kid:pin.slice(0,16)};
  const payload={
    iss:verifier.ISSUER,aud:verifier.AUDIENCE,env:'production',
    operation:verifier.OPERATION,action:verifier.ACTION,release_sha:p.release_sha,
    plan_sha256:verifier.hashPlan(p),request_id:requestId,jti,
    level:4,risk:'critical',one_time_use:true,
    iat:issuedAt,exp:issuedAt+120,source_commits:tx.SOURCE_COMMITS
  };
  function sign(body=payload,head=header){
    const first=Buffer.from(JSON.stringify(head)).toString('base64url');
    const second=Buffer.from(JSON.stringify(body)).toString('base64url');
    const bytes=Buffer.from(first+'.'+second);
    return first+'.'+second+'.'+crypto.sign(null,bytes,pair.privateKey).toString('base64url');
  }
  return {plan:p,publicKeyPem:pair.publicKey.export({type:'spki',format:'pem'}),
    pin,header,payload,token:sign(),sign};
}
function check(s,patch={}){
 return verifier.verifyReceipt({token:s.token,publicKeyPem:s.publicKeyPem,
   pinnedPublicKeySha256:s.pin,plan:s.plan,requestId,nowSeconds:issuedAt+30,...patch});
}
test('valid synthetic Ed25519 receipt verifies exact action, SHA, key pin and TTL',()=>{
 const s=signer();const proof=check(s);
 assert.equal(proof.verified,true);assert.equal(proof.consumed,false);
 assert.equal(proof.plan_sha256,verifier.hashPlan(s.plan));
 assert.equal(proof.level,4);assert.equal(proof.operation,verifier.OPERATION);
});
test('signature, key, action, plan or release tampering fails closed',()=>{
 const s=signer();
 assert.throws(()=>check(s,{token:s.token.replace(/.$/,'X')}),/receipt_/);
 assert.throws(()=>check(s,{pinnedPublicKeySha256:'0'.repeat(64)}),/pin_mismatch/);
 assert.throws(()=>check(s,{token:s.sign({...s.payload,operation:'host_action.evil'})}),/scope_invalid/);
 assert.throws(()=>check(s,{token:s.sign({...s.payload,plan_sha256:'a'.repeat(64)})}),/plan_binding_invalid/);
 assert.throws(()=>check(s,{token:s.sign({...s.payload,level:3})}),/approval_binding_invalid/);
 assert.throws(()=>check(s,{plan:{...s.plan,steps:s.plan.steps.slice(0,5)}}),/installation_plan_binding_invalid/);
 assert.throws(()=>check(s,{requestId:'55555555-5555-4555-8555-555555555555'}),/approval_binding_invalid/);
});
test('expired, excessive TTL or noncanonical claims reject',()=>{
 const s=signer();
 assert.throws(()=>check(s,{nowSeconds:issuedAt+120}),/expired_or_invalid/);
 assert.throws(()=>check(s,{token:s.sign({...s.payload,exp:issuedAt+999})}),/expired_or_invalid/);
 assert.throws(()=>check(s,{token:s.sign({...s.payload,unexpected:'field'})}),/claims_invalid/);
 assert.throws(()=>check(s,{token:s.token+';bad'}),/receipt_(token_structure|encoding)/);
});
test('durable consume-once marker forbids replay and survives rollback simulation',()=>{
 const s=signer(),verified=check(s);
 const ledger=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-solo-receipt-'));
 try{
  fs.chmodSync(ledger,0o700);
  const consumed=verifier.consumeReceipt(verified,ledger,issuedAt+31);
  assert.equal(consumed.consumed,true);
  assert.equal(fs.readdirSync(ledger).length,1);
  assert.throws(()=>verifier.consumeReceipt(verified,ledger,issuedAt+32),/receipt_replay/);
  assert.throws(()=>verifier.consumeReceipt(consumed,ledger,issuedAt+32),/consumption_binding_invalid/);
  assert.equal(fs.readdirSync(ledger).length,1);
 }finally{fs.rmSync(ledger,{recursive:true,force:true})}
});
test('trusted caller can verify and consume a signed receipt only once',()=>{
 const s=signer();
 const ledger=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-solo-verified-'));
 try{
  fs.chmodSync(ledger,0o700);
  const args={token:s.token,publicKeyPem:s.publicKeyPem,
    pinnedPublicKeySha256:s.pin,plan:s.plan,requestId,
    nowSeconds:issuedAt+32,ledgerDir:ledger};
  assert.equal(verifier.verifyAndConsume(args).consumed,true);
  assert.throws(()=>verifier.verifyAndConsume(args),/receipt_replay/);
  assert.equal(fs.readdirSync(ledger).length,1);
 }finally{fs.rmSync(ledger,{recursive:true,force:true})}
});
test('no standalone production signer or installer CLI',()=>{
 const cp=require('node:child_process');
 const run=cp.spawnSync(process.execPath,[path.join(__dirname,'solo-company-runtime-provider-signed-receipt-v1.js')],{encoding:'utf8'});
 assert.equal(run.status,64);
 assert.match(run.stderr,/NO_CLI/);
});
