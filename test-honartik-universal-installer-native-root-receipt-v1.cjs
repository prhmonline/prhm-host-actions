'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const gate=require('./honartik-universal-installer-native-root-receipt-v1.cjs');
const {CONTRACT}=require('./honartik-universal-installer-l4-v1.cjs');
test('root receipt gate pins immutable exact reviewed policy identity',()=>{
 assert.equal(gate.POLICY_VERSION,
   '2026-10-27.1-honartik-universal-installer-exact-l4-review');
 assert.equal(gate.POLICY_SHA,
   '82334369202b31418e33b44c0ed53e1d4b3ea58acc7e37835b13b60c6ba239cb');
 assert.equal(CONTRACT.level,4);
});
test('unreviewed, partial, arbitrary or CRLF-changed policy bytes are denied',()=>{
 for(const bytes of [Buffer.from('{}'),Buffer.from('not JSON'),
   Buffer.alloc(0),Buffer.from('{"version":"fake"}\r\n')]){
   assert.throws(()=>gate.inspectPinnedPolicy(bytes),/policy_exact_sha_drift/);
 }
});
test('root receipt gate never exposes a token issuer, mutation, or generic file reader',()=>{
 assert.deepEqual(Object.keys(gate).sort(),[
  'POLICY_SHA','POLICY_VERSION','inspectPinnedPolicy','readOnlyRootReceiptPreflight'
 ].sort());
 for(const k of ['applyProduction','install','consumeApproval',
    'issueApproval','readOwned','registerAction','executeCommand']){
   assert.equal(gate[k],undefined,k);
 }
});
test('caller cannot supply alternative policy, ledger, key or root path',()=>{
 const pretend={token:'fake',issuerPublicKey:'fake',policySha:'e'.repeat(64),
   ledger:{consumed:true},root:'/tmp',approval:true};
 assert.throws(()=>gate.readOnlyRootReceiptPreflight(pretend),
   /honartik_root_receipt_root_executor_required|honartik_root_receipt_sealed_receipt_required/);
});
test('no trust files are read from a non-root process',()=>{
 if(typeof process.getuid!=='function'||process.getuid()===0)return;
 let reads=0;
 const original=fs.readFileSync;
 fs.readFileSync=function(...args){reads++;return original.apply(this,args)};
 try{
  assert.throws(()=>gate.readOnlyRootReceiptPreflight('a'.repeat(128)),
    /honartik_root_receipt_root_executor_required/);
  assert.equal(reads,0);
 }finally{fs.readFileSync=original}
});
test('even a locally signed Ed25519 payload cannot confer root authority',()=>{
 const {privateKey}=crypto.generateKeyPairSync('ed25519');
 const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const signingInput=encode({alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid:'untrusted'})+
  '.'+encode({action:CONTRACT.action,level:4});
 const token=signingInput+'.'+crypto.sign(null,Buffer.from(signingInput),privateKey).toString('base64url');
 assert.throws(()=>gate.readOnlyRootReceiptPreflight(token),
  /honartik_root_receipt_root_executor_required|honartik_root_receipt_policy_exact_sha_drift|ENOENT/);
});
