'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const child=require('node:child_process');
const ledger=require('./solo-universal-v2-root-permit-ledger-v1.cjs');
const contract=require('./solo-universal-v2-signed-release-contract-v1.cjs');
const P=contract.PINS;
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const pub=publicKey.export({type:'spki',format:'pem'});
const keyPin=crypto.createHash('sha256').update(
  publicKey.export({type:'spki',format:'der'})).digest('hex');
const now=1794230000;
const driver='a'.repeat(40);
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
let pass=0;
function test(name,fn) {
  fn();pass++;console.log('PASS '+name);
}
function sign(fields={}){
  const claims={
    iss:P.issuer,aud:P.audience,operation:P.operation,
    environment:'production',project:'solo_company',level:4,risk:'critical',
    one_time_use:true,source_repo:P.source_repo,source_anchor:P.source_anchor,
    driver_git_sha:driver,installed_digest:P.installed_digest,
    manifest_preimage_sha256:P.manifest_preimage_sha256,
    candidate_digest:P.candidate_digest,profile_sha256:P.profile_sha256,
    runtime_release:P.runtime_release,request_id:crypto.randomUUID(),
    jti:crypto.randomUUID(),iat:now-1,exp:now+120,...fields,
  };
  const head={alg:'EdDSA',typ:P.type,kid:keyPin.slice(0,16)};
  const encoded=encode(head)+'.'+encode(claims);
  return encoded+'.'+crypto.sign(null,Buffer.from(encoded),privateKey)
    .toString('base64url');
}
function proof(fields={}){
  return contract.verifySignedPermit({token:sign(fields),publicKeyPem:pub,
    expectedKeySha:keyPin,driverGitSha:driver,nowSec:now});
}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'solo-v2-l4-replay-'));
try {
  fs.chmodSync(root,0o700);
  test('test receipt is a real verified Ed25519 JWS',()=>{
    const p=proof();
    assert.equal(p.verified,true);
    assert.equal(p.consumed,false);
    assert.equal(p.operation,P.operation);
    assert.notEqual(p.signer_key_pin,P.owner_spki_sha256);
  });
  test('one-use replay marker is durable and 0600',()=>{
    const p=proof();
    const g=ledger.durableConsumeVerified(p,root,now);
    assert.equal(g.consumed,true);
    assert.equal(g.operation,P.operation);
    const file=path.join(root,p.jti+'.json');
    assert.equal(fs.statSync(file).mode&0o777,0o600);
    assert.equal(JSON.parse(fs.readFileSync(file)).request_id,p.request_id);
    assert.throws(()=>ledger.durableConsumeVerified(p,root,now),
      /signed_one_time_receipt_replay/);
  });
  test('expired and unknown identity forbidden even with valid proof',()=>{
    const p=proof();
    assert.throws(()=>ledger.durableConsumeVerified(p,root,now+150),
      /receipt_untrusted/);
    assert.throws(()=>ledger.durableConsumeVerified({...p,operation:
      'host_action.solo_company_runtime_registration_v1'},root,now),
      /receipt_untrusted/);
    assert.throws(()=>ledger.durableConsumeVerified({...p,jti:'oops'},root,now),
      /receipt_untrusted/);
  });
  test('synthetic grant cannot pass pinned production verifier',()=>{
    assert.throws(()=>contract.verifyProductionOwnerPermit({
      token:sign(),publicKeyPem:pub,driverGitSha:driver,nowSec:now}),
      /owner_key_pin_mismatch/);
  });
  test('test fixture directory must be private',()=>{
    const p=proof(),dir=path.join(root,'world');
    fs.mkdirSync(dir,0o777);fs.chmodSync(dir,0o755);
    assert.throws(()=>ledger.durableConsumeVerified(p,dir,now),
      /ledger_permissions_untrusted/);
  });
  test('production bridge is not a CLI',()=>{
    const r=child.spawnSync(process.execPath,
      [path.join(__dirname,'solo-universal-v2-root-permit-ledger-v1.cjs')],
      {encoding:'utf8'});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/NO_CLI/);
  });
  console.log('SOLO_UNIVERSAL_V2_LEDGER_TESTS='+pass+' PASS');
}finally{
  fs.rmSync(root,{recursive:true,force:true});
}