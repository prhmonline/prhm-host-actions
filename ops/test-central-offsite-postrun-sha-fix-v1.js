'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const {hash,plan,validPostrun,OLD,NEW,PREIMAGE_SHA256}=require('./central-offsite-postrun-sha-fix-v1.js');
const fixture=`'use strict'; const SHA=/^[a-f0-9]{64}$/; function post(b){const x={}; if(x.status!=='pass'||x.snapshot!==b.snapshot||!SHA.test(String(x.sha256||'')))throw Error('central_offsite_postrun_evidence_mismatch');return x;} module.exports={post};`;
const example={status:'pass',snapshot:'20261010T092103Z',runner_sha256:'a'.repeat(64),local_encrypted_repository_check_5pct:'pass',remote_object_exact_size:'pass',bundle_sha256:'b'.repeat(64),bundle_size:1328373760};
const binding={snapshot:example.snapshot,runner_sha256:example.runner_sha256};

test('reproduces the mismatch: persisted bundle_sha256 exists, legacy sha256 does not',()=>{
  assert.equal(example.sha256,undefined);
  assert.equal(validPostrun(example,binding),true);
});
test('exactly one legacy token changes and generated source is valid JS',()=>{
  const before=hash(fixture),p=plan(fixture,{preimageSha256:before});
  assert.equal(p.old_sha256,before);
  assert.equal(p.change_count,1);
  assert.equal(p.patch_content.includes(NEW),true);
  assert.equal(p.patch_content.includes(OLD),false);
  assert.notEqual(p.new_sha256,p.old_sha256);
});
test('preimage drift fails closed',()=>assert.throws(()=>plan(fixture,{preimageSha256:PREIMAGE_SHA256}),/PREIMAGE_SHA256_MISMATCH/));
test('ambiguous duplicate token fails closed',()=>{
  const duplicate=fixture+';const other='+JSON.stringify(OLD)+';';
  assert.throws(()=>plan(duplicate,{preimageSha256:hash(duplicate)}),/POSTRUN_SHA_FIELD_MATCH_COUNT_NOT_ONE/);
});
test('missing postrun function fails closed',()=>{
  const other=`const x="${OLD}";`;
  assert.throws(()=>plan(other,{preimageSha256:hash(other)}),/POSTRUN_VALIDATOR_NOT_FOUND/);
});
test('incorrect hash or binding fails closed',()=>{
  assert.equal(validPostrun({...example,bundle_sha256:'INVALID'},binding),false);
  assert.equal(validPostrun({...example,bundle_sha256:undefined},binding),false);
  assert.equal(validPostrun({...example,remote_object_exact_size:'fail'},binding),false);
  assert.equal(validPostrun({...example,snapshot:'20261009T212909Z'},binding),false);
  assert.equal(validPostrun(example,{...binding,runner_sha256:'c'.repeat(64)}),false);
});
test('CLI rejects apply and never mutates production',()=>{
  const result=cp.spawnSync(process.execPath,[path.join(__dirname,'central-offsite-postrun-sha-fix-v1.js'),'--apply'],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,2);
  assert.match(result.stderr,/READ_ONLY_ONLY/);
});
