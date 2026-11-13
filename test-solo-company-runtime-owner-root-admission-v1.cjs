'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const path=require('node:path');
const owner=require('./solo-company-runtime-owner-root-admission-v1.cjs');
const tx=require('./solo-company-runtime-signed-registration-transaction-v1.js');

const publicKeyPem='-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAJ7/31J6Wwl7p0x/RRSZZLvAzro7HtAZEOpSjfh4d+fg=\n-----END PUBLIC KEY-----\n';
const shaOld='788353cb2a4420693c8364af3282b3c662398381';
const waiver=Buffer.from(owner.waiverMessage(shaOld,'2026-11-08'),'ascii');
const signed=Buffer.from('hiCkuTTQ6stsa4IId4u8GsdSwvVbTriCKXyE1v93/iKse8+tRGdu/qmSHaygNG7I/0bjHT86Gb/X5mWy3eE/AQ==','base64');

test('historical owner waiver cryptographically validates exactly original SHA',()=>{
  assert.equal(tx.hash(waiver),'2d1337a0463c47b87159deb5d09f6f0f3f6c229b7275459c168be142be75f5e0');
  assert.equal(signed.length,64);
  const result=owner.verifyWaiver({publicKeyPem,message:waiver,
    signature:signed,hostHead:shaOld});
  assert.equal(result.verified,true);
  assert.equal(result.registration_authorized,false);
  assert.equal(result.review_waived,true);
});
test('old signed waiver is not valid for changed pull request source',()=>{
  assert.throws(()=>owner.verifyWaiver({publicKeyPem,message:waiver,
    signature:signed,hostHead:'9c53bbd62d78975277b3971fe46ba49b097c185a'}),
    /waiver_commit_mismatch/);
});
test('waiver tampering, other key and malformed source are refused',()=>{
  const bad=Buffer.from(waiver);bad[6]^=1;
  assert.throws(()=>owner.verifyWaiver({publicKeyPem,message:bad,
    signature:signed,hostHead:shaOld}),/waiver_commit_mismatch/);
  const corrupted=Buffer.from(signed);corrupted[0]^=1;
  assert.throws(()=>owner.verifyWaiver({publicKeyPem,message:waiver,
    signature:corrupted,hostHead:shaOld}),/waiver_signature_invalid/);
  const testKey=crypto.generateKeyPairSync('ed25519');
  const wrong=testKey.publicKey.export({format:'pem',type:'spki'});
  assert.throws(()=>owner.pinnedPublicKey(wrong),/public_key_pin_mismatch/);
  assert.throws(()=>owner.waiverMessage('not-a-sha','2026-11-08'),/waiver_source_date_invalid/);
});
test('owner admission does not offer a standalone signer or production installer',()=>{
  assert.equal(typeof owner.sign,'undefined');
  assert.equal(typeof owner.apply,'undefined');
  const r=cp.spawnSync(process.execPath,[path.join(__dirname,'solo-company-runtime-owner-root-admission-v1.cjs')],{encoding:'utf8'});
  assert.equal(r.status,64);
  assert.match(r.stderr,/NO_CLI/);
});
