'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const audit=require('../ops/agent3-universal-backup/native-registry-release-audit.cjs');

function validFacts(){
 return {
  pinned_source_commit:'1'.repeat(40),pin_is_ancestor:true,
  source_lock_matches_registrar:true,
  assets:[{path:'ops/agent3-universal-backup/install-candidate.js',matched:true}],
  native:audit.FILES.map(path=>({
   path,present_in_immutable_source:true,matches_current:true
  })),
  manifest_committed:true,
  registration_candidate_not_applied:true,
  release_status_candidate_not_installed:true,
  native_root_dispatch_reviewed:true
 };
}
test('current reviewed source audit detects source v3 pin drift and missing manifest',()=>{
 const facts=audit.pinnedState();
 const result=audit.assess(facts);
 assert.match(facts.pinned_source_commit,/^[a-f0-9]{40}$/);
 assert.equal(facts.source_lock_matches_registrar,true);
 assert.equal(facts.pin_is_ancestor,true);
 assert.equal(facts.manifest_committed,false);
 assert.equal(facts.native_root_dispatch_reviewed,false);
 assert.equal(result.source_candidate_complete,false);
 assert.equal(result.production_install_authorized,false);
 assert.equal(result.production_mutation,false);
 assert.ok(result.source_blockers.some(s=>
  s.startsWith('NATIVE_SOURCE_ABSENT_AT_RELEASE_PIN:')));
 assert.ok(result.source_blockers.includes('FOUR_OWNER_RELEASE_MANIFEST_MISSING'));
 assert.ok(result.source_blockers.includes('TRUSTED_NATIVE_ROOT_DISPATCH_NOT_REVIEWED'));
});
test('a complete synthetic source set still is not authorization to install',()=>{
 const result=audit.assess(validFacts());
 assert.equal(result.source_candidate_complete,true);
 assert.deepEqual(result.source_blockers,[]);
 assert.equal(result.level4_signed_and_consumed,false);
 assert.equal(result.live_root_attested,false);
 assert.equal(result.four_owner_rollback_verified,false);
 assert.equal(result.production_install_authorized,false);
});
test('fail closed on source lock, asset, owner and immutable ancestry drift',()=>{
 const cases=[
  {pin_is_ancestor:false,reason:'IMMUTABLE_SOURCE_NOT_ANCESTOR'},
  {source_lock_matches_registrar:false,reason:'SOURCE_COMMIT_REGISTRATION_DRIFT'},
  {assets:[{path:'reviewed.js',matched:false}],reason:'SOURCE_ASSET_SHA_MISMATCH:reviewed.js'},
  {native:[{path:'root.cjs',present_in_immutable_source:false,matches_current:false}],
   reason:'NATIVE_SOURCE_ABSENT_AT_RELEASE_PIN:root.cjs'},
  {native:[{path:'root.cjs',present_in_immutable_source:true,matches_current:false}],
   reason:'NATIVE_SOURCE_DRIFT:root.cjs'},
  {registration_candidate_not_applied:false,reason:'UNEXPECTED_LIVE_STATUS_CLAIM'},
  {native_root_dispatch_reviewed:false,reason:'TRUSTED_NATIVE_ROOT_DISPATCH_NOT_REVIEWED'}
 ];
 for(const item of cases){
  const {reason,...change}=item;
  const result=audit.assess({...validFacts(),...change});
  assert.equal(result.source_candidate_complete,false,reason);
  assert.ok(result.source_blockers.includes(reason),reason);
  assert.equal(result.production_install_authorized,false);
 }
});
test('auditor exposes no write/install/approval interfaces or shell execution',()=>{
 const src=fs.readFileSync(require.resolve('../ops/agent3-universal-backup/native-registry-release-audit.cjs'),'utf8');
 assert.doesNotMatch(src,/\b(spawn|exec|execFile)Sync\s*\([^]*?\bshell:\s*true/);
 assert.doesNotMatch(src,/\bwriteFileSync\b|\bchmodSync\b|\bchownSync\b|\bmkdirSync\b/);
 assert.doesNotMatch(src,/\bhost_action_v2_apply\b|\bapprovalHttp\b|\bconsumeApproval\b/);
 assert.equal(typeof audit.assess,'function');
 assert.equal(typeof audit.pinnedState,'function');
});
