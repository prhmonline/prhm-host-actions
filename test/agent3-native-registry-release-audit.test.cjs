'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const audit=require('../ops/agent3-universal-backup/native-registry-release-audit.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const contract=require('../ops/agent3-universal-backup/production-registration-contract.json');

function validFacts(){
 return {
  pinned_source_commit:'1'.repeat(40),pin_is_ancestor:true,
  source_lock_matches_registrar:true,
  assets:[{path:'ops/agent3-universal-backup/install-candidate.js',matched:true}],
  native:audit.FILES.map(path=>({
   path,present_in_immutable_source:true,matches_current:true
  })),
  manifest_committed:true,
  manifest_schema_valid:true,manifest_preimage_pins_match:true,
  registration_candidate_not_applied:true,
  release_status_candidate_not_installed:true,
  native_root_dispatch_reviewed:true
 };
}
test('reviewed native v3 source is pinned while manifest and root dispatcher remain unavailable',()=>{
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
 assert.ok(facts.native.every(item=>item.present_in_immutable_source&&item.matches_current));
 assert.equal(result.source_blockers.some(x=>x.startsWith('NATIVE_SOURCE_ABSENT_AT_RELEASE_PIN:')),false);
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
  {manifest_committed:false,reason:'FOUR_OWNER_RELEASE_MANIFEST_MISSING'},
  {manifest_schema_valid:false,reason:'FOUR_OWNER_RELEASE_MANIFEST_INVALID'},
  {manifest_preimage_pins_match:false,reason:'FOUR_OWNER_PREIMAGE_PIN_MISMATCH'},
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
test('reviewed manifest is schema validated and bound to four pinned preimages',()=>{
 const keys=['base','executor','policy','mcp'];
 const owners=Object.fromEntries(keys.map((key,i)=>[key,{
  path:gateway.OWNER_PATHS[key],
  before_sha256:contract.preimage_sha256[key],
  after_sha256:String(i+1).repeat(64)
 }]));
 const manifest={
  schema_version:'prhm.action-registry.release.v1',
  project:registration.PROJECT,action:registration.INSTALL_ACTION,
  source_commit:registration.SOURCE_COMMIT,
  risk:'critical',approval_level:4,
  registry_owners:owners,
  assets:[{
   path:'/opt/prhm-agent-selfmaint-exec/actions/agent3-backup-installer.cjs',
   source_path:'ops/agent3-universal-backup/install-candidate.js',
   sha256:'a'.repeat(64)
  }],
  rollback_required:true,
  health:{services:[
   'prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
   'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
  ],tool:registration.INSTALL_ACTION},
  git_path:audit.MANIFEST
 };
 const encode=x=>Buffer.from(JSON.stringify(x));
 assert.deepEqual(audit.validateManifest(encode(manifest)),
  {schema_valid:true,preimages_matched:true});
 const changed=JSON.parse(JSON.stringify(manifest));
 changed.registry_owners.base.before_sha256='f'.repeat(64);
 assert.deepEqual(audit.validateManifest(encode(changed)),
  {schema_valid:true,preimages_matched:false});
 const malicious=JSON.parse(JSON.stringify(manifest));
 malicious.action='unrelated_root_action_v1';
 assert.deepEqual(audit.validateManifest(encode(malicious)),
  {schema_valid:false,preimages_matched:false});
 assert.deepEqual(audit.validateManifest(Buffer.from('not-json')),
  {schema_valid:false,preimages_matched:false});
 assert.deepEqual(audit.validateManifest(null),
  {schema_valid:false,preimages_matched:false});
});
test('auditor exposes no write/install/approval interfaces or shell execution',()=>{
 const src=fs.readFileSync(require.resolve('../ops/agent3-universal-backup/native-registry-release-audit.cjs'),'utf8');
 assert.doesNotMatch(src,/\b(spawn|exec|execFile)Sync\s*\([^]*?\bshell:\s*true/);
 assert.doesNotMatch(src,/\bwriteFileSync\b|\bchmodSync\b|\bchownSync\b|\bmkdirSync\b/);
 assert.doesNotMatch(src,/\bhost_action_v2_apply\b|\bapprovalHttp\b|\bconsumeApproval\b/);
 assert.equal(typeof audit.assess,'function');
 assert.equal(typeof audit.pinnedState,'function');
});
