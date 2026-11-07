'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const audit=require('../ops/agent3-universal-backup/native-v3-addon-binary-build-audit.cjs');
const cli=path.resolve(__dirname,
 '../ops/agent3-universal-backup/native-v3-addon-binary-build-audit.cjs');
test('source-only native binary audit is strictly CI-only and never applies',()=>{
 const r=cp.spawnSync(process.execPath,[cli,'--apply'],{
  timeout:10000,encoding:'utf8'
 });
 assert.equal(r.status,64);
 assert.match(r.stderr,/strict --ci mode only/);
 assert.equal(r.stdout,'');
});
test('audit hashes bytes and only exposes fixed C compiler hardening flags',()=>{
 assert.equal(audit.sha(Buffer.from('test')),
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
 for(const flag of ['-fstack-protector-strong','-D_FORTIFY_SOURCE=2',
  '-Wl,-z,relro','-Wl,-z,now','-Wall','-Wextra','-Werror']){
  assert.ok(audit.flags.includes(flag),flag);
 }
 assert.equal(Object.isFrozen(audit.flags),true);
 const source=fs.readFileSync(path.resolve(__dirname,
  '../ops/agent3-universal-backup/native-linux-so-peercred-addon.c'),'utf8');
 assert.match(source,/SO_PEERCRED/);
 assert.match(source,/SO_ACCEPTCONN/);
 assert.match(source,/getpeername/);
});

test('CI-review binary pin refuses toolchain drift and forged production readiness',()=>{
 const lock=require('../ops/agent3-universal-backup/native-v3-addon-ci-build-lock.json');
 const head=require('node:child_process').execFileSync('git',
  ['rev-parse','--verify','HEAD'],{
   cwd:path.resolve(__dirname,'..'),encoding:'utf8'
  }).trim();
 const baseline={
  git_head:head,
  source_sha256:lock.source_sha256,
  binary_sha256_in_this_toolchain:lock.binary_sha256_for_this_toolchain,
  node_version:lock.node_version,
  napi_version:lock.napi_version,
  node_header_sha256:lock.node_header_sha256,
  compiler_identification:lock.compiler_identification,
  platform:lock.platform,
  arch:lock.arch,
  production_binary_attested:false,
  production_node_fd_api_attested:false,
  release_ready:false
 };
 assert.equal(audit.verifyCIReviewLock(baseline,lock),true);
 assert.throws(()=>audit.verifyCIReviewLock({
  ...baseline,binary_sha256_in_this_toolchain:'a'.repeat(64)
 },lock),/ci_review_lock_drift:binary_sha256_in_this_toolchain/);
 assert.throws(()=>audit.verifyCIReviewLock({
  ...baseline,node_version:'20.0.0'
 },lock),/ci_review_lock_drift:node_version/);
 assert.throws(()=>audit.verifyCIReviewLock({
  ...baseline,production_binary_attested:true
 },lock),/ci_result_forged_production_ready/);
 assert.throws(()=>audit.verifyCIReviewLock(baseline,{
  ...lock,production_binary_attested:true
 }),/ci_lock_forged_production_ready/);
 assert.throws(()=>audit.verifyCIReviewLock(baseline,{
  ...lock,compiler_flags:['-O0']
 }),/ci_hardening_flags_drift/);
});
