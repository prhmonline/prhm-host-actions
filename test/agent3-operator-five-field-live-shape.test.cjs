'use strict';
/**
 * Verify the read-only operator evidence can never stand in for a signed,
 * independently attested four-owner registration release.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const pins=require('../ops/agent3-universal-backup/production-registration-contract.json');
const inspector=require('../ops/agent3-universal-backup/five-field-live-contract-inspector.cjs');
const observation=require('../ops/agent3-universal-backup/operator-five-field-live-shape.json');
const preview=require('../ops/agent3-universal-backup/operator-live-patch-preview.json');
const expected={
 base:{count:560,anchors:{canonical_json:3,v2_approval_request:52,signed_approval_boundary:7}},
 executor:{count:1097,anchors:{v2_spec_registry:3,v2_request_handler:9,
  v2_apply_dispatch:4,request_signature_binding:10}},
 policy:{count:1195,anchors:{legacy_installer_operation:2,typed_scopes:1}},
 mcp:{count:49,anchors:{request_tool:4,apply_tool:2,request_schema:8}}
};
test('operator-shape observations match exactly four pinned owner fingerprints and anchor categories',()=>{
 assert.equal(observation.schema,'prhm.agent3.operator-five-field-live-shape.v1');
 assert.equal(observation.target_host,'prhm-production');
 assert.equal(observation.pinned_git_commit,'3e26c8287b61d8d2554c7cc7ae4371e8382cd65e');
 assert.equal(observation.observed_mode,'READ_ONLY_SOURCE_SHAPE');
 assert.deepEqual(Object.keys(observation.observations).sort(),Object.keys(expected).sort());
 for(const [key,rec] of Object.entries(expected)){
  const o=observation.observations[key];
  assert.equal(o.sha256,pins.preimage_sha256[key],key);
  assert.equal(o.sha256,preview.before_sha256[key],key);
  assert.equal(o.line_count,rec.count,key);
  assert.deepEqual(o.anchor_counts,rec.anchors,key);
  assert.deepEqual(Object.keys(o.anchor_counts).sort(),
   inspector.ANCHORS[key].map(x=>x[0]).sort(),key);
  for(const [label,count] of Object.entries(o.anchor_counts)){
   assert.ok(Number.isSafeInteger(count)&&count>=1&&count<=rec.count,key+':'+label);
   const positions=o.sample_lines[label];
   if(positions!==undefined){
    assert.ok(Array.isArray(positions)&&positions.length<=3&&positions.length>=1);
    assert.ok(positions.every(n=>Number.isSafeInteger(n)&&n>0&&n<=rec.count));
    assert.deepEqual(positions,[...new Set(positions)].sort((a,b)=>a-b));
   }
  }
 }
});
test('operator evidence is only read-only metadata, never executable or authorization',()=>{
 const state=observation.evidence_scope;
 for(const k of ['independent_executor_attestation','five_field_mcp_binding_verified',
  'executor_dispatch_wired','approved_four_owner_postimages',
  'immutable_release_manifest_signed','level4_approval_requested',
  'level4_approval_consumed','production_registration_performed',
  'backup_28_files_completed'])assert.equal(state[k],false,k);
 assert.equal(state.operator_supplied_not_machine_signed,true);
 assert.equal(state.anchor_occurrences_only,true);
 assert.equal(state.exact_source_bytes_available_to_reviewer,false);
 assert.equal(preview.security_state.dispatcher_connected,false);
 assert.equal(preview.security_state.ready_for_registration_manifest,false);
});
test('report never copies sensitive owner-source line excerpts or credentials',()=>{
 const s=JSON.stringify(observation);
 assert.ok(s.length<9000);
 for(const forbidden of ['source_excerpt','source_bytes_base64','approval_token',
  'private_key_pem','credentials','installer_enabled','installation_completed']){
  assert.equal(Object.keys(observation.observations).includes(forbidden),false);
 }
 for(const value of Object.values(observation.observations)){
  assert.deepEqual(Object.keys(value).sort(),
   ['sha256','line_count','anchor_counts','sample_lines'].sort());
 }
 assert.equal(s.includes('-----BEGIN PRIVATE KEY-----'),false);
});
