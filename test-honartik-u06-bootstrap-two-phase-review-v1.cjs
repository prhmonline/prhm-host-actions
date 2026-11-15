'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const M=require('./honartik-u06-bootstrap-two-phase-review-v1.cjs');
const d=()=>Object.fromEntries(Object.keys(M.BLOB_SHA1).map(p=>
 [p,fs.readFileSync(path.join(__dirname,p))]));
const request=()=>({
 repo:M.REPO,sourceCommit:M.SOURCE_COMMIT,host:M.HOST,sourceBuffers:d()
});
test('exact 25-file Git blob SHA1 source review closure is immutable and does not authorize a release',()=>{
 const r=M.verifyPinnedReviewClosure(request());
 assert.equal(r.dependency_files,25);
 assert.equal(r.git_repo,'prhmonline/prhm-host-actions');
 assert.equal(r.reviewed_source_commit,'f2ec0e22f91ef5ef18e0e8606a9dec5c31d3434d');
 assert.equal(r.signed_owner_registration_approval_proven,false);
 assert.equal(r.independent_human_security_review_proven,false);
 assert.equal(r.official_stage_b_consumed_l4_proven,false);
 assert.equal(r.all_five_live_root_actors_bound,false);
 assert.equal(r.legacy_l3_installer_eligible,false);
 assert.equal(r.native_l4_can_authorize_registration,false);
 assert.equal(r.production_release_authorized,false);
 assert.equal(r.root_deploy_performed,false);
 assert.equal(r.root_source_preimage_sha256.approval_policy,
 'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934');
 assert.equal(r.reconciliation_policy_postimage_sha256,
 'f9af71eea8933792a7a518c9d7fc1d85a87afa80cda0c4716002f2fb39dec235');
});
test('all 25 filenames and Git object SHA bytes agree, no content drift',()=>{
 const x=d();
 for(const [name,sha] of Object.entries(M.BLOB_SHA1)){
  const b=x[name];
  const actual=crypto.createHash('sha1')
   .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
  assert.equal(actual,sha,name);
 }
});
test('each dependency file mutation invalidates its exact source closure',()=>{
 const input=request();
 for(const name of Object.keys(M.BLOB_SHA1)){
  const original=input.sourceBuffers[name];
  input.sourceBuffers[name]=Buffer.concat([original,Buffer.from('\nUNTRUSTED_SOURCE_APPEND\n')]);
  assert.throws(()=>M.verifyPinnedReviewClosure(input),/source_blob_drift_/,name);
  input.sourceBuffers[name]=original;
 }
});
test('Git HEAD and repository, exact host and arbitrary unreviewed file fail closed',()=>{
 for(const [key,value] of [['repo','attacker/repo'],['sourceCommit','0'.repeat(40)],['host','other.example']]){
  const input=request();input[key]=value;
  assert.throws(()=>M.verifyPinnedReviewClosure(input),/source_identity_drift/,key);
 }
 const extra=request();extra.sourceBuffers['new-unsigned-root-handler.js']=Buffer.from('module.exports=true');
 assert.throws(()=>M.verifyPinnedReviewClosure(extra),/dependency_closure_drift/);
 const missing=request();delete missing.sourceBuffers['honartik-u06-root-owner-proof-bridge-v1.cjs'];
 assert.throws(()=>M.verifyPinnedReviewClosure(missing),/dependency_closure_drift/);
});
test('no scalar, wrong-buffer or fabricated preapproval may masquerade as signed source proof',()=>{
 const fake=request();
 fake.sourceBuffers['honartik-u06-root-owner-proof-bridge-v1.cjs']={
  signature_verified:true,independent_security_review:true,production_release_authorized:true
 };
 assert.throws(()=>M.verifyPinnedReviewClosure(fake),/source_blob_drift_/);
 const top=request();top.independent_review_approved=true;
 assert.equal(M.verifyPinnedReviewClosure(top).independent_human_security_review_proven,false);
});
test('a Native or legacy L3 approval cannot be reused for the absent recovery registration action',()=>{
 const r=M.verifyPinnedReviewClosure(request());
 assert.notEqual(r.separate_native_operation,r.stage_a_target_operation_to_register);
 assert.equal(r.stage_a_target_operation_to_register,r.stage_b_reconciliation_action);
 // The recovery action is NOT yet registered, so it cannot serve as its
 // own bootstrap authorization. A reviewed separate bootstrap path is required.
 assert.equal(r.stage_a_existing_bootstrap_authority_proven,false);
 assert.equal(r.stage_a_registration_approval_operation,null);
 // The stage A registration authority is NOT implied by the future stage B
 // action that is absent from live policy. Both are blocked independently.
 assert.equal(r.stage_a_registered,false);
 assert.equal(r.stage_b_performed,false);
 assert.equal(r.official_stage_b_consumed_l4_proven,false);
 assert.equal(r.native_l4_can_authorize_registration,false);
 assert.equal(r.legacy_l3_installer_eligible,false);
});
test('source pack has no privileged installer, issuer, mutator or direct Root CLI',()=>{
 assert.equal(M.ROOT_ENTRYPOINT,false);
 assert.equal(M.REGISTRATION_HANDLER,false);
 assert.equal(M.POLICY_APPLY,false);
 assert.equal(M.LEVEL4_ISSUER,false);
 assert.equal(M.PRODUCTION_RELEASE_AUTHORIZED,false);
 for(const p of ['installRoot','registerAction','consumeApproval','issueL4']){
  assert.equal(M[p],undefined,p);
 }
 const r=spawnSync(process.execPath,[path.join(__dirname,
  'honartik-u06-bootstrap-two-phase-review-v1.cjs')],{encoding:'utf8'});
 assert.equal(r.status,64);
 assert.match(r.stderr,/not a two-phase Root installer/);
});
