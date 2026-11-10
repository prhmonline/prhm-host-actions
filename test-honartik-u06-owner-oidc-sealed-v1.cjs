'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {audience,PRODUCTION_AUTHORIZED}
  =require('./honartik-u06-owner-oidc-sealed-v1.cjs');
const {sealJwt,openSealedJwt}
  =require('./universal-owner-oidc-sealed-transport-v1.cjs');
const challenge='7'.repeat(64);
const own=crypto.generateKeyPairSync('x25519');
const other=crypto.generateKeyPairSync('x25519');
const pub=x=>x.export({format:'der',type:'spki'}).toString('base64');
test('U06 OIDC audience is exact and distinct from existing generic Universal token',()=>{
  assert.equal(audience(challenge),
    require('./honartik-u06-owner-oidc-identity-gate-v1.cjs').audience(challenge));
  assert.equal(PRODUCTION_AUTHORIZED,false);
  assert.notEqual(audience(challenge),
    'urn:prhm:universal:owner-enrollment:v1:'+challenge);
});
test('reused sealed X25519 transport keeps original JWT private and scoped',()=>{
  const jwt='u06.synthetic.header.payload.signature.'+'A'.repeat(80);
  const env=sealJwt({token:jwt,challenge,serverPublicKeyBase64:pub(own.publicKey)});
  assert.equal(openSealedJwt(env,challenge,own.privateKey),jwt);
  assert.ok(!JSON.stringify(env).includes(jwt));
  assert.throws(()=>openSealedJwt(env,challenge,other.privateKey),
    /transport_authentication_failed/);
  assert.throws(()=>openSealedJwt(env,'8'.repeat(64),own.privateKey),
    /challenge_mismatch/);
});
test('dedicated workflow requires owner and protected environment; no deploy',()=>{
  const f=fs.readFileSync(
    require('node:path').join(__dirname,
      '.github/workflows/honartik-u06-owner-approval-oidc-v1.yml'),'utf8');
  assert.match(f,/workflow_dispatch:/);
  assert.match(f,/github.actor_id == '193396069'/);
  assert.match(f,/environment: prhm-universal-root-enrollment/);
  assert.match(f,/id-token: write/);
  assert.match(f,/persist-credentials: false/);
  assert.match(f,/retention-days: 1/);
  assert.doesNotMatch(f,/(?:docker\s+run|ssh\s+root|kubectl\s+apply|migrate\/up|mysql\.cnf)/);
});
test('U06 OIDC transport is not a root executor or approval signing key',()=>{
  const r=require('./honartik-u06-owner-oidc-sealed-v1.cjs');
  assert.equal(r.ROOT_OPERATION_EXPORTED,false);
  assert.equal(r.PRODUCTION_AUTHORIZED,false);
  assert.equal(r.executeProduction,undefined);
  assert.equal(r.issueApproval,undefined);
});
