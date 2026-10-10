'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const p=require('./prhm-fast-delivery-rahekomak-pilot-v1.cjs');
const SHA='c89241e415a093f9c07782ce156b51c7019368c5';
test('RahKomak action bound to one canonical web-only target',()=>{
 assert.equal(p.ACTION,'rahekomak_web_only_release_v1');
 assert.equal(p.ROOT,'/home/prhm/projects/generated/rahekomak');
 assert.deepEqual(p.NUMBERS,['121','122','194','124','195']);
});
test('no production deploy mode or arbitrary paths accepted',()=>{
 for(const bad of [[],['--apply',SHA],['--verify','main'],['--verify',SHA,'--apply']])
  assert.throws(()=>p.main(bad),/only_verify_mode_supported|sha_must_be_40_hex/);
});
test('environment never inherits caller-supplied approval or secrets',()=>{
 process.env.RAHEKOMAK_RELEASE_APPROVAL_MODE='approved_web_only';
 process.env.PRIVATE_TEST_SECRET='test';
 try{
  const env=p.fixedEnv({RAHEKOMAK_RELEASE_SHA:SHA});
  assert.equal(env.RAHEKOMAK_RELEASE_SHA,SHA);
  assert.equal(env.RAHEKOMAK_RELEASE_APPROVAL_MODE,undefined);
  assert.equal(env.PRIVATE_TEST_SECRET,undefined);
 }finally{
  delete process.env.PRIVATE_TEST_SECRET;
  delete process.env.RAHEKOMAK_RELEASE_APPROVAL_MODE;
 }
});
test('invalid SHA and unauthorized environment overrides fail before access',()=>{
 assert.throws(()=>p.checkRequest('main'),/sha_must_be_40_hex/);
 assert.throws(()=>p.fixedEnv({RAHEKOMAK_RELEASE_APPROVAL_MODE:'approved_web_only'}),/unsafe_environment_override/);
 assert.throws(()=>p.fixedEnv({RAHEKOMAK_RELEASE_SHA:'main'}),/invalid_child_sha/);
});
