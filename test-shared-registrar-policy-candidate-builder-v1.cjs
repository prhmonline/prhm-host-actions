'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const b=require('./shared-registrar-policy-candidate-builder-v1.cjs');
test('builder pins reviewed existing policy and new critical registrar version',()=>{
 assert.match(b.ORIGINAL_SHA,/^[a-f0-9]{64}$/);
 assert.equal(b.NEW_VERSION,'2026-10-27.2-shared-registrar-bootstrap-proposal');
 assert.equal(b.OPERATION,'host_action.prhm_action_registry_install_v1');
});
test('no arbitrary input can replace current production policy preimage',()=>{
 for(const content of [
  Buffer.alloc(30333),
  Buffer.from(JSON.stringify({version:b.OLD_VERSION})),
  Buffer.from(JSON.stringify({version:b.NEW_VERSION}))
 ])assert.throws(()=>b.build(content),/registrar_policy_candidate_baseline_sha_mismatch/);
});
test('builder rejects same-path overwrite even with malicious input',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'registrar-policy-'));
 try{
  fs.writeFileSync(path.join(d,'approval-policy.json'),'SAFE-BYTES');
  assert.throws(()=>b.createPrivate(d,d),/registrar_policy_candidate_unsafe_output_path/);
  assert.equal(fs.readFileSync(path.join(d,'approval-policy.json'),'utf8'),'SAFE-BYTES');
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});
