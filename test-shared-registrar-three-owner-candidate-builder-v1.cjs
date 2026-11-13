'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const b=require('./shared-registrar-three-owner-candidate-builder-v1.cjs');
test('three exact preimages, no user-supplied paths or owner substitution',()=>{
 assert.deepEqual(Object.keys(b.INPUTS),['base.server.js','executor.server.js','mcp.hostActionsV2.js']);
 for(const name of Object.keys(b.INPUTS)){
  const [sha,bytes]=b.INPUTS[name];
  assert.match(sha,/^[0-9a-f]{64}$/);assert.ok(bytes>10000);
  assert.throws(()=>b.buildOne(name,Buffer.alloc(bytes)),/pinned_preimage_mismatch/);
 }
 assert.throws(()=>b.buildOne('policy.json',Buffer.alloc(20000)),/pinned_preimage_mismatch/);
});
test('only private distinct target dirs permitted; existing candidate not overwritten',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'registrar-candidate-gate-'));
 try{
  assert.throws(()=>b.createPrivate(d,d),/unsafe_candidate_target/);
  for(const n of Object.keys(b.INPUTS))fs.writeFileSync(path.join(d,n),'EXISTING_PRIVATE_CONTENT');
  const x=path.join(d,'out');fs.mkdirSync(x);
  fs.writeFileSync(path.join(x,'base.server.js'),'DONT_OVERWRITE');
  assert.throws(()=>b.createPrivate(d,x),/candidate_already_exists/);
  assert.equal(fs.readFileSync(path.join(x,'base.server.js'),'utf8'),'DONT_OVERWRITE');
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});
test('builder is source-only and not a root signer or installer',()=>{
 assert.equal(typeof b.createPrivate,'function');
 assert.equal(typeof b.apply,'undefined');
 assert.equal(typeof b.deploy,'undefined');
 assert.equal(typeof b.issueApproval,'undefined');
});
