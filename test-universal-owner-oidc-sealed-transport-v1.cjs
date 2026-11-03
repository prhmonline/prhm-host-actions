'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const seal=require('./universal-owner-oidc-sealed-transport-v1.cjs');
const a=crypto.generateKeyPairSync('x25519');
const b=crypto.generateKeyPairSync('x25519');
const pub=k=>k.export({format:'der',type:'spki'}).toString('base64');
const challenge='a'.repeat(64);
const token='header.payload.signature.'+'x'.repeat(80);
test('JWT is encrypted for exact server transport key',()=>{
 const sealed=seal.sealJwt({token,challenge,serverPublicKeyBase64:pub(a.publicKey)});
 assert.equal(seal.openSealedJwt(sealed,challenge,a.privateKey),token);
 assert.ok(!JSON.stringify(sealed).includes(token));
 assert.notEqual(sealed.ciphertext_b64,Buffer.from(token).toString('base64'));
});
test('wrong root transport key is rejected',()=>{
 const encrypted=seal.sealJwt({token,challenge,serverPublicKeyBase64:pub(a.publicKey)});
 assert.throws(()=>seal.openSealedJwt(encrypted,challenge,b.privateKey),/transport_authentication_failed/);
});
test('wrong challenge is rejected',()=>{
 const encrypted=seal.sealJwt({token,challenge,serverPublicKeyBase64:pub(a.publicKey)});
 assert.throws(()=>seal.openSealedJwt(encrypted,'b'.repeat(64),a.privateKey),/challenge_mismatch/);
});
test('tampered authenticated ciphertext is rejected',()=>{
 const encrypted=seal.sealJwt({token,challenge,serverPublicKeyBase64:pub(a.publicKey)});
 const data=Buffer.from(encrypted.ciphertext_b64,'base64'); data[0]^=1;
 assert.throws(()=>seal.openSealedJwt({...encrypted,ciphertext_b64:data.toString('base64')},challenge,a.privateKey),/transport_authentication_failed/);
});
test('tampered AES-GCM tag is rejected',()=>{
 const encrypted=seal.sealJwt({token,challenge,serverPublicKeyBase64:pub(a.publicKey)});
 const tag=Buffer.from(encrypted.tag_b64,'base64');tag[0]^=1;
 assert.throws(()=>seal.openSealedJwt({...encrypted,tag_b64:tag.toString('base64')},challenge,a.privateKey),/transport_authentication_failed/);
});
test('untrusted RSA public key cannot receive transport evidence',()=>{
 const {publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>seal.sealJwt({token,challenge,serverPublicKeyBase64:pub(publicKey)}),/public_key_not_x25519/);
});
test('invalid or noncanonical challenge is rejected',()=>{
 assert.throws(()=>seal.sealJwt({token,challenge:'0'.repeat(63),serverPublicKeyBase64:pub(a.publicKey)}),/challenge/);
});
test('even a fresh transport envelope has no Root execution interface',()=>{
 assert.equal(typeof seal.executeInstall,'undefined');
 assert.equal(typeof seal.issueSignedLevel4,'undefined');
});
