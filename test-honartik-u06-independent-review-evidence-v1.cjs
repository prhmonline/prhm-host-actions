'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),path=require('node:path');
const G=require('./honartik-u06-independent-review-evidence-v1.cjs');
const sha='a'.repeat(40),old='b'.repeat(40);
const review=(user='security-reviewer',state='APPROVED',commit_id=sha,submitted_at='2026-11-15T13:00:00Z')=>
 ({user,state,commit_id,submitted_at});
const opts=(reviews=[],permissions={})=>({
 repository:G.REPO,prNumber:G.PR,author:G.AUTHOR,headSha:sha,reviews,permissions
});
test('no PR reviews means no verified independent security signoff or Root install',()=>{
 const s=G.assess(opts());
 assert.equal(s.independent_same_sha_collaborator_approval,false);
 assert.equal(s.trusted_git_review_record_count,0);
 assert.equal(s.production_release_authorized,false);
 assert.equal(s.stage_a_root_install_approval_verified,false);
});
test('only independently approved exact HEAD SHA with known write/maintain/admin access counts',()=>{
 for(const permission of ['write','maintain','admin']){
  const v=G.assess(opts([review()],{'security-reviewer':permission}));
  assert.equal(v.independent_same_sha_collaborator_approval,true);
  assert.equal(v.trusted_git_review_record_count,1);
  assert.equal(v.production_release_authorized,false);
  assert.equal(v.stage_a_root_install_approval_verified,false);
 }
});
test('GitHub PR author cannot self-approve even when admin',()=>{
 const v=G.assess(opts([review('prhmonline')],{prhmonline:'admin'}));
 assert.equal(v.independent_same_sha_collaborator_approval,false);
});
test('stale review SHA is not approval of later release changes',()=>{
 const v=G.assess(opts([review('security-reviewer','APPROVED',old)],
  {'security-reviewer':'write'}));
 assert.equal(v.independent_same_sha_collaborator_approval,false);
});
test('review dismissed or changed-requests after approval blocks same reviewer',()=>{
 for(const state of ['DISMISSED','CHANGES_REQUESTED','COMMENTED']){
  const v=G.assess(opts([
   review(),
   review('security-reviewer',state,sha,'2026-11-15T13:02:00Z')
  ],{'security-reviewer':'admin'}));
  assert.equal(v.independent_same_sha_collaborator_approval,false,state);
 }
});
test('unprivileged and bot reviews do not meet independent approval',()=>{
 const cases=[
  [review('external'),{external:'read'}],
  [review('external'),{external:'triage'}],
  [review('security-bot'),{'security-bot':'admin'}],
  [review('github-actions'),{'github-actions':'write'}],
  [review('github-actions[bot]'),{'github-actions[bot]':'write'}]
 ];
 for(const [r,p] of cases){
  if(r.user.includes('[')){
   // Bot identities with bracket suffix violate strict login shape;
   // sanitized caller must exclude them, not count them as an approver.
   assert.throws(()=>G.assess(opts([r],p)),/untrusted_review_fields/);
  }else{
   const x=G.assess(opts([r],p));
   assert.equal(x.independent_same_sha_collaborator_approval,false,r.user);
  }
 }
});
test('missing or forged GitHub PR identity, reviews and mutation shapes fail closed',()=>{
 for(const patch of [
  {repository:'attacker/repo'},{prNumber:294},{author:'someone-else'},
  {headSha:'draft'},{reviews:'APPROVED'}, {permissions:null}
 ]){
  assert.throws(()=>G.assess({...opts(),...patch}),/u06_review_gate_/);
 }
 const good=review();good.independent=true;
 assert.throws(()=>G.assess(opts([good],{'security-reviewer':'admin'})),
  /untrusted_review_shape/);
});
test('review order reversal is invalid rather than resurrecting old approval',()=>{
 assert.throws(()=>G.assess(opts([
  review('security-reviewer','CHANGES_REQUESTED',sha,'2026-11-15T13:05:00Z'),
  review('security-reviewer','APPROVED',sha,'2026-11-15T13:00:00Z')
 ],{'security-reviewer':'write'})),/review_order_unstable/);
});
test('even external approved review evidence never authorizes L4 or Root',()=>{
 const s=G.assess(opts([review()],{'security-reviewer':'admin'}));
 assert.equal(s.stage_a_root_install_approval_verified,false);
 assert.equal(s.stage_b_reconcile_l4_consumed,false);
 assert.equal(s.privileged_root_handler_installed,false);
 assert.equal(s.production_release_authorized,false);
 assert.equal(G.PRODUCTION_RELEASE_AUTHORIZED,false);
 assert.equal(G.ROOT_APPLY,false);
 const r=spawnSync(process.execPath,
  [path.join(__dirname,'honartik-u06-independent-review-evidence-v1.cjs')],
  {encoding:'utf8'});
 assert.equal(r.status,64);
});
