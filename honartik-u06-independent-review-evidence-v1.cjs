'use strict';
/**
 * U06 GitHub review decision reducer (pure, no GitHub API or Root access).
 * Caller must fetch reviews and collaborator permissions directly from GitHub.
 * This cannot prove signed Root L4 installation authorization, only whether
 * an independent human collaborator reviewed the *same* final Git SHA.
 *
 * No automatic assumption from 'approved' strings, self-approval, stale SHA,
 * non-writers, bot identities, or synthetic fixtures. Release remains NO-GO.
 */
const REPO='prhmonline/prhm-host-actions';
const PR=295;
const AUTHOR='prhmonline';
const SHA=/^[a-f0-9]{40}$/;
const WRITE=new Set(['write','maintain','admin']);
const deny=k=>{throw Error('u06_review_gate_'+k)};
const need=(ok,k)=>{if(!ok)deny(k)};
const exactKeys=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
function assess({repository,prNumber,author,headSha,reviews,permissions}={}){
 need(repository===REPO&&prNumber===PR&&author===AUTHOR&&SHA.test(headSha||''),
  'untrusted_pr_identity');
 need(Array.isArray(reviews)&&reviews.length<=500&&
  permissions&&Object.getPrototypeOf(permissions)===Object.prototype,
  'untrusted_review_data');
 const latest=new Map();
 for(const r of reviews){
  need(exactKeys(r,['user','state','commit_id','submitted_at']),
   'untrusted_review_shape');
  need(typeof r.user==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(r.user)&&
   typeof r.state==='string'&&
   ['APPROVED','CHANGES_REQUESTED','COMMENTED','DISMISSED','PENDING'].includes(r.state)&&
   typeof r.commit_id==='string'&&SHA.test(r.commit_id)&&
   (typeof r.submitted_at==='string'&&Number.isFinite(Date.parse(r.submitted_at))),
   'untrusted_review_fields');
  const u=r.user.toLowerCase();
  need(!latest.has(u)||Date.parse(r.submitted_at)>=Date.parse(latest.get(u).submitted_at),
   'review_order_unstable');
  latest.set(u,r);
 }
 let valid=0;
 for(const [username,review] of latest){
  if(username===author.toLowerCase()||/\[bot\]$/i.test(username)||
   username.endsWith('-bot')||username==='github-actions')continue;
  const permission=permissions[username];
  if(review.state==='APPROVED'&&review.commit_id===headSha&&
   WRITE.has(permission))valid++;
 }
 return Object.freeze({
  schema:'prhm.u06.independent-github-review.v1',
  repository:REPO,pr_number:PR,head_sha:headSha,
  trusted_git_review_record_count:valid,
  independent_same_sha_collaborator_approval:valid>=1,
  exact_review_re_evaluation_required_on_new_sha:true,
  stage_a_root_install_approval_verified:false,
  stage_b_reconcile_l4_consumed:false,
  privileged_root_handler_installed:false,
  production_release_authorized:false,
  advisory_status:valid>=1?'REVIEW_RECORDED_ONLY__STAGE_A_STILL_NO_GO':
   'WAITING_FOR_INDEPENDENT_CURRENT_SHA_WRITE_ACCESS_REVIEW'
 });
}
module.exports=Object.freeze({
 REPO,PR,AUTHOR,assess,PRODUCTION_RELEASE_AUTHORIZED:false,ROOT_APPLY:false
});
if(require.main===module){
 process.stderr.write('GitHub review contract is pure and cannot authorize Root release.\n');
 process.exitCode=64;
}
