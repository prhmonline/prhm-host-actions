'use strict';
/*
 * Operator preflight is evidence about a fixed read-only proposal ONLY.
 * These tests must never imply a trusted registration, install or approval.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const observed=require('../ops/agent3-universal-backup/operator-live-patch-preview.json');
const preimages=require('../ops/agent3-universal-backup/production-registration-contract.json');
const proposal=require('../ops/agent3-universal-backup/four-owner-registration-patch-proposal.cjs');
const sha256=v=>crypto.createHash('sha256').update(v).digest('hex');
const KEYS=['base','executor','policy','mcp'];
test('reported real preflight is bound to exact original owner SHA and distinct four candidate SHA',()=>{
 assert.equal(observed.schema,'prhm.agent3.operator-live-patch-preview.v1');
 assert.equal(observed.capture_type,'user_supplied_server_terminal_output');
 assert.equal(observed.target_host,'prhm-production');
 assert.equal(observed.preflight_git_commit,'3fefc1fa50170c88c048844a7b35668054d5b454');
 assert.equal(observed.observed_result.ok,true);
 assert.equal(observed.observed_result.mode,'READ_ONLY_INCOMPLETE_PATCH_PREVIEW');
 assert.equal(observed.observed_result.owner_count,4);
 assert.equal(observed.observed_result.live_services_verified,4);
 assert.deepEqual(Object.keys(observed.before_sha256).sort(),KEYS.slice().sort());
 assert.deepEqual(Object.keys(observed.candidate_after_sha256).sort(),KEYS.slice().sort());
 assert.deepEqual(observed.before_sha256,preimages.preimage_sha256);
 assert.equal(new Set(Object.values(observed.candidate_after_sha256)).size,4);
 for(const key of KEYS){
  assert.match(observed.candidate_after_sha256[key],/^[0-9a-f]{64}$/);
  assert.notEqual(observed.candidate_after_sha256[key],observed.before_sha256[key]);
 }
 assert.equal(observed.observed_result.action,proposal.ACTION);
});
test('live operator hash evidence CANNOT be promoted as approval, live attestation or install',()=>{
 const s=observed.security_state;
 const negative=[
  'execution_adapter_reviewed','dispatcher_connected',
  'ready_for_registration_manifest','approval_requested','approval_consumed',
  'registry_mutation','production_mutation',
  'original_owner_bytes_disclosed','candidate_bytes_disclosed'
 ];
 for(const key of negative)assert.equal(s[key],false,key);
 assert.match(observed.trust_statement,/not independently signed live host evidence/);
 assert.equal(observed.next_gate,'REVIEW_AND_BIND_TRUSTED_FIVE_FIELD_LEVEL4_EXECUTOR_BEFORE_MANIFEST');
 assert.equal(preimages.registration_can_apply,false);
 const releaseManifest=path.join(__dirname,'../ops/agent3-universal-backup/registry-release-manifest.json');
 assert.equal(fs.existsSync(releaseManifest),false,'Do not commit an installable manifest before trusted five-field L4 registrar bootstrap exists');
});
