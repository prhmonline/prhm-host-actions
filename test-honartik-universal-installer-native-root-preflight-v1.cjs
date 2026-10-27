'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./honartik-universal-installer-native-root-preflight-v1.cjs');
const C=m.CONTRACT;
const good=()=>Buffer.from(JSON.stringify({
 activated_as_legacy_entrypoint:false,
 digest:C.existing_digest,
 entrypoint:C.installer_prefix+'/deploy-project',
 previous:'37451fe215b94fd5e90f4f732aaf843b8c18739f38c4a47da4b09cbd532d8249'
}));
test('exact action and bound target sha',()=>{
 assert.equal(C.action,'honartik_universal_installer_upgrade_v1');
 assert.equal(C.candidate_digest,
   '8680011e11ad8eae89707b74492e60354c4b7e56799b205d3da581e92806a552');
 assert.equal(C.level,4);
});
test('parse exact preimage manifest',()=>{
 assert.equal(m.parseManifest(good()).digest,C.existing_digest);
});
test('first installer manifest may carry previous:null',()=>{
 const mft=JSON.parse(good());mft.previous=null;
 assert.equal(m.parseManifest(Buffer.from(JSON.stringify(mft))).previous,null);
});
test('reject wrong current digest',()=>{
 const v=JSON.parse(good());v.digest='a'.repeat(64);
 assert.throws(()=>m.parseManifest(Buffer.from(JSON.stringify(v))),/manifest_mismatch/);
});
test('reject redirect to unreviewed wrapper',()=>{
 const v=JSON.parse(good());v.entrypoint='/tmp/untrusted-wrapper';
 assert.throws(()=>m.parseManifest(Buffer.from(JSON.stringify(v))),/manifest_mismatch/);
});
test('reject invalid previous version hash',()=>{
 const v=JSON.parse(good());v.previous='wrong';
 assert.throws(()=>m.parseManifest(Buffer.from(JSON.stringify(v))),/manifest_mismatch/);
});
test('reject broken JSON',()=>{
 assert.throws(()=>m.parseManifest(Buffer.from('{')),/manifest_json/);
});
test('known SHA-256 test vector',()=>{
 assert.equal(m.hash(Buffer.from('abc')),
   'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('no production mutation or registration exports',()=>{
 assert.equal(m.NATIVE_REGISTRATION_IMPLEMENTED,false);
 assert.equal(m.PRODUCTION_EXECUTION_AUTHORIZED,false);
 assert.deepEqual(Object.keys(m).sort(),[
  'CONTRACT','hash','parseManifest','inspectLivePreimage',
  'NATIVE_REGISTRATION_IMPLEMENTED','PRODUCTION_EXECUTION_AUTHORIZED'
 ].sort());
});
test('non-root invocation is fail-closed',()=>{
 if(typeof process.getuid==='function'&&process.getuid()!==0){
  assert.throws(()=>m.inspectLivePreimage(),/root_required/);
 }
});
