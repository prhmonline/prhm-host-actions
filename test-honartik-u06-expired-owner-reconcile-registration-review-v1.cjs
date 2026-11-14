'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const Review=require('./honartik-u06-expired-owner-reconcile-registration-review-v1.cjs');
const name='honartik-u06-expired-owner-reconcile-registration-review-v1.cjs';
const repo=path.join(__dirname,name);
const source=()=>Object.fromEntries(Object.keys(Review.ASSETS).map(n=>[n,fs.readFileSync(path.join(__dirname,n))]));
const opts=()=>({
 sourceRepo:Review.REPO,sourceCommit:Review.PINNED_CODE_HEAD,
 host:Review.ROOT_HOST,installedRootBridgeSha256:Review.ROOT_BRIDGE_SHA256,
 sourceBuffers:source()
});
test('all nine exact Git blob fingerprints match this fixed reviewed candidate',()=>{
 const data=opts();
 for(const [name,expected] of Object.entries(Review.ASSETS)){
  const buf=data.sourceBuffers[name];
  const actual=crypto.createHash('sha1').update(Buffer.from('blob '+buf.length+'\0'))
   .update(buf).digest('hex');
  assert.equal(actual,expected,name);
 }
 const result=Review.reviewFixedCandidate(data);
 assert.equal(result.source_review_passed,true);
 assert.equal(result.source_files,9);
 assert.equal(result.action,'honartik_u06_expired_owner_oidc_reconcile_v1');
 assert.equal(result.operation,'host_action.honartik_u06_expired_owner_oidc_reconcile_v1');
});
test('review must never authorize registration, Root apply, OIDC reuse, Native or Level4 issuance',()=>{
 const r=Review.reviewFixedCandidate(opts());
 for(const k of ['root_registration_authorized','production_mutation_authorized',
 'old_challenge_retired','native_backup_executed','owner_oidc_verified','apply_available',
 'old_bootstrap_replay_permitted','expired_github_oidc_replay_permitted']) assert.equal(r[k],false,k);
 for(const k of ['requires_signed_exact_scope_one_use_l4',
 'requires_authorized_root_action_registration','requires_shared_root_lock_for_all_five_actors']) assert.equal(r[k],true,k);
 assert.notEqual(r.level4_approval_operation,r.separate_native_level4_operation);
 assert.equal(Review.PRODUCTION_MUTATION_AUTHORIZED,false);
 assert.equal(Review.LEVEL4_ISSUER,false);
 assert.equal(Review.ROOT_ACTION_REGISTERED,false);
 assert.equal(Review.APPLY_EXPORTED,false);
 assert.equal(Review.apply,undefined);
 assert.equal(Review.register,undefined);
});
test('changed, truncated and wrongly encoded source bytes fail closed',()=>{
 const data=opts();
 const fname=Object.keys(Review.ASSETS)[0];
 data.sourceBuffers[fname]=Buffer.concat([data.sourceBuffers[fname],Buffer.from('\n// injected\n')]);
 assert.throws(()=>Review.reviewFixedCandidate(data),/blob_sha_mismatch_/);
 const d=opts();d.sourceBuffers[fname]=Buffer.from('invalid');
 assert.throws(()=>Review.reviewFixedCandidate(d),/source_type_/);
 const x=opts();x.sourceBuffers[fname]=x.sourceBuffers[fname].toString('utf8');
 assert.throws(()=>Review.reviewFixedCandidate(x),/source_type_/);
});
test('missing, added and renamed files are not accepted',()=>{
 const missing=opts();delete missing.sourceBuffers[Object.keys(Review.ASSETS)[0]];
 assert.throws(()=>Review.reviewFixedCandidate(missing),/source_closure_drift/);
 const added=opts();added.sourceBuffers['readme.txt']=Buffer.from('unused');
 assert.throws(()=>Review.reviewFixedCandidate(added),/source_closure_drift/);
 const array=opts();array.sourceBuffers=[];
 assert.throws(()=>Review.reviewFixedCandidate(array),/source_closure_drift/);
});
test('wrong source repository, moving SHA or wrong live Root preimage rejected',()=>{
 const badRepo=opts();badRepo.sourceRepo='another/repository';
 assert.throws(()=>Review.reviewFixedCandidate(badRepo),/git_source_drift/);
 const wrongSHA=opts();wrongSHA.sourceCommit='0'.repeat(40);
 assert.throws(()=>Review.reviewFixedCandidate(wrongSHA),/git_source_drift/);
 const wrongRoot=opts();wrongRoot.installedRootBridgeSha256='0'.repeat(64);
 assert.throws(()=>Review.reviewFixedCandidate(wrongRoot),/root_host_preimage_drift/);
 const wrongHost=opts();wrongHost.host='node1';
 assert.throws(()=>Review.reviewFixedCandidate(wrongHost),/root_host_preimage_drift/);
});
test('no Root CLI, registration endpoint or file mutation from importing review module',()=>{
 const proc=spawnSync(process.execPath,[repo],{encoding:'utf8'});
 assert.equal(proc.status,64);
 assert.match(proc.stderr,/review ONLY/);
 assert.equal(proc.stdout,'');
 const sourceText=fs.readFileSync(repo,'utf8');
 assert.doesNotMatch(sourceText,/child_process|spawnSync|execSync|unlinkSync|renameSync|chmodSync|chownSync|systemctl/);
 assert.match(sourceText,/ROOT_ACTION_REGISTERED:false/);
 assert.match(sourceText,/PRODUCTION_MUTATION_AUTHORIZED:false/);
});
