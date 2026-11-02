'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const tool=require('./solo-company-runtime-operator-emergency-v1.cjs');
test('immutable source and release identities',()=>{
  assert.equal(tool.SOURCE_COMMIT,'02966549a751c16b582ce17d15a1e2cf8a22f0fb');
  assert.equal(tool.SOURCE_SHA256,'a93abca70f158729e0e22d39717a6e10a4025b18c44bf60a774ce3bf63fa41dd');
  assert.equal(tool.RELEASE_SHA,'0eb43d72aab3f10db22172c8be4c0411cf22d074');
});
test('source exposes only fixed no-secret operator API',()=>{
  const text=fs.readFileSync(path.join(__dirname,'solo-company-runtime-operator-emergency-v1.cjs'),'utf8');
  assert.match(text,/status:'STARTED'/);
  assert.match(text,/status:'SUCCEEDED'/);
  assert.match(text,/status:'FAILED'/);
  assert.match(text,/provider_signed:false/);
  assert.match(text,/runtime\?\.queue_total!==0/);
  assert.match(text,/original|rollback_performed/); 
  assert.doesNotMatch(text,/shell:\s*true|eval\(/);
  assert.doesNotMatch(text,/EXAMPLE_PRIVATE_KEY|SIGNING_KEY/);
});
test('wrong mode cannot install',()=>{
  const r=cp.spawnSync(process.execPath,[path.join(__dirname,'solo-company-runtime-operator-emergency-v1.cjs'),'--invalid'],{encoding:'utf8',timeout:3000});
  assert.equal(r.status,21);
  assert.match(r.stderr,/unsupported_fixed_mode/);
});
test('preflight fails closed when exact production source unavailable',()=>{
  assert.throws(()=>tool.sourcePreflight(),/ENOENT|source_sha_mismatch|source_git_commit_mismatch|untrusted_source_metadata/);
});
